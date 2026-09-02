import { query } from '../db';
import { incAuditLog } from './metrics';

export interface AuditOpts {
  userId?: string | null;
  action: string;
  target?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  req?: any;
}

export async function auditLog(opts: AuditOpts): Promise<void> {
  const ip = opts.ip ?? (opts.req ? (opts.req.ip as string) : null);
  const ua = opts.userAgent ?? (opts.req ? (opts.req.headers?.['user-agent'] as string) : null);
  const userId = opts.userId ?? null;
  const action = opts.action;
  const target = opts.target ?? null;
  // Basic allowlist for action to avoid injection
  if (!/^[a-z._:-]{3,100}$/.test(action)) return;
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, target, ip, user_agent) VALUES ($1,$2,$3,$4,$5)`,
      [userId, action, target, ip ? String(ip).slice(0,45) : null, ua ? String(ua).slice(0,500) : null]
    );
    incAuditLog();
  } catch (e) {
    // Audit failure should not block main action; log to pino
    console.error('auditLog failed', e);
  }
}
