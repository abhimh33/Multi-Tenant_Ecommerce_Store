-- 001_initial_schema.sql
-- 
-- Core tables for the multi-tenant ecommerce control plane.
-- Stores table tracks every store instance with its full lifecycle.
-- Audit log tracks every state transition and significant event.

-- Enum type for store engines
CREATE TYPE store_engine AS ENUM ('woocommerce', 'medusa');

-- Enum type for store lifecycle states
CREATE TYPE store_status AS ENUM (
  'requested',
  'provisioning',
  'ready',
  'failed',
  'deleting',
  'deleted'
);

-- Primary stores table
CREATE TABLE stores (
  id VARCHAR(32) PRIMARY KEY,                -- e.g. "store-7f3a"
  name VARCHAR(128) NOT NULL,                -- human-readable name
  engine store_engine NOT NULL,
  status store_status NOT NULL DEFAULT 'requested',

  -- Networking / access
  namespace VARCHAR(128) NOT NULL,           -- k8s namespace
  helm_release VARCHAR(128),                 -- helm release name
  storefront_url VARCHAR(512),
  admin_url VARCHAR(512),

  -- Lifecycle metadata
  failure_reason TEXT,                       -- human+machine readable
  retry_count INTEGER NOT NULL DEFAULT 0,
  provisioning_started_at TIMESTAMPTZ,
  provisioning_completed_at TIMESTAMPTZ,
  provisioning_duration_ms INTEGER,

  -- Ownership (for future multi-user support + guardrails)
  owner_id VARCHAR(128) NOT NULL DEFAULT 'default',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT unique_store_name_per_owner UNIQUE (name, owner_id)
);

-- Indexes for common queries
CREATE INDEX idx_stores_status ON stores (status);
CREATE INDEX idx_stores_owner ON stores (owner_id);
CREATE INDEX idx_stores_engine ON stores (engine);
CREATE INDEX idx_stores_created_at ON stores (created_at DESC);

-- Audit log table — append-only event trail
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  store_id VARCHAR(32) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,           -- e.g. 'status_change', 'helm_install', 'error'
  previous_status store_status,
  new_status store_status,
  message TEXT,
  metadata JSONB DEFAULT '{}',              -- structured data (durations, error codes, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_store_id ON audit_logs (store_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_event_type ON audit_logs (event_type);

-- Function to auto-update updated_at on stores table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
