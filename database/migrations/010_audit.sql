-- Phase S18: Security audit log — immutable trail for security-sensitive actions
-- SEC-020: Missing audit logging

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action ~ '^[a-z._:-]{3,100}$'),
  target TEXT CHECK (length(target) <= 500),
  ip TEXT CHECK (length(ip) <= 45),
  user_agent TEXT CHECK (length(user_agent) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target);
