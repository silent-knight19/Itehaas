import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { hashPassword, verifyPassword, validateUsername, validatePassword, validateEmail, sessionCookieName, newSessionExpiry } from '../lib/auth';
import { cleanupExpiredSessions } from '../middleware/auth';

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post('/api/auth/register', async (req, reply) => {
    await cleanupExpiredSessions();
    const schema = z.object({
      username: z.string().min(3).max(32),
      email: z.string().email(),
      password: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }
    const { username, email, password } = parsed.data;

    const uErr = validateUsername(username);
    if (uErr) return reply.status(400).send({ error: uErr });
    const eErr = validateEmail(email);
    if (eErr) return reply.status(400).send({ error: eErr });
    const pErr = validatePassword(password);
    if (pErr) return reply.status(400).send({ error: pErr });

    const hash = await hashPassword(password);

    try {
      const res = await query(
        `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, created_at`,
        [username, email, hash]
      );
      const user = res.rows[0];

      // Create session
      const expires = newSessionExpiry();
      const sess = await query(`INSERT INTO sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id`, [user.id, expires]);
      const sessionId = sess.rows[0].id;

      reply.setCookie(sessionCookieName(), sessionId, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires,
      });

      return reply.status(201).send({ user: { id: user.id, username: user.username, email: user.email } });
    } catch (e: any) {
      if (e.code === '23505') {
        // unique violation
        const detail = e.detail || '';
        if (detail.includes('username')) return reply.status(409).send({ error: 'username taken' });
        if (detail.includes('email')) return reply.status(409).send({ error: 'email taken' });
        return reply.status(409).send({ error: 'username or email taken' });
      }
      req.log.error(e);
      return reply.status(500).send({ error: 'internal' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, reply) => {
    await cleanupExpiredSessions();
    const schema = z.object({
      username: z.string(),
      password: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, password } = parsed.data;

    const res = await query(`SELECT id, username, email, password_hash FROM users WHERE username = $1 OR email = $1`, [username]);
    if (res.rows.length === 0) return reply.status(401).send({ error: 'invalid credentials' });
    const user = res.rows[0];
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) return reply.status(401).send({ error: 'invalid credentials' });

    const expires = newSessionExpiry();
    const sess = await query(`INSERT INTO sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id`, [user.id, expires]);
    const sessionId = sess.rows[0].id;

    reply.setCookie(sessionCookieName(), sessionId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires,
    });

    return reply.send({ user: { id: user.id, username: user.username, email: user.email } });
  });

  // Logout
  app.post('/api/auth/logout', async (req, reply) => {
    const sessionId = (req.cookies as any)[sessionCookieName()];
    if (sessionId) {
      await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    }
    reply.clearCookie(sessionCookieName(), { path: '/' });
    return reply.send({ ok: true });
  });

  // Me
  app.get('/api/auth/me', async (req, reply) => {
    const sessionId = (req.cookies as any)[sessionCookieName()];
    if (!sessionId) return reply.status(401).send({ error: 'not authenticated' });

    const res = await query(
      `SELECT u.id, u.username, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = $1 AND s.expires_at > now()`,
      [sessionId]
    );
    if (res.rows.length === 0) return reply.status(401).send({ error: 'session expired' });
    return reply.send({ user: res.rows[0] });
  });
}
