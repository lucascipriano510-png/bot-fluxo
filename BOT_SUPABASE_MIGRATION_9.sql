-- ═══════════════════════════════════════════════════════════════
-- Migration 9: Catálogo Universal — produto_fisico, servico, pacote_combo, orcamento
-- Execute no Supabase SQL Editor
-- Preserva 100% dos produtos existentes (todos ficam com item_type = 'produto_fisico')
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS item_type          text        NOT NULL DEFAULT 'produto_fisico',
  ADD COLUMN IF NOT EXISTS description        text,
  ADD COLUMN IF NOT EXISTS price_type         text        NOT NULL DEFAULT 'fixo',
  ADD COLUMN IF NOT EXISTS duration_minutes   integer,
  ADD COLUMN IF NOT EXISTS requires_scheduling boolean    DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_location   text,
  ADD COLUMN IF NOT EXISTS included_items     text,
  ADD COLUMN IF NOT EXISTS qualification_questions jsonb,
  ADD COLUMN IF NOT EXISTS bot_instructions   text,
  ADD COLUMN IF NOT EXISTS tags               text[],
  ADD COLUMN IF NOT EXISTS variations         jsonb;

-- CHECK constraints
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'products' AND constraint_name = 'products_item_type_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_item_type_check
      CHECK (item_type IN ('produto_fisico','servico','pacote_combo','orcamento'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'products' AND constraint_name = 'products_price_type_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_price_type_check
      CHECK (price_type IN ('fixo','a_partir_de','sob_consulta'));
  END IF;
END $$;

-- Todos os produtos existentes são físicos por padrão (sem perda de dados)
UPDATE products SET item_type = 'produto_fisico' WHERE item_type IS NULL OR item_type = '';

SELECT 'Migration 9 OK — ' || COUNT(*) || ' produtos preservados como produto_fisico' AS status
FROM products WHERE item_type = 'produto_fisico';
