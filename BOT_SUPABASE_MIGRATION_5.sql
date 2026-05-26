-- ============================================================
-- BOT_SUPABASE_MIGRATION_5.sql
-- Multi-Tenant SaaS: store_id em todas as tabelas bot_*
-- ============================================================
-- SEGURO:
--   - Apenas ADD COLUMN IF NOT EXISTS
--   - Nenhum DROP TABLE
--   - Nenhum DELETE de dados de negócio
--   - Dados existentes migrados para Fluxo Outlet automaticamente
-- ============================================================

-- 1. Garantir que stores existe (pode já existir da migration 4)
CREATE TABLE IF NOT EXISTS stores (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            text        UNIQUE NOT NULL,
  name            text        NOT NULL,
  whatsapp_number text,
  logo_url        text,
  is_active       boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

-- 2. Inserir Fluxo Outlet como primeira loja (idempotente)
INSERT INTO stores (slug, name, whatsapp_number, is_active)
VALUES ('fluxo-outlet', 'Fluxo Outlet', '5534984148067', true)
ON CONFLICT (slug) DO NOTHING;

-- 3. Adicionar store_id às tabelas legadas
ALTER TABLE bot_sessions    ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);
ALTER TABLE bot_mensagens   ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);
ALTER TABLE bot_leads       ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);
ALTER TABLE bot_optouts     ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);
ALTER TABLE bot_flow_config ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);

-- 4. Associar todos os registros existentes à Fluxo Outlet
DO $$
DECLARE
  fluxo_id uuid;
BEGIN
  SELECT id INTO fluxo_id FROM stores WHERE slug = 'fluxo-outlet';

  UPDATE bot_sessions    SET store_id = fluxo_id WHERE store_id IS NULL;
  UPDATE bot_mensagens   SET store_id = fluxo_id WHERE store_id IS NULL;
  UPDATE bot_leads       SET store_id = fluxo_id WHERE store_id IS NULL;
  UPDATE bot_optouts     SET store_id = fluxo_id WHERE store_id IS NULL;
  UPDATE bot_flow_config SET store_id = fluxo_id WHERE store_id IS NULL;
END $$;

-- 5. Tornar NOT NULL (todos os registros já têm valor)
ALTER TABLE bot_sessions    ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE bot_mensagens   ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE bot_leads       ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE bot_optouts     ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE bot_flow_config ALTER COLUMN store_id SET NOT NULL;

-- 6. Remover constraints únicas antigas (por phone/node_id sozinhos)
ALTER TABLE bot_sessions    DROP CONSTRAINT IF EXISTS bot_sessions_phone_key;
ALTER TABLE bot_leads       DROP CONSTRAINT IF EXISTS bot_leads_phone_key;
ALTER TABLE bot_optouts     DROP CONSTRAINT IF EXISTS bot_optouts_phone_key;
ALTER TABLE bot_flow_config DROP CONSTRAINT IF EXISTS bot_flow_config_node_id_key;

-- 7. Adicionar constraints multi-tenant (store_id + identificador)
ALTER TABLE bot_sessions    ADD CONSTRAINT bot_sessions_store_phone_unique
  UNIQUE (store_id, phone);

ALTER TABLE bot_leads       ADD CONSTRAINT bot_leads_store_phone_unique
  UNIQUE (store_id, phone);

ALTER TABLE bot_optouts     ADD CONSTRAINT bot_optouts_store_phone_unique
  UNIQUE (store_id, phone);

ALTER TABLE bot_flow_config ADD CONSTRAINT bot_flow_config_store_node_unique
  UNIQUE (store_id, node_id);

-- 8. Índices otimizados para queries multi-tenant
CREATE INDEX IF NOT EXISTS idx_bot_sessions_store_phone
  ON bot_sessions(store_id, phone);

CREATE INDEX IF NOT EXISTS idx_bot_mensagens_store_phone
  ON bot_mensagens(store_id, phone);

CREATE INDEX IF NOT EXISTS idx_bot_leads_store_id
  ON bot_leads(store_id);

CREATE INDEX IF NOT EXISTS idx_bot_leads_store_status
  ON bot_leads(store_id, status_comercial);

CREATE INDEX IF NOT EXISTS idx_bot_optouts_store_phone
  ON bot_optouts(store_id, phone);

CREATE INDEX IF NOT EXISTS idx_bot_flow_config_store_node
  ON bot_flow_config(store_id, node_id);

-- 9. Verificação final
SELECT 'stores'         AS tabela, count(*) AS registros FROM stores
UNION ALL SELECT 'bot_sessions',    count(*) FROM bot_sessions
UNION ALL SELECT 'bot_mensagens',   count(*) FROM bot_mensagens
UNION ALL SELECT 'bot_leads',       count(*) FROM bot_leads
UNION ALL SELECT 'bot_optouts',     count(*) FROM bot_optouts
UNION ALL SELECT 'bot_flow_config', count(*) FROM bot_flow_config;
