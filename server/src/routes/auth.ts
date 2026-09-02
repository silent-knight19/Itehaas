import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { hashPassword, verifyPassword, validateUsername, validatePassword, validateEmail, sessionCookieName, newSessionExpiry, csrfTokenForSession } from '../lib/auth';
import { cleanupExpiredSessions } from '../middleware/auth';
import { checkRateLimit, rateLimitReply, isLoginLocked, recordLoginFail, clearLoginFails, getLoginLockMs } from '../lib/rateLimit';
import * as argon2 from 'argon2';
import { auditLog } from '../lib/audit';

// Dummy hash for timing-equalization when user not found (argon2id, m=65536, t=3, p=1)
// Generated from `argon2.hash('dummy-timing-password-for-enumeration-mitigation', {type:argon2id,memoryCost:65536,timeCost:3,parallelism:1})`
// This hash is intentionally valid so verify takes similar time as real password check.
let cachedDummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (cachedDummyHash) return cachedDummyHash;
  try {
    cachedDummyHash = await argon2.hash('dummy-timing-password-for-enumeration-mitigation-!S2', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  } catch {
    // Fallback to a known hash string (may be with lower cost, but still takes some time)
    cachedDummyHash = '$argon2id$v=19$m=65536,t=3,p=1$c29tZWR1bW15c2FsdDEyMw$dummyhashplaceholderdummyhashplaceholderdummyhash12';
  }
  return cachedDummyHash;
}

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post('/api/auth/register', async (req, reply) => {
    // S2: rate-limit register 3/min per IP (brute-force / enumeration)
    const rlReg = checkRateLimit(req as any, 'register', 3, 60 * 1000);
    if (!rlReg.allowed) return rateLimitReply(reply, rlReg.resetMs);
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
      // S18: audit register
      await auditLog({ userId: user.id, action: 'auth.register', target: user.username, req });

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
      // S11: set csrf_token double-submit cookie
      reply.setCookie('csrf_token', csrfTokenForSession(sessionId), {
        path: '/',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires,
      });

      return reply.status(201).send({ user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at } });
    } catch (e: any) {
      if (e.code === '23505') {
        // S2: generic 409 to avoid enumeration (don't reveal which field)
        return reply.status(409).send({ error: 'username or email taken' });
      }
      req.log.error(e);
      return reply.status(500).send({ error: 'internal' });
    }
  });

  // Login
  app.post('/api/auth/login', async (req, reply) => {
    // S2: global login rate-limit 5/min per IP
    const rlLogin = checkRateLimit(req as any, 'login', 5, 60 * 1000);
    if (!rlLogin.allowed) return rateLimitReply(reply, rlLogin.resetMs);
    await cleanupExpiredSessions();
    const schema = z.object({
      username: z.string(),
      password: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, password } = parsed.data;

    // S2: brute-force lockout 5 fails → 15m per username+ip
    if (isLoginLocked(req as any, username)) {
      const until = getLoginLockMs(req as any, username);
      const retrySec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
      reply.header('Retry-After', String(retrySec));
      return reply.status(429).send({ error: 'too many failed attempts, try again later' });
    }

    const res = await query(`SELECT id, username, email, password_hash, created_at FROM users WHERE username = $1 OR email = $1`, [username]);
    if (res.rows.length === 0) {
      // S2: timing-equalization — do dummy argon2 verify so no-user vs wrong-pw timing similar
      try {
        const dummy = await getDummyHash();
        await verifyPassword(dummy, password);
      } catch {}
      recordLoginFail(req as any, username);
      // S18: audit login failure (no user)
      await auditLog({ action: 'auth.login_failure', target: username, req });
      return reply.status(401).send({ error: 'invalid credentials' });
    }
    const user = res.rows[0];
    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      recordLoginFail(req as any, username);
      // S18: audit login failure (wrong pw)
      await auditLog({ userId: user.id, action: 'auth.login_failure', target: user.username, req });
      return reply.status(401).send({ error: 'invalid credentials' });
    }
    clearLoginFails(req as any, username);

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
    // S11: set csrf_token
    reply.setCookie('csrf_token', csrfTokenForSession(sessionId), {
      path: '/',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires,
    });

    // S18: audit login success
    await auditLog({ userId: user.id, action: 'auth.login_success', target: user.username, req });
    return reply.send({ user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at } });
  });

  // Logout
  app.post('/api/auth/logout', async (req, reply) => {
    const sessionId = (req.cookies as any)[sessionCookieName()];
    if (sessionId) {
      await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    }
    reply.clearCookie(sessionCookieName(), { path: '/' });
    reply.clearCookie('csrf_token', { path: '/' });
    return reply.send({ ok: true });
  });

  // Me
  app.get('/api/auth/me', async (req, reply) => {
    const sessionId = (req.cookies as any)[sessionCookieName()];
    if (!sessionId) return reply.status(401).send({ error: 'not authenticated' });

    const res = await query(
      `SELECT u.id, u.username, u.email, u.created_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = $1 AND s.expires_at > now()`,
      [sessionId]
    );
    if (res.rows.length === 0) {
      reply.clearCookie(sessionCookieName(), { path: '/' });
      return reply.status(401).send({ error: 'not authenticated' });
    }

    const user = res.rows[0];
    return reply.send({ user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at } });
  });
}
