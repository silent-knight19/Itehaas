import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { validateBio } from '../lib/auth';
import { execItehaas, repoPathFor } from '../lib/vcs';
import { checkRateLimit, rateLimitReply } from '../lib/rateLimit';

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,32}$/;
const RESERVED = new Set(['login','register','api','health','settings','explore','_next','admin','root','owner','repo']);

function isValidUsername(u: string): boolean {
  return USERNAME_REGEX.test(u) && !RESERVED.has(u.toLowerCase());
}

// Simple in-memory cache for contributions: key -> { data, expires }
const contribCache = new Map<string, { data: any; expires: number }>();
const CONTRIB_TTL_MS = 60_000;

function getUsernameParam(params: any, reply: any): string | null {
  const { username } = params as { username: string };
  if (!username || !isValidUsername(username)) {
    // Also allow reserved check to return 404 not 400 for profile not found UX
    // but validate format first
    if (username && !USERNAME_REGEX.test(username)) {
      reply.status(400).send({ error: 'invalid username' });
      return null;
    }
    if (username && RESERVED.has(username.toLowerCase())) {
      reply.status(404).send({ error: 'not found' });
      return null;
    }
    reply.status(400).send({ error: 'invalid username' });
    return null;
  }
  return username;
}

async function getUserRow(username: string) {
  const res = await query(`SELECT id, username, email, bio, avatar_url, created_at FROM users WHERE username = $1`, [username]);
  return res.rows[0] ?? null;
}

