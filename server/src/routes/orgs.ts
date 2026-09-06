import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, getClient } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { isAdmin, canRead } from '../lib/permissions';
import { parsePagination } from '../lib/budgets';
import { auditLog } from '../lib/audit';

function validateOrgName(name: string): boolean {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(name);
}
function validateTeamName(name: string): boolean {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(name);
}

export async function orgRoutes(app: FastifyInstance) {
  // Create org
  app.post('/api/orgs', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: namespace squatting guard — 10/min.
    const { checkRateLimit: crOrg, rateLimitReply: rlrOrg } = await import('../lib/rateLimit');
    const rlOrg = crOrg(req as any, 'org_create', 10, 60 * 1000);
    if (!rlOrg.allowed) return rlrOrg(reply as any, rlOrg.resetMs);
    const schema = z.object({
      name: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
      display_name: z.string().max(100).optional().default(''),
      description: z.string().max(500).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { name, display_name, description } = parsed.data;
    if (!validateOrgName(name)) return reply.status(400).send({ error: 'invalid org name' });
    try {
      const res = await query(
        `INSERT INTO organizations (name, display_name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, display_name, description, created_at`,
        [name, display_name, description, user.id]
      );
      const org = res.rows[0];
      await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'owner')`, [org.id, user.id]);
      return reply.status(201).send({ org });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'organization already exists' });
      throw e;
    }
  });

  // Get org
  app.get('/api/orgs/:org', async (req, reply) => {
    const { org } = req.params as any;
    if (!validateOrgName(org)) return reply.status(400).send({ error: 'invalid org name' });
    const res = await query(`SELECT id, name, display_name, description, created_at, updated_at FROM organizations WHERE name=$1`, [org]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgRow = res.rows[0];
    // Members count
    const members = await query(`SELECT u.username, om.role FROM organization_members om JOIN users u ON om.user_id=u.id WHERE om.org_id=$1`, [orgRow.id]);
    return reply.send({ org: orgRow, members: members.rows });
  });

  // List orgs for current user
  app.get('/api/orgs', async (req, reply) => {
    const user = await getSessionUser(req as any);
    if (!user) return reply.send({ orgs: [] });
    const res = await query(
      `SELECT o.id, o.name, o.display_name FROM organizations o JOIN organization_members om ON o.id=om.org_id WHERE om.user_id=$1 ORDER BY o.created_at`,
      [user.id]
    );
    return reply.send({ orgs: res.rows });
  });

  // Add member (invite via direct add for MVP, or create invite)
  app.post('/api/orgs/:org/members', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org } = req.params as any;
    if (!validateOrgName(org)) return reply.status(400).send({ error: 'invalid org name' });
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    // Check admin/owner
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });

    const schema = z.object({
      username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
      role: z.enum(['owner','admin','member']).default('member'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, role } = parsed.data;
    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const targetId = target.rows[0].id;
    try {
      await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,$3)`, [orgId, targetId, role]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'already a member' });
      throw e;
    }
    // S18: org membership changes are privilege-relevant.
    await auditLog({ userId: user.id, action: 'org.member_add', target: `${org}:${username}:${role}`, req });
    return reply.status(201).send({ ok: true, username, role });
  });

  // List org members — S7: paginated output budget.
  app.get('/api/orgs/:org/members', async (req, reply) => {
    const { org } = req.params as any;
    if (!validateOrgName(org)) return reply.status(400).send({ error: 'invalid org name' });
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const page = parsePagination(req.query as any);
    if ('error' in page) return reply.status(400).send({ error: page.error });
    const members = await query(`SELECT u.username, om.role, om.created_at FROM organization_members om JOIN users u ON om.user_id=u.id WHERE om.org_id=$1 ORDER BY om.created_at LIMIT $2 OFFSET $3`, [orgRes.rows[0].id, page.limit, page.offset]);
    return reply.send({ members: members.rows });
  });

  // Remove member
  app.delete('/api/orgs/:org/members/:username', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org, username } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const targetId = target.rows[0].id;
    // S3+S15: never orphan the org — the last-owner check and the DELETE run in ONE
    // transaction with the owner rows locked (FOR UPDATE), so concurrent removals
    // cannot both observe "2 owners" and delete both.
    const oclient = await getClient();
    try {
      await oclient.query('BEGIN');
      const targetRole = await oclient.query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2 FOR UPDATE`, [orgId, targetId]);
      if (targetRole.rows.length === 0) {
        await oclient.query('ROLLBACK');
        return reply.status(404).send({ error: 'not a member' });
      }
      if (targetRole.rows[0]?.role === 'owner') {
        const owners = await oclient.query(`SELECT user_id FROM organization_members WHERE org_id=$1 AND role='owner' FOR UPDATE`, [orgId]);
        if (owners.rows.length <= 1) {
          await oclient.query('ROLLBACK');
          return reply.status(400).send({ error: 'cannot remove the last owner' });
        }
      }
      const del = await oclient.query(`DELETE FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, targetId]);
      if (del.rowCount === 0) {
        await oclient.query('ROLLBACK');
        return reply.status(404).send({ error: 'not a member' });
      }
      await oclient.query('COMMIT');
    } catch (e) {
      try { await oclient.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      oclient.release();
    }
    // S18: audited after commit (target name only, never secrets).
    await auditLog({ userId: user.id, action: 'org.member_remove', target: `${org}:${username}`, req });
    return reply.send({ ok: true });
  });

  // Teams: create
  app.post('/api/orgs/:org/teams', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/), description: z.string().max(500).optional().default('') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { name, description } = parsed.data;
    if (!validateTeamName(name)) return reply.status(400).send({ error: 'invalid team name' });
    try {
      const res = await query(`INSERT INTO teams (org_id, name, description) VALUES ($1,$2,$3) RETURNING id, name, description, created_at`, [orgId, name, description]);
      await auditLog({ userId: user.id, action: 'team.create', target: `${org}/${name}`, req });
      return reply.status(201).send({ team: res.rows[0] });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'team already exists' });
      throw e;
    }
  });

  // List teams — S7: paginated output budget.
  app.get('/api/orgs/:org/teams', async (req, reply) => {
    const { org } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const page = parsePagination(req.query as any);
    if ('error' in page) return reply.status(400).send({ error: page.error });
    const teams = await query(`SELECT id, name, description, created_at FROM teams WHERE org_id=$1 ORDER BY created_at LIMIT $2 OFFSET $3`, [orgId, page.limit, page.offset]);
    return reply.send({ teams: teams.rows });
  });

  // Team members: add
  app.post('/api/orgs/:org/teams/:team/members', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org, team } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgId, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const teamId = teamRes.rows[0].id;
    // Check org admin or team member? For MVP, require org admin/owner
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const target = await query(`SELECT id FROM users WHERE username=$1`, [parsed.data.username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    // Also ensure target is org member? For MVP, auto-add to org if not
    const isOrgMember = await query(`SELECT 1 FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, target.rows[0].id]);
    if (isOrgMember.rows.length === 0) {
      await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'member')`, [orgId, target.rows[0].id]);
    }
    try {
      await query(`INSERT INTO team_members (team_id, user_id) VALUES ($1,$2)`, [teamId, target.rows[0].id]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'already in team' });
      throw e;
    }
    await auditLog({ userId: user.id, action: 'team.member_add', target: `${org}/${team}:${parsed.data.username}`, req });
    return reply.status(201).send({ ok: true });
  });

  // List team members — S7: paginated output budget.
  app.get('/api/orgs/:org/teams/:team/members', async (req, reply) => {
    const { org, team } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgId, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const page = parsePagination(req.query as any);
    if ('error' in page) return reply.status(400).send({ error: page.error });
    const members = await query(`SELECT u.username FROM team_members tm JOIN users u ON tm.user_id=u.id WHERE tm.team_id=$1 LIMIT $2 OFFSET $3`, [teamRes.rows[0].id, page.limit, page.offset]);
    return reply.send({ members: members.rows });
  });

  // Remove team member
  app.delete('/api/orgs/:org/teams/:team/members/:username', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org, team, username } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgId, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const del = await query(`DELETE FROM team_members WHERE team_id=$1 AND user_id=$2`, [teamRes.rows[0].id, target.rows[0].id]);
    if (del.rowCount === 0) return reply.status(404).send({ error: 'not in team' });
    await auditLog({ userId: user.id, action: 'team.member_remove', target: `${org}/${team}:${username}`, req });
    return reply.send({ ok: true });
  });

  // Team repos: grant
  app.post('/api/orgs/:org/teams/:team/repos', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: privilege grants are sensitive — 10/min.
    { const { checkRateLimit: crTR, rateLimitReply: rlrTR } = await import('../lib/rateLimit');
      const rlTR = crTR(req as any, 'team_repos', 10, 60 * 1000);
      if (!rlTR.allowed) return rlrTR(reply as any, rlTR.resetMs); }
    const { org, team } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const orgId = orgRes.rows[0].id;
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgId, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
      repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
      permission: z.enum(['read','write','admin']).default('read'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { owner, repo, permission } = parsed.data;
    const repoRes = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (repoRes.rows.length === 0) return reply.status(404).send({ error: 'repo not found' });
    const repoId = repoRes.rows[0].id;

    // SEC-006: User must be admin of the repository to attach it to an organization team
    if (!(await isAdmin(repoId, user.id))) {
      return reply.status(403).send({ error: 'forbidden: admin permission required on target repository' });
    }
    try {
      await query(`INSERT INTO team_repositories (team_id, repo_id, permission) VALUES ($1,$2,$3)`, [teamRes.rows[0].id, repoId, permission]);
    } catch (e: any) {
      if (e.code === '23505') {
        await query(`UPDATE team_repositories SET permission=$1 WHERE team_id=$2 AND repo_id=$3`, [permission, teamRes.rows[0].id, repoId]);
        await auditLog({ userId: user.id, action: 'team.repo_grant', target: `${org}/${team}:${owner}/${repo}:${permission}`, req });
        return reply.send({ ok: true, updated: true });
      }
      throw e;
    }
    await auditLog({ userId: user.id, action: 'team.repo_grant', target: `${org}/${team}:${owner}/${repo}:${permission}`, req });
    return reply.status(201).send({ ok: true });
  });

  // List team repos — S3: private repo names must not leak to viewers who cannot read them.
  app.get('/api/orgs/:org/teams/:team/repos', async (req, reply) => {
    const { org, team } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgRes.rows[0].id, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    // S7: output budget (visibility filter from S3 applies after the capped fetch).
    const reposPage = parsePagination(req.query as any);
    if ('error' in reposPage) return reply.status(400).send({ error: reposPage.error });
    const repos = await query(
      `SELECT r.id, r.name, r.visibility, u.username as owner, tr.permission FROM team_repositories tr JOIN repositories r ON tr.repo_id=r.id JOIN users u ON r.owner_id=u.id WHERE tr.team_id=$1 LIMIT $2 OFFSET $3`,
      [teamRes.rows[0].id, reposPage.limit, reposPage.offset]
    );
    const { getSessionUser: getSU } = await import('../middleware/auth');
    const viewer = await getSU(req as any);
    const visible = [];
    for (const row of repos.rows) {
      if (await canRead(row.id, viewer?.id ?? null, row.visibility)) visible.push(row);
    }
    return reply.send({ repos: visible });
  });

  // Delete team repo
  app.delete('/api/orgs/:org/teams/:team/repos/:owner/:repo', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership/privilege mutation class — 20/min.
    { const { checkRateLimit: crOM, rateLimitReply: rlrOM } = await import('../lib/rateLimit');
      const rlOM = crOM(req as any, 'org_members', 20, 60 * 1000);
      if (!rlOM.allowed) return rlrOM(reply as any, rlOM.resetMs); }
    const { org, team, owner, repo } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgRes.rows[0].id, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgRes.rows[0].id, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const repoRes = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (repoRes.rows.length === 0) return reply.status(404).send({ error: 'repo not found' });
    const del = await query(`DELETE FROM team_repositories WHERE team_id=$1 AND repo_id=$2`, [teamRes.rows[0].id, repoRes.rows[0].id]);
    if (del.rowCount === 0) return reply.status(404).send({ error: 'not found' });
    await auditLog({ userId: user.id, action: 'team.repo_remove', target: `${org}/${team}:${owner}/${repo}`, req });
    return reply.send({ ok: true });
  });
}
