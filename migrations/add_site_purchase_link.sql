-- ═══════════════════════════════════════════════════════════════════════════
-- Fase A — Integração de compras do site → CRM
-- Tabela do PRÓPRIO CRM (lead_purchases). Não toca em auth, RLS de stores,
-- store_users, invite_codes, webhooks ou em qualquer tabela do site.
-- Idempotente: pode rodar mais de uma vez sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════════

-- Origem externa da compra (ex.: 'order:<uuid>') — usada para dedup.
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS external_ref text;

-- De onde veio o registro: 'site_cron' | 'site_webhook' | 'manual' | ...
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS source text;

-- Quando a compra foi estornada (Refund/CANCELADO no site). NULL = ativa.
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Garante que a MESMA venda do site nunca seja contada duas vezes por loja.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_purchases_external_ref
  ON lead_purchases(store_id, external_ref)
  WHERE external_ref IS NOT NULL;
