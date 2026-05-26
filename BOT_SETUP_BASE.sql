-- ============================================================
-- BOT_SETUP_BASE.sql
-- Setup completo para projeto Supabase novo do bot.
-- Roda ANTES de BOT_SUPABASE_MIGRATION_5.sql
-- Idempotente: pode rodar mais de uma vez sem problema.
-- ============================================================

-- ── stores ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            text        UNIQUE NOT NULL,
  name            text        NOT NULL,
  whatsapp_number text,
  logo_url        text,
  is_active       boolean     DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

-- ── bot_sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_sessions (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         text        NOT NULL,
  nome          text,
  current_node  text        NOT NULL DEFAULT 'INICIO',
  context       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_sessions_phone
  ON bot_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_atualizado_em
  ON bot_sessions(atualizado_em DESC);

-- ── bot_mensagens ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_mensagens (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone     text        NOT NULL,
  direcao   text        NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  conteudo  text        NOT NULL,
  node      text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_mensagens_phone
  ON bot_mensagens(phone);
CREATE INDEX IF NOT EXISTS idx_bot_mensagens_criado_em
  ON bot_mensagens(criado_em DESC);

-- ── bot_leads ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_leads (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone            text        NOT NULL,
  nome             text,
  interesse        text,
  origem           text,
  produto          text,
  tamanho          text,
  estilo           text,
  cidade           text,
  intencao_compra  text,
  status_comercial text        DEFAULT 'FRIO'
                   CHECK (status_comercial IN ('QUENTE','MORNO','FRIO')),
  proxima_acao     text,
  valor_potencial  numeric(10,2),
  status           text        NOT NULL DEFAULT 'novo'
                   CHECK (status IN ('novo','qualificado','encaminhado','concluido')),
  context          jsonb       DEFAULT '{}'::jsonb,
  qualificado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_leads_phone
  ON bot_leads(phone);
CREATE INDEX IF NOT EXISTS idx_bot_leads_status
  ON bot_leads(status);

-- ── bot_optouts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_optouts (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone     text        NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_optouts_phone
  ON bot_optouts(phone);

-- ── bot_flow_config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_flow_config (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id       text        NOT NULL,
  message       text,
  options       jsonb,
  default_next  text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_flow_config_node_id
  ON bot_flow_config(node_id);

-- ── products (catálogo interno — futuro painel SaaS) ──────────
CREATE TABLE IF NOT EXISTS products (
  id                bigserial   PRIMARY KEY,
  store_id          uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  sku               text,
  price             numeric(10,2),
  promotional_price numeric(10,2),
  category          text,
  subcategory       text,
  product_type      text,
  color             text,
  colors            text[],
  material          text,
  search_tags       text[],
  bot_description   text,
  sizes             jsonb       DEFAULT '[]',
  image_url         text,
  extra_images      text[],
  is_active         boolean     DEFAULT true,
  is_kit            boolean     DEFAULT false,
  featured          boolean     DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_store_id       ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_store_active   ON products(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_store_category ON products(store_id, category);
CREATE INDEX IF NOT EXISTS idx_products_store_featured ON products(store_id, featured);

-- ── store_bot_settings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_bot_settings (
  store_id              uuid        PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  bot_name              text        DEFAULT 'Assistente',
  tone                  text        DEFAULT 'amigavel',
  greeting_message      text,
  fallback_message      text,
  human_support_message text,
  is_active             boolean     DEFAULT true,
  updated_at            timestamptz DEFAULT now()
);

-- ── bot_conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_conversations (
  id             bigserial   PRIMARY KEY,
  store_id       uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_phone text        NOT NULL,
  state          text,
  last_message   text,
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_conversations_store_phone
  ON bot_conversations(store_id, customer_phone);

-- ── orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id             bigserial   PRIMARY KEY,
  store_id       uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_name  text,
  customer_phone text        NOT NULL,
  status         text        DEFAULT 'pending',
  total          numeric(10,2),
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);

-- ── Triggers updated_at ───────────────────────────────────────
CREATE OR REPLACE FUNCTION _bot_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION _bot_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_bot_sessions_updated_at    ON bot_sessions;
CREATE TRIGGER trg_bot_sessions_updated_at
  BEFORE UPDATE ON bot_sessions
  FOR EACH ROW EXECUTE FUNCTION _bot_set_updated_at();

DROP TRIGGER IF EXISTS trg_bot_leads_updated_at       ON bot_leads;
CREATE TRIGGER trg_bot_leads_updated_at
  BEFORE UPDATE ON bot_leads
  FOR EACH ROW EXECUTE FUNCTION _bot_set_updated_at();

DROP TRIGGER IF EXISTS trg_bot_flow_config_updated_at ON bot_flow_config;
CREATE TRIGGER trg_bot_flow_config_updated_at
  BEFORE UPDATE ON bot_flow_config
  FOR EACH ROW EXECUTE FUNCTION _bot_set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at        ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION _bot_products_updated_at();

-- ── RLS (service_role tem acesso total) ───────────────────────
ALTER TABLE stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_mensagens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_optouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_flow_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stores'          AND policyname='service_all_stores')          THEN CREATE POLICY "service_all_stores"          ON stores             FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_sessions'    AND policyname='service_all_sessions')        THEN CREATE POLICY "service_all_sessions"        ON bot_sessions       FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_mensagens'   AND policyname='service_all_mensagens')       THEN CREATE POLICY "service_all_mensagens"       ON bot_mensagens      FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_leads'       AND policyname='service_all_leads')           THEN CREATE POLICY "service_all_leads"           ON bot_leads          FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_optouts'     AND policyname='service_all_optouts')         THEN CREATE POLICY "service_all_optouts"         ON bot_optouts        FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_flow_config' AND policyname='service_all_flow_config')     THEN CREATE POLICY "service_all_flow_config"     ON bot_flow_config    FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='products'        AND policyname='service_all_products')        THEN CREATE POLICY "service_all_products"        ON products           FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='store_bot_settings' AND policyname='service_all_bot_settings') THEN CREATE POLICY "service_all_bot_settings"    ON store_bot_settings FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bot_conversations'  AND policyname='service_all_conversations') THEN CREATE POLICY "service_all_conversations"   ON bot_conversations  FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders'          AND policyname='service_all_orders')          THEN CREATE POLICY "service_all_orders"          ON orders             FOR ALL TO service_role USING (true) WITH CHECK (true); END IF;
END $$;

-- ── Verificação ───────────────────────────────────────────────
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'stores','bot_sessions','bot_mensagens','bot_leads',
    'bot_optouts','bot_flow_config','products',
    'store_bot_settings','bot_conversations','orders'
  )
ORDER BY tablename;
-- Esperado: 10 linhas