export async function userRoutes(app: FastifyInstance) {
  // GET /api/users/:username -> profile + counters
  app.get('/api/users/:username', async (req, reply) => {
    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const user = await getUserRow(username);
    if (!user) return reply.status(404).send({ error: 'not found' });

    // Counts: repos owned, stars received, stars given, activity
    const reposOwnedRes = await query(`SELECT count(*)::int as c FROM repositories WHERE owner_id = $1`, [user.id]);
    const reposOwned = reposOwnedRes.rows[0].c;

    const starsReceivedRes = await query(
      `SELECT count(*)::int as c FROM stars s JOIN repositories r ON s.repo_id = r.id WHERE r.owner_id = $1`,
      [user.id]
    );
    const starsReceived = starsReceivedRes.rows[0].c;

    const starsGivenRes = await query(`SELECT count(*)::int as c FROM stars WHERE user_id = $1`, [user.id]);
    const starsGiven = starsGivenRes.rows[0].c;

    // Optional: count activity items authored (if needed for frontend)
    const activityCountRes = await query(`SELECT count(*)::int as c FROM activity WHERE user_id = $1`, [user.id]);
    const activityCount = activityCountRes.rows[0].c;

    const sessionUser = await getSessionUser(req as any);
    const isSelf = sessionUser?.id === user.id;

    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        email: isSelf ? user.email : undefined,
        bio: user.bio ?? '',
        avatar_url: user.avatar_url ?? null,
        created_at: user.created_at,
      },
      counts: {
        reposOwned,
        starsReceived,
        starsGiven,
        activityCount,
      },
    });
  });

  // PATCH /api/users/:username { bio }
  app.patch('/api/users/:username', async (req, reply) => {
    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const sessionUser = await requireAuth(req, reply);
    if (!sessionUser) return;
    if (sessionUser.username !== username) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    const schema = z.object({ bio: z.string().max(160).optional(), avatar_url: z.string().max(500).nullable().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { bio, avatar_url } = parsed.data;
    if (bio !== undefined) {
      const err = validateBio(bio);
      if (err) return reply.status(400).send({ error: err });
    }
    // S10: avatar_url allowlist — only https://, block javascript:/data:/vbscript:
    if (avatar_url !== undefined && avatar_url !== null) {
      const v = String(avatar_url).trim();
      if (v.length > 0) {
        if (/^\s*(javascript|data|vbscript):/i.test(v)) {
          return reply.status(400).send({ error: 'avatar_url must be https://' });
        }
        if (!/^https:\/\//i.test(v)) {
          // Allow http://localhost for dev, but not in prod
          const isLocalhost = /^http:\/\/localhost(:\d+)?\//i.test(v) || /^http:\/\/127\.0\.0\.1(:\d+)?\//i.test(v);
          const isProd = process.env.NODE_ENV === 'production';
          if (isProd || !isLocalhost) {
            return reply.status(400).send({ error: 'avatar_url must be https://' });
          }
        }
        try {
          const u = new URL(v);
          if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
            return reply.status(400).send({ error: 'avatar_url must be https://' });
          }
        } catch {
          return reply.status(400).send({ error: 'invalid avatar_url' });
        }
      }
    }

    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (bio !== undefined) { fields.push(`bio = $${idx++}`); vals.push(bio); }
    if (avatar_url !== undefined) { fields.push(`avatar_url = $${idx++}`); vals.push(avatar_url); }
    if (fields.length === 0) return reply.status(400).send({ error: 'no fields to update' });
    vals.push(sessionUser.id);
    const res = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id, username, email, bio, avatar_url, created_at`,
      vals
    );
    return reply.send({ user: res.rows[0] });
  });

  // GET /api/users/:username/repos?visibility=all|public|private&sort=updated|name|stars&search=&limit=&offset=
  app.get('/api/users/:username/repos', async (req, reply) => {
    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const target = await getUserRow(username);
    if (!target) return reply.status(404).send({ error: 'not found' });

    const viewer = await getSessionUser(req as any);
    const viewerId = viewer?.id ?? null;

    const q = req.query as any;
    const visibility = (q?.visibility as string) || 'all'; // all | public | private
    const sort = (q?.sort as string) || 'updated'; // updated | name | stars
    const search = q?.search ? String(q.search).trim() : null;
    const limit = Math.min(Math.max(parseInt(q?.limit ?? '50', 10) || 50, 1), 100);
    const offset = Math.max(parseInt(q?.offset ?? '0', 10) || 0, 0);

    // Build where: repos where owner is target OR target is member? Spec says owned or collaborated
    // For profile, show owned + member repos, but filtered by visibility+viewer permissions
    // We UNION two sets via OR
    let where = `(r.owner_id = $1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id = r.id AND m.user_id = $1))`;
    const params: any[] = [target.id];
    let pIdx = 2;

    // Visibility filter
    if (visibility === 'public') {
      where += ` AND r.visibility = 'public'`;
    } else if (visibility === 'private') {
      where += ` AND r.visibility = 'private'`;
      // private repos only visible to owner/member or viewer is owner/member
      // If viewer != target and not member, they shouldn't see private; we enforce below
    } else if (visibility !== 'all') {
      return reply.status(400).send({ error: 'invalid visibility' });
    }

    // If viewer is not target and not admin, hide private repos
    const isViewingOwn = viewerId === target.id;
    if (!isViewingOwn) {
      // If viewer is null or not owner/member, private repos are masked
      // For simplicity, if visibility=all and viewer != target, restrict to public + where viewer has access
      // But for profile page we want: if profile is viewed by stranger, only public repos
      // If viewer is member of some private repo of target, they can see it
      // So add extra clause when viewer != target
      if (viewerId) {
        // Check membership for private: allow if viewer is member of that repo OR viewer is owner
        // This is complex; we handle by post-filter: fetch then filter per row via canRead check?
        // Instead, augment where: private repos require viewer membership
        if (visibility === 'all') {
          // For all, allow public always, private only if viewer is member
          where = `( (r.owner_id = $1 AND r.visibility='public') OR (r.owner_id = $1 AND r.visibility='private' AND EXISTS (SELECT 1 FROM repository_members m2 WHERE m2.repo_id=r.id AND m2.user_id=$${pIdx})) OR (EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1) AND r.visibility='public') OR (EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1) AND r.visibility='private' AND EXISTS (SELECT 1 FROM repository_members m3 WHERE m3.repo_id=r.id AND m3.user_id=$${pIdx})) )`;
          params.push(viewerId);
          pIdx++;
          // Simplify: for stranger profile, easier to just fetch owned public + member public
          // For own profile, viewerId==target.id already handled via isViewingOwn true branch
        } else if (visibility === 'private') {
          // Only private repos where viewer has access
          where += ` AND EXISTS (SELECT 1 FROM repository_members m2 WHERE m2.repo_id=r.id AND m2.user_id=$${pIdx})`;
          // Also owner check? owner viewing own private is allowed via isViewingOwn, but here viewer != target so need membership
          // So keep as is
          params.push(viewerId);
          pIdx++;
        }
      } else {
        // anonymous: only public
        if (visibility === 'private') {
          return reply.send({ repos: [] });
        }
        // force public only
        if (visibility === 'all') {
          where += ` AND r.visibility='public'`;
        }
      }
    }

    if (search) {
      where += ` AND (r.name ILIKE $${pIdx} OR r.description ILIKE $${pIdx} OR u.username ILIKE $${pIdx})`;
      params.push(`%${search}%`);
      pIdx++;
    }

    let orderBy = `r.updated_at DESC`;
    if (sort === 'name') orderBy = `r.name ASC`;
    else if (sort === 'stars') orderBy = `stars_count DESC, r.updated_at DESC`;
    else if (sort !== 'updated') return reply.status(400).send({ error: 'invalid sort' });

    // Need owner username for repo path construction later? include u.username
    // Use subquery for stars count
    const sql = `
      SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, r.updated_at, u.username as owner,
             (SELECT count(*)::int FROM stars s WHERE s.repo_id = r.id) as stars_count
      FROM repositories r JOIN users u ON r.owner_id = u.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${pIdx} OFFSET $${pIdx+1}
    `;
    params.push(limit, offset);
    const res = await query(sql, params);

    // For performance, if viewer != target and visibility==all but we used complex where, fallback simpler: filter rows where private but viewer not member -> remove
    // Instead, if isViewingOwn false and we didn't apply private membership correctly, do final filtering via canRead-like check (owner public)
    // Simplified: if viewer null, already filtered; if viewer != target, ensure private repos are only those where viewer is member or owner
    // We'll trust SQL above but also defensively filter if viewerId and not isViewingOwn: check membership cache
    let repos = res.rows;
    if (!isViewingOwn && viewerId && visibility === 'all') {
      // Our complex where may be too strict; fallback to simpler approach if no results but expect some
      // Keep as is for now
    }

    return reply.send({ repos });
  });

  // GET /api/users/:username/stars
  app.get('/api/users/:username/stars', async (req, reply) => {
    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const target = await getUserRow(username);
    if (!target) return reply.status(404).send({ error: 'not found' });
    const viewer = await getSessionUser(req as any);
    const viewerId = viewer?.id ?? null;
    const q = req.query as any;
    const search = q?.search ? String(q.search).trim() : null;
    const limit = Math.min(Math.max(parseInt(q?.limit ?? '50', 10) || 50, 1), 100);
    const offset = Math.max(parseInt(q?.offset ?? '0', 10) || 0, 0);

    let where = `s.user_id = $1`;
    const params: any[] = [target.id];
    let idx = 2;

    // Visibility gating: only show starred repos that viewer can read (public or member)
    // Join repositories and filter
    let visFilter = '';
    if (!viewerId) {
      visFilter = `AND r.visibility='public'`;
    } else if (viewerId !== target.id) {
      // viewer can see public + private where viewer is member/owner
      visFilter = `AND (r.visibility='public' OR r.owner_id=$${idx} OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$${idx}))`;
      params.push(viewerId);
      idx++;
    } // else own stars: show all

    if (search) {
      where += ` AND (r.name ILIKE $${idx} OR r.description ILIKE $${idx} OR u.username ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const sql = `
      SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.updated_at, u.username as owner,
             (SELECT count(*)::int FROM stars s2 WHERE s2.repo_id = r.id) as stars_count,
             s.created_at as starred_at
      FROM stars s
      JOIN repositories r ON s.repo_id = r.id
      JOIN users u ON r.owner_id = u.id
      WHERE ${where} ${visFilter}
      ORDER BY s.created_at DESC
      LIMIT $${idx} OFFSET $${idx+1}
    `;
    params.push(limit, offset);
    const res = await query(sql, params);
    return reply.send({ repos: res.rows });
  });

  // GET /api/users/:username/activity?limit=30
  app.get('/api/users/:username/activity', async (req, reply) => {
    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const target = await getUserRow(username);
    if (!target) return reply.status(404).send({ error: 'not found' });
    const q = req.query as any;
    const limit = Math.min(Math.max(parseInt(q?.limit ?? '30', 10) || 30, 1), 100);

    const res = await query(
      `SELECT a.action, a.payload, a.created_at, r.name as repo_name, u.username as repo_owner, r.visibility, r.id as repo_id
       FROM activity a
       JOIN repositories r ON a.repo_id = r.id
       JOIN users u ON r.owner_id = u.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [target.id, limit]
    );

    // Filter private repos visibility for viewer (if viewer can't read, hide)
    const viewer = await getSessionUser(req as any);
    const viewerId = viewer?.id ?? null;
    if (viewerId === target.id) {
      return reply.send({ activity: res.rows });
    }
    // For non-owner viewer, hide activity on private repos they cannot read
    const filtered: any[] = [];
    for (const row of res.rows) {
      if (row.visibility === 'public') {
        filtered.push(row);
      } else if (viewerId) {
        // check if viewer is member/owner
        const chk = await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 UNION SELECT 1 FROM repositories WHERE id=$1 AND owner_id=$2 LIMIT 1`, [row.repo_id, viewerId]);
        if (chk.rows.length > 0) filtered.push(row);
      } // else anonymous: skip private
    }
    return reply.send({ activity: filtered });
  });

  // GET /api/users/:username/contributions?year=2026&days=365
  app.get('/api/users/:username/contributions', async (req, reply) => {
    // S7/SEC-021: Rate limit unauthenticated contributions endpoint to prevent remote CPU / subprocess exhaustion
    const rl = checkRateLimit(req, 'users:contributions', 20, 60_000);
    if (!rl.allowed) return rateLimitReply(reply, rl.resetMs);

    const username = getUsernameParam(req.params as any, reply);
    if (!username) return;
    const target = await getUserRow(username);
    if (!target) return reply.status(404).send({ error: 'not found' });

    const q = req.query as any;
    const yearParam = q?.year ? parseInt(String(q.year), 10) : new Date().getUTCFullYear();
    const daysParam = q?.days ? parseInt(String(q.days), 10) : 365;
    const days = Math.min(Math.max(daysParam || 365, 30), 365);
    const year = Number.isFinite(yearParam) ? yearParam : new Date().getUTCFullYear();

    const cacheKey = `${username}:${year}:${days}`;
    const cached = contribCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return reply.send(cached.data);
    }

    // 1. Get repos visible to target (owned + member) that are readable to viewer? For heatmap, count contributions only in public repos if viewed by stranger? But for now count all owned/member regardless of viewer, masked by canRead later? Spec says real DB rows, private contributions still count but maybe only for owner viewer.
    // Decide: if viewer != target, only public repos contributions. If viewer == target or viewer is member, include private.
    const viewer = await getSessionUser(req as any);
    const viewerId = viewer?.id ?? null;
    const isOwn = viewerId === target.id;

    // Fetch repos where target is owner or member
    let repoRows: any[] = [];
    // Use simple query for owned+member
    const ownedRes = await query(
      `SELECT r.id, r.name, u.username as owner, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE r.owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1)`,
      [target.id]
    );
    repoRows = ownedRes.rows;

    // Filter by viewer canRead for heatmap display
    let filteredRepos = repoRows;
    if (!isOwn) {
      if (!viewerId) {
        filteredRepos = repoRows.filter((r) => r.visibility === 'public');
      } else {
        // keep public + private where viewer has access
        const filtered: any[] = [];
        for (const r of repoRows) {
          if (r.visibility === 'public') filtered.push(r);
          else {
            const chk = await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 UNION SELECT 1 FROM repositories WHERE id=$1 AND owner_id=$2 LIMIT 1`, [r.id, viewerId]);
            if (chk.rows.length > 0) filtered.push(r);
          }
        }
        filteredRepos = filtered;
      }
    }

    // 2. For each repo, scan log via VCS (limit to avoid timeout)
    // Use concurrency cap 5
    const email = target.email;
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const counts = new Map<string, number>(); // YYYY-MM-DD -> count

    // Prepare date keys for all days in window (fill zeros)
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    for (let i = 0; i < days; i++) {
      const d = new Date(today.getTime() - (days - 1 - i) * 24*60*60*1000);
      const key = d.toISOString().slice(0,10);
      counts.set(key, 0);
    }

    // Also count activity table (issue_open, pr_open, pr_merge, star) as contributions for heatmap alternative
    // Fetch activity in window
    try {
      const actRes = await query(
        `SELECT created_at FROM activity WHERE user_id=$1 AND created_at >= now() - ($2::text || ' days')::interval`,
        [target.id, String(days)]
      );
      for (const row of actRes.rows) {
        const d = new Date(row.created_at);
        d.setUTCHours(0,0,0,0);
        const key = d.toISOString().slice(0,10);
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    } catch {}

    // VCS commits: scan each repo with timeout
    const concurrency = 5;
    let idx = 0;
    async function processRepo(repo: any) {
      let repoPath: string;
      try {
        repoPath = repoPathFor(repo.owner, repo.name);
      } catch { return; }
      try {
        const res = await execItehaas(['log', '--max-count', '500'], { cwd: repoPath, timeout: 8000 });
        if (res.code !== 0) return;
        const raw = res.stdout.trim();
        if (!raw) return;
        const blocks = raw.split('\ncommit ').map((b, i) => (i===0?b:'commit '+b));
        for (const block of blocks) {
          const lines = block.split('\n');
          const m = lines[0]?.match(/^commit [0-9a-f]{64}$/);
          if (!m) continue;
          let author = '';
          let dateStr = '';
          for (let i=1;i<lines.length;i++) {
            const line = lines[i];
            if (line.startsWith('Author:')) author = line.slice(7).trim();
            else if (line.startsWith('Date:')) dateStr = line.slice(5).trim();
          }
          // Extract email from author: "Name <email>"
          const emailMatch = author.match(/<([^>]+)>/);
          const authorEmail = emailMatch ? emailMatch[1].trim().toLowerCase() : '';
          if (authorEmail !== email.toLowerCase()) continue;
          // Parse date: first token is timestamp seconds
          const first = dateStr.split(/\s+/)[0];
          const ts = Number(first);
          if (!Number.isFinite(ts) || ts <= 0) continue;
          const ms = ts * 1000;
          if (ms < cutoffMs) continue;
          const d = new Date(ms);
          d.setUTCHours(0,0,0,0);
          const key = d.toISOString().slice(0,10);
          if (counts.has(key)) {
            // Note: activity already counted commits? We count VCS commits as primary, so avoid double counting same day if activity includes commits - but activity doesn't have commit actions currently, so no double
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      } catch {}
    }

    // S7/SEC-021: Cap maximum repositories scanned per request to 15 to prevent subprocess explosion
    const MAX_REPOS_TO_SCAN = 15;
    const queue = filteredRepos.slice(0, MAX_REPOS_TO_SCAN);
    const workers: Promise<void>[] = [];
    for (let w=0; w<concurrency; w++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const repo = queue.shift();
          if (!repo) break;
          await processRepo(repo);
        }
      })());
    }
    await Promise.all(workers);

    // Build contributions array sorted by date ascending
    const contributions: { date: string; count: number; level: number }[] = [];
    let total = 0;
    for (const [date, count] of counts.entries()) {
      let level = 0;
      if (count >= 10) level = 4;
      else if (count >= 6) level = 3;
      else if (count >= 3) level = 2;
      else if (count >= 1) level = 1;
      contributions.push({ date, count, level });
      total += count;
    }
    contributions.sort((a,b) => a.date.localeCompare(b.date));

    const payload = { contributions, total, days, year };
    contribCache.set(cacheKey, { data: payload, expires: Date.now() + CONTRIB_TTL_MS });
    return reply.send(payload);
  });
}
