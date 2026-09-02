import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { isAdmin } from '../lib/permissions';

export async function inviteRoutes(app: FastifyInstance) {
  // List invites for current user (pending)
  app.get('/api/invites', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const res = await query(
      `SELECT id, org_id, team_id, repo_id, role, token, status, expires_at, created_at FROM invites WHERE (invited_user_id = $1 OR email = $2) AND status = 'pending' ORDER BY created_at DESC`,
      [user.id, user.email]
    );
    return reply.send({ invites: res.rows });
  });

  // Invite to org
  app.post('/api/orgs/:org/invites', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { org } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' });
    const orgId = orgRes.rows[0].id;
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
      email: z.string().email().optional(),
      role: z.enum(['owner','admin','member']).default('member'),
    }).refine(d => d.username || d.email, { message: 'username or email required' });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, email, role } = parsed.data;
    let invitedUserId: string | null = null;
    let inviteEmail: string | null = email ?? null;
    if (username) {
      const u = await query(`SELECT id, email FROM users WHERE username=$1`, [username]);
      if (u.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
      invitedUserId = u.rows[0].id;
      inviteEmail = u.rows[0].email;
    }
    const res = await query(
      `INSERT INTO invites (org_id, invited_by, invited_user_id, email, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, token, expires_at`,
      [orgId, user.id, invitedUserId, inviteEmail, role]
    );
    return reply.status(201).send({ invite: res.rows[0] });
  });

  // Invite to repo
  app.post('/api/repos/:owner/:repo/invites', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const repoRes = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (repoRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = repoRes.rows[0].id;
    if (!(await isAdmin(repoId, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
      email: z.string().email().optional(),
      role: z.enum(['read','write','admin']).default('read'),
    }).refine(d => d.username || d.email, { message: 'username or email required' });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, email, role } = parsed.data;
    let invitedUserId: string | null = null;
    let inviteEmail: string | null = email ?? null;
    if (username) {
      const u = await query(`SELECT id, email FROM users WHERE username=$1`, [username]);
      if (u.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
      invitedUserId = u.rows[0].id;
      inviteEmail = u.rows[0].email;
    }
    const res = await query(
      `INSERT INTO invites (repo_id, invited_by, invited_user_id, email, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, token, expires_at`,
      [repoId, user.id, invitedUserId, inviteEmail, role]
    );
    return reply.status(201).send({ invite: res.rows[0] });
  });

  // Invite to team
  app.post('/api/orgs/:org/teams/:team/invites', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { org, team } = req.params as any;
    const orgRes = await query(`SELECT id FROM organizations WHERE name=$1`, [org]);
    if (orgRes.rows.length === 0) return reply.status(404).send({ error: 'org not found' });
    const orgId = orgRes.rows[0].id;
    const teamRes = await query(`SELECT id FROM teams WHERE org_id=$1 AND name=$2`, [orgId, team]);
    if (teamRes.rows.length === 0) return reply.status(404).send({ error: 'team not found' });
    const teamId = teamRes.rows[0].id;
    const roleRes = await query(`SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2`, [orgId, user.id]);
    if (roleRes.rows.length === 0 || !['owner','admin'].includes(roleRes.rows[0].role)) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
      email: z.string().email().optional(),
      role: z.enum(['member']).default('member'),
    }).refine(d => d.username || d.email, { message: 'username or email required' });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, email } = parsed.data;
    let invitedUserId: string | null = null;
    let inviteEmail: string | null = email ?? null;
    if (username) {
      const u = await query(`SELECT id, email FROM users WHERE username=$1`, [username]);
      if (u.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
      invitedUserId = u.rows[0].id;
      inviteEmail = u.rows[0].email;
    }
    const res = await query(
      `INSERT INTO invites (team_id, invited_by, invited_user_id, email, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, token, expires_at`,
      [teamId, user.id, invitedUserId, inviteEmail, 'member']
    );
    return reply.status(201).send({ invite: res.rows[0] });
  });

  // Accept invite
  app.post('/api/invites/:token/accept', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { token } = req.params as any;
    const invRes = await query(`SELECT * FROM invites WHERE token=$1 AND status='pending'`, [token]);
    if (invRes.rows.length === 0) return reply.status(404).send({ error: 'invite not found or expired' });
    const inv = invRes.rows[0];
    if (new Date(inv.expires_at) < new Date()) {
      await query(`UPDATE invites SET status='expired' WHERE id=$1`, [inv.id]);
      return reply.status(410).send({ error: 'invite expired' });
    }
    if (inv.invited_user_id && inv.invited_user_id !== user.id) return reply.status(403).send({ error: 'invite not for you' });
    if (inv.email && inv.email !== user.email && !inv.invited_user_id) {
      // allow if email matches
      if (inv.email !== user.email) return reply.status(403).send({ error: 'email mismatch' });
    }
    // Apply invite
    if (inv.org_id) {
      await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [inv.org_id, user.id, inv.role]);
    } else if (inv.team_id) {
      await query(`INSERT INTO team_members (team_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [inv.team_id, user.id]);
      // Also ensure org membership
      const teamOrg = await query(`SELECT org_id FROM teams WHERE id=$1`, [inv.team_id]);
      if (teamOrg.rows.length > 0) {
        await query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`, [teamOrg.rows[0].org_id, user.id]);
      }
    } else if (inv.repo_id) {
      await query(`INSERT INTO repository_members (repo_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [inv.repo_id, user.id, inv.role]);
    }
    await query(`UPDATE invites SET status='accepted' WHERE id=$1`, [inv.id]);
    return reply.send({ ok: true });
  });

  // Reject invite
  app.post('/api/invites/:token/reject', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { token } = req.params as any;
    const invRes = await query(`SELECT * FROM invites WHERE token=$1 AND status='pending'`, [token]);
    if (invRes.rows.length === 0) return reply.status(404).send({ error: 'invite not found' });
    const inv = invRes.rows[0];
    if (inv.invited_user_id && inv.invited_user_id !== user.id) return reply.status(403).send({ error: 'not for you' });
    await query(`UPDATE invites SET status='rejected' WHERE id=$1`, [inv.id]);
    return reply.send({ ok: true });
  });
}
