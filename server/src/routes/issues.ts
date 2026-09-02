import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite } from '../lib/permissions';

function validateOwnerRepo(owner: string, repo: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(owner) && /^[a-zA-Z0-9._-]{1,100}$/.test(repo);
}

async function getRepoId(owner: string, repo: string) {
  const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (r.rows.length === 0) return null;
  return r.rows[0] as { id: string; visibility: string };
}

async function enrichIssue(issue: any) {
  const labels = await query(`SELECT l.id, l.name, l.color, l.description FROM labels l JOIN issue_labels il ON l.id=il.label_id WHERE il.issue_id=$1`, [issue.id]);
  const assignees = await query(`SELECT u.username FROM issue_assignees ia JOIN users u ON ia.user_id=u.id WHERE ia.issue_id=$1`, [issue.id]);
  let milestone: any = null;
  if (issue.milestone_id) {
    const ms = await query(`SELECT id, title, status FROM milestones WHERE id=$1`, [issue.milestone_id]);
    if (ms.rows.length > 0) milestone = ms.rows[0];
  }
  return { ...issue, labels: labels.rows, assignees: assignees.rows.map(r=>r.username), milestone };
}

export async function issueRoutes(app: FastifyInstance) {
  // List issues with filtering
  app.get('/api/repos/:owner/:repo/issues', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const { status, label, assignee, milestone } = req.query as any;
    let sql = `SELECT i.id, i.title, i.body, i.status, i.milestone_id, i.created_at, i.updated_at, u.username as author FROM issues i JOIN users u ON i.author_id=u.id WHERE repo_id=$1`;
    const params: any[] = [repoMeta.id];
    let idx = 2;
    if (status) { sql += ` AND i.status=$${idx++}`; params.push(status); }
    if (milestone) {
      // milestone may be id or title
      const m = await query(`SELECT id FROM milestones WHERE repo_id=$1 AND (id::text=$2 OR title=$2)`, [repoMeta.id, milestone]);
      if (m.rows.length > 0) { sql += ` AND i.milestone_id=$${idx++}`; params.push(m.rows[0].id); }
      else { sql += ` AND 1=0`; }
    }
    sql += ` ORDER BY updated_at DESC`;
    const res = await query(sql, params);
    let issues = res.rows;
    // Filter by label and assignee in memory (since many-to-many)
    if (label) {
      const labels = (label as string).split(',').map(s=>s.trim()).filter(Boolean);
      const filtered: any[] = [];
      for (const iss of issues) {
        const lbs = await query(`SELECT l.name FROM labels l JOIN issue_labels il ON l.id=il.label_id WHERE il.issue_id=$1`, [iss.id]);
        const names = lbs.rows.map(r=>r.name);
        if (labels.every(l=> names.includes(l))) filtered.push(iss);
      }
      issues = filtered;
    }
    if (assignee) {
      const filtered: any[] = [];
      for (const iss of issues) {
        const asg = await query(`SELECT u.username FROM issue_assignees ia JOIN users u ON ia.user_id=u.id WHERE ia.issue_id=$1`, [iss.id]);
        const names = asg.rows.map(r=>r.username);
        if (names.includes(assignee as string)) filtered.push(iss);
      }
      issues = filtered;
    }
    // Enrich
    const enriched = await Promise.all(issues.map(enrichIssue));
    return reply.send({ issues: enriched });
  });

  // Create issue with labels/assignees/milestone — S14: 20/min
  app.post('/api/repos/:owner/:repo/issues', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: cr, rateLimitReply: rlr } = await import('../lib/rateLimit');
    const rl = cr(req as any, 'issues', 20, 60 * 1000);
    if (!rl.allowed) return rlr(reply as any, rl.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(repoMeta.id, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });
    const schema = z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(5000).optional().default(''),
      labels: z.array(z.string().min(1).max(50)).optional().default([]),
      assignees: z.array(z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/)).optional().default([]),
      milestone: z.string().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { title, body, labels, assignees, milestone } = parsed.data;
    let milestoneId: string | null = null;
    if (milestone) {
      const m = await query(`SELECT id FROM milestones WHERE repo_id=$1 AND (id::text=$2 OR title=$2)`, [repoMeta.id, milestone]);
      if (m.rows.length === 0) return reply.status(400).send({ error: 'milestone not found' });
      milestoneId = m.rows[0].id;
    }
    const res = await query(`INSERT INTO issues (repo_id, author_id, title, body, milestone_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, title, body, status, milestone_id, created_at`, [repoMeta.id, user.id, title, body, milestoneId]);
    const issueId = res.rows[0].id;
    // Labels
    for (const lname of labels) {
      const l = await query(`SELECT id FROM labels WHERE repo_id=$1 AND name=$2`, [repoMeta.id, lname]);
      let labelId: string;
      if (l.rows.length === 0) {
        // Auto-create label with default color if not exists
        const nl = await query(`INSERT INTO labels (repo_id, name) VALUES ($1,$2) RETURNING id`, [repoMeta.id, lname]);
        labelId = nl.rows[0].id;
      } else labelId = l.rows[0].id;
      await query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [issueId, labelId]);
    }
    // Assignees
    for (const username of assignees) {
      const u = await query(`SELECT id FROM users WHERE username=$1`, [username]);
      if (u.rows.length === 0) continue;
      await query(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [issueId, u.rows[0].id]);
      try { await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'issue_assigned',$2)`, [u.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, issue_id: issueId, title })]); } catch {}
    }
    await query(`INSERT INTO activity (repo_id, user_id, action, payload) VALUES ($1,$2,'issue_open', $3)`, [repoMeta.id, user.id, JSON.stringify({ issue_id: issueId, title })]);
    // Mentions in title/body
    try {
      const text = `${title} ${body}`;
      const mentionRegex = /@([a-zA-Z0-9._-]{3,32})/g;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = mentionRegex.exec(text)) !== null) {
        const uname = m[1];
        if (uname === user.username || seen.has(uname)) continue;
        seen.add(uname);
        const u = await query(`SELECT id FROM users WHERE username=$1`, [uname]);
        if (u.rows.length > 0) {
          try { await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'mention',$2)`, [u.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, issue_id: issueId, by: user.username })]); } catch {}
        }
      }
    } catch {}
    const enriched = await enrichIssue(res.rows[0]);
    return reply.status(201).send({ issue: enriched });
  });

  // Get single issue
  app.get('/api/repos/:owner/:repo/issues/:id', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT i.id, i.title, i.body, i.status, i.milestone_id, i.created_at, i.updated_at, u.username as author FROM issues i JOIN users u ON i.author_id=u.id WHERE i.id=$1 AND i.repo_id=$2`, [id, repoMeta.id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const enriched = await enrichIssue(res.rows[0]);
    return reply.send({ issue: enriched });
  });

  // Update issue (close/reopen, title/body, labels/assignees/milestone)
  app.patch('/api/repos/:owner/:repo/issues/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const issue = await query(`SELECT author_id, repo_id FROM issues WHERE id=$1`, [id]);
    if (issue.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const isAuthor = issue.rows[0].author_id === user.id;
    const canW = await canWrite(repoMeta.id, user.id);
    if (!isAuthor && !canW) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(5000).optional(),
      status: z.enum(['open','closed']).optional(),
      labels: z.array(z.string().min(1).max(50)).optional(),
      assignees: z.array(z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/)).optional(),
      milestone: z.string().min(1).max(100).nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (parsed.data.title !== undefined) { fields.push(`title=$${idx++}`); vals.push(parsed.data.title); }
    if (parsed.data.body !== undefined) { fields.push(`body=$${idx++}`); vals.push(parsed.data.body); }
    if (parsed.data.status !== undefined) { fields.push(`status=$${idx++}`); vals.push(parsed.data.status); }
    if (parsed.data.milestone !== undefined) {
      if (parsed.data.milestone === null) { fields.push(`milestone_id=NULL`); }
      else {
        const m = await query(`SELECT id FROM milestones WHERE repo_id=$1 AND (id::text=$2 OR title=$2)`, [repoMeta.id, parsed.data.milestone]);
        if (m.rows.length === 0) return reply.status(400).send({ error: 'milestone not found' });
        fields.push(`milestone_id=$${idx++}`); vals.push(m.rows[0].id);
      }
    }
    if (fields.length > 0) {
      vals.push(id);
      const res = await query(`UPDATE issues SET ${fields.join(', ')}, updated_at=now() WHERE id=$${idx} RETURNING id, title, body, status, milestone_id, updated_at`, vals);
      if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    }
    // Labels
    if (parsed.data.labels !== undefined) {
      await query(`DELETE FROM issue_labels WHERE issue_id=$1`, [id]);
      for (const lname of parsed.data.labels) {
        const l = await query(`SELECT id FROM labels WHERE repo_id=$1 AND name=$2`, [repoMeta.id, lname]);
        let labelId: string;
        if (l.rows.length === 0) {
          const nl = await query(`INSERT INTO labels (repo_id, name) VALUES ($1,$2) RETURNING id`, [repoMeta.id, lname]);
          labelId = nl.rows[0].id;
        } else labelId = l.rows[0].id;
        await query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, labelId]);
      }
    }
    // Assignees
    if (parsed.data.assignees !== undefined) {
      await query(`DELETE FROM issue_assignees WHERE issue_id=$1`, [id]);
      for (const username of parsed.data.assignees) {
        const u = await query(`SELECT id FROM users WHERE username=$1`, [username]);
        if (u.rows.length === 0) continue;
        await query(`INSERT INTO issue_assignees (issue_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, u.rows[0].id]);
      }
    }
    const res = await query(`SELECT i.id, i.title, i.body, i.status, i.milestone_id, i.updated_at FROM issues i WHERE i.id=$1`, [id]);
    const enriched = await enrichIssue(res.rows[0]);
    return reply.send({ issue: enriched });
  });

  // Comments
  app.get('/api/repos/:owner/:repo/issues/:id/comments', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT c.id, c.body, c.created_at, u.username as author FROM issue_comments c JOIN users u ON c.author_id=u.id WHERE c.issue_id=$1 ORDER BY c.created_at`, [id]);
    return reply.send({ comments: res.rows });
  });

  app.post('/api/repos/:owner/:repo/issues/:id/comments', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crCom, rateLimitReply: rlrCom } = await import('../lib/rateLimit');
    const rlCom = crCom(req as any, 'comments', 30, 60 * 1000);
    if (!rlCom.allowed) return rlrCom(reply as any, rlCom.resetMs);
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(repoMeta.id, user.id, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({ body: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const exists = await query(`SELECT id FROM issues WHERE id=$1 AND repo_id=$2`, [id, repoMeta.id]);
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`INSERT INTO issue_comments (issue_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at`, [id, user.id, parsed.data.body]);
    // Mention parsing for comment
    const mentionRegex = /@([a-zA-Z0-9._-]{3,32})/g;
    let m: RegExpExecArray | null;
    const body = parsed.data.body;
    const mentioned = new Set<string>();
    while ((m = mentionRegex.exec(body)) !== null) {
      const uname = m[1];
      if (uname === user.username) continue;
      if (mentioned.has(uname)) continue;
      mentioned.add(uname);
      const u = await query(`SELECT id FROM users WHERE username=$1`, [uname]);
      if (u.rows.length > 0) {
        try { await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'mention',$2)`, [u.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, issue_id: id, by: user.username })]); } catch {}
      }
    }
    return reply.status(201).send({ comment: { ...res.rows[0], author: user.username } });
  });

  // Labels CRUD
  app.get('/api/repos/:owner/:repo/labels', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT id, name, color, description FROM labels WHERE repo_id=$1 ORDER BY name`, [repoMeta.id]);
    return reply.send({ labels: res.rows });
  });
  app.post('/api/repos/:owner/:repo/labels', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(repoMeta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ name: z.string().min(1).max(50), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#0969da'), description: z.string().max(200).optional().default('') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    try {
      const res = await query(`INSERT INTO labels (repo_id, name, color, description) VALUES ($1,$2,$3,$4) RETURNING id, name, color, description`, [repoMeta.id, parsed.data.name, parsed.data.color, parsed.data.description]);
      return reply.status(201).send({ label: res.rows[0] });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'label already exists' });
      throw e;
    }
  });
  app.delete('/api/repos/:owner/:repo/labels/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(repoMeta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const del = await query(`DELETE FROM labels WHERE id=$1 AND repo_id=$2`, [id, repoMeta.id]);
    if (del.rowCount === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ ok: true });
  });

  // Milestones CRUD
  app.get('/api/repos/:owner/:repo/milestones', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT id, title, description, due_date, status, created_at, updated_at FROM milestones WHERE repo_id=$1 ORDER BY created_at`, [repoMeta.id]);
    return reply.send({ milestones: res.rows });
  });
  app.post('/api/repos/:owner/:repo/milestones', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(repoMeta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ title: z.string().min(1).max(100), description: z.string().max(5000).optional().default(''), due_date: z.string().optional(), status: z.enum(['open','closed']).optional().default('open') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    let due: Date | null = null;
    if (parsed.data.due_date) {
      const d = new Date(parsed.data.due_date);
      if (isNaN(d.getTime())) return reply.status(400).send({ error: 'invalid due_date' });
      due = d;
    }
    try {
      const res = await query(`INSERT INTO milestones (repo_id, title, description, due_date, status) VALUES ($1,$2,$3,$4,$5) RETURNING id, title, status, created_at`, [repoMeta.id, parsed.data.title, parsed.data.description, due, parsed.data.status]);
      return reply.status(201).send({ milestone: res.rows[0] });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'milestone already exists' });
      throw e;
    }
  });
  app.patch('/api/repos/:owner/:repo/milestones/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(repoMeta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ title: z.string().min(1).max(100).optional(), description: z.string().max(5000).optional(), due_date: z.string().nullable().optional(), status: z.enum(['open','closed']).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (parsed.data.title !== undefined) { fields.push(`title=$${idx++}`); vals.push(parsed.data.title); }
    if (parsed.data.description !== undefined) { fields.push(`description=$${idx++}`); vals.push(parsed.data.description); }
    if (parsed.data.due_date !== undefined) {
      if (parsed.data.due_date === null) { fields.push(`due_date=NULL`); }
      else {
        const d = new Date(parsed.data.due_date);
        if (isNaN(d.getTime())) return reply.status(400).send({ error: 'invalid due_date' });
        fields.push(`due_date=$${idx++}`); vals.push(d);
      }
    }
    if (parsed.data.status !== undefined) { fields.push(`status=$${idx++}`); vals.push(parsed.data.status); }
    if (fields.length === 0) return reply.status(400).send({ error: 'no fields' });
    vals.push(id);
    const res = await query(`UPDATE milestones SET ${fields.join(', ')}, updated_at=now() WHERE id=$${idx} AND repo_id=$${idx+1} RETURNING *`, [...vals, repoMeta.id]);
    // Note: need correct placeholder count
    return reply.send({ milestone: res.rows[0] });
  });
}
