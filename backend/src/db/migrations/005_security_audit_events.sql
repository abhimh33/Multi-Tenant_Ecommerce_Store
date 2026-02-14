-- Migration 005: Extend audit_logs for security events
-- Makes store_id nullable so system-level security events (login, lockout, rate limit)
-- can be recorded in the same audit trail without requiring a store reference.

-- Drop FK constraint to allow NULL store_id
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_store_id_fkey;

-- Make store_id nullable
ALTER TABLE audit_logs ALTER COLUMN store_id DROP NOT NULL;

-- Relax store_status constraint on previous_status and new_status
-- Security events don't have store statuses
ALTER TABLE audit_logs ALTER COLUMN previous_status TYPE VARCHAR(64);
ALTER TABLE audit_logs ALTER COLUMN new_status TYPE VARCHAR(64);

-- Add columns for security event context
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);

-- Index for security event queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs (user_email) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs (ip_address) WHERE ip_address IS NOT NULL;
