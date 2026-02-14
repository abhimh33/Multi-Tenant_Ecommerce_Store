-- 004_store_admin_credentials.sql
--
-- Store admin credentials so tenants can access their store's admin panel.
-- For Medusa: the admin email/password created via `medusa user` CLI.
-- For WooCommerce: the WP admin username/password.
-- 
-- These are encrypted at rest via pgcrypto in production;
-- for development, stored as plain JSON in a JSONB column.

ALTER TABLE stores ADD COLUMN IF NOT EXISTS admin_credentials JSONB DEFAULT '{}';

-- Backfill comment: existing stores won't have credentials retroactively.
-- They can be re-provisioned or set manually.
COMMENT ON COLUMN stores.admin_credentials IS 'Store admin login credentials (email, password). Set during provisioning.';
