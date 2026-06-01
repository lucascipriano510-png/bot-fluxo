-- Execute no Supabase SQL Editor antes de usar esta feature.
-- Adiciona colunas para persistir o resultado do scan do site entre deploys.

ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS site_scan_summary text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS site_scan_title   text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS site_scan_at      timestamptz;
