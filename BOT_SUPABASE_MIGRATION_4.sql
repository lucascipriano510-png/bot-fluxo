-- ============================================================
-- MIGRATION 4 — Arquitetura multi-tenant SaaS
-- Rodar no Supabase DO BOT (não no site)
-- Tudo com IF NOT EXISTS — nenhum dado existente é removido
-- ============================================================

-- ── stores ───────────────────────────────────────────────────
-- id = slug da loja (texto) para simplificar consultas
CREATE TABLE IF NOT EXISTS stores (
  id              TEXT PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  whatsapp_number TEXT,
  logo_url        TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Loja padrão: Fluxo Outlet
INSERT INTO stores (id, slug, name, whatsapp_number, is_active)
VALUES ('fluxo-outlet', 'fluxo-outlet', 'Fluxo Outlet', '5534984148067', true)
ON CONFLICT (id) DO NOTHING;

-- ── products ─────────────────────────────────────────────────
-- Produtos cadastrados no nosso painel (multi-tenant)
CREATE TABLE IF NOT EXISTS products (
  id                BIGSERIAL PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  sku               TEXT,
  price             NUMERIC(10,2),
  promotional_price NUMERIC(10,2),
  category          TEXT,
  subcategory       TEXT,
  product_type      TEXT,
  color             TEXT,
  colors            TEXT[],
  material          TEXT,
  search_tags       TEXT[],
  bot_description   TEXT,
  sizes             JSONB DEFAULT '[]',
  image_url         TEXT,
  extra_images      TEXT[],
  is_active         BOOLEAN DEFAULT true,
  is_kit            BOOLEAN DEFAULT false,
  featured          BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_store_id        ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_store_active    ON products(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_store_category  ON products(store_id, category);
CREATE INDEX IF NOT EXISTS idx_products_store_featured  ON products(store_id, featured);

-- Auto-atualiza updated_at
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_products_updated_at();

-- ── store_bot_settings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_bot_settings (
  store_id              TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  bot_name              TEXT DEFAULT 'Assistente',
  tone                  TEXT DEFAULT 'amigavel',
  greeting_message      TEXT,
  fallback_message      TEXT,
  human_support_message TEXT,
  is_active             BOOLEAN DEFAULT true,
  updated_at            TIMESTAMPTZ DEFAULT now()
);

INSERT INTO store_bot_settings (store_id, bot_name, greeting_message, fallback_message, is_active)
VALUES (
  'fluxo-outlet',
  'Bot Fluxo',
  'Olá! Bem-vindo à Fluxo Outlet! Como posso te ajudar?',
  'Não encontrei esse modelo disponível agora. Quer que eu veja opções parecidas?',
  true
)
ON CONFLICT (store_id) DO NOTHING;

-- ── bot_conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_conversations (
  id             BIGSERIAL PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  state          TEXT,
  last_message   TEXT,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_conversations_store_phone
  ON bot_conversations(store_id, customer_phone);

-- ── orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id             BIGSERIAL PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_name  TEXT,
  customer_phone TEXT NOT NULL,
  status         TEXT DEFAULT 'pending',
  total          NUMERIC(10,2),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);

-- ── RLS (habilitar para segurança, sem bloquear service_role) ─
ALTER TABLE stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;

-- Service role bypassa RLS — anon não acessa
-- (Adicionar políticas específicas quando tiver autenticação de loja)
