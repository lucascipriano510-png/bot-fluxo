-- Migration 11: Store Profile — campos configuráveis no painel
-- Execute no Supabase SQL Editor
-- Idempotente: ADD COLUMN IF NOT EXISTS, todas colunas nullable
-- Sem nova tabela, sem alteração em RLS, sem DROP

ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS business_type       text,
  ADD COLUMN IF NOT EXISTS city                text,
  ADD COLUMN IF NOT EXISTS state               text,
  ADD COLUMN IF NOT EXISTS delivery_info       text,
  ADD COLUMN IF NOT EXISTS payment_info        text,
  ADD COLUMN IF NOT EXISTS instagram           text,
  ADD COLUMN IF NOT EXISTS site_url            text,
  ADD COLUMN IF NOT EXISTS catalog_url         text,
  ADD COLUMN IF NOT EXISTS sales_tone          text,
  ADD COLUMN IF NOT EXISTS sales_instructions  text,
  ADD COLUMN IF NOT EXISTS return_policy       text,
  ADD COLUMN IF NOT EXISTS discount_rules      text;

SELECT 'Migration 11 OK — ' || COUNT(*) || ' loja(s) com configurações' AS status
FROM bot_settings;
