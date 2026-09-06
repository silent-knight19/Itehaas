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
    // S18: opportunistic retention enforcement (FSEC-024) — every Nth event prunes
    // rows older than the retention window, so a flood of attacker-triggered
    // events (logins, blocks) cannot grow audit_logs without bound. Cheap counter
    // check per call; failures never block the audited action.
    auditCounter++;
    if (auditCounter % AUDIT_PRUNE_EVERY === 0) {
      try {
        await pruneAuditLogs();
      } catch {}
    }
  } catch (e) {
    // Audit failure should not block main action; log to pino
    console.error('auditLog failed', e);
  }
}

let auditCounter = 0;
const AUDIT_PRUNE_EVERY = 128;

/** Retention window in days (env-overridable for compliance needs). */
export function auditRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 90;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 90;
  return Math.min(n, 3650);
}

/**
 * S18: bounded retention prune (uses idx_audit_logs_created). Deletes rows older
 * than the window in a single statement — no unbounded scans, no pagination.
 * Returns the pruned row count for observability.
 */
export async function pruneAuditLogs(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const days = auditRetentionDays(env);
  const res = await query(
    `DELETE FROM audit_logs WHERE created_at < now() - ($1::text || ' days')::interval`,
    [String(days)]
  );
  return res.rowCount ?? 0;
}
