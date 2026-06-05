-- Adiciona coluna de deadline da próxima ação aos leads
-- Execute no Supabase SQL Editor antes de fazer deploy desta versão

ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS proxima_acao_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_bot_leads_proxima_acao ON bot_leads(store_id, proxima_acao_at) WHERE proxima_acao_at IS NOT NULL;
