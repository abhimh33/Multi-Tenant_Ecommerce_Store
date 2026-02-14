-- 003_add_theme_column.sql
--
-- Add theme column to stores table for WooCommerce theme selection.
-- Supports 'storefront' (default) and 'astra' themes.

-- Create the enum type for supported themes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'store_theme') THEN
    CREATE TYPE store_theme AS ENUM ('storefront', 'astra');
  END IF;
END$$;

-- Add theme column — nullable because medusa stores don't need a theme
ALTER TABLE stores ADD COLUMN IF NOT EXISTS theme store_theme;

-- Backfill existing WooCommerce stores with the default theme
UPDATE stores SET theme = 'storefront' WHERE engine = 'woocommerce' AND theme IS NULL;
