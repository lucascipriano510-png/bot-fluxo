-- ═══════════════════════════════════════════════════════════════
-- Migration 8: CRM, Kanban Stage, Atendimento Humano, Products Stock
-- Execute no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. bot_sessions: coluna para atendimento humano ativo
ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS humano_ativo boolean DEFAULT false;

-- 2. bot_leads: estágio do kanban (separado de status_comercial)
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS kanban_stage text NOT NULL DEFAULT 'novo';
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS notes text;

-- Preenche kanban_stage inicial com base no status_comercial existente
UPDATE bot_leads SET kanban_stage =
  CASE
    WHEN status_comercial = 'QUENTE' AND status = 'encaminhado' THEN 'pagamento'
    WHEN status_comercial = 'QUENTE' THEN 'interessado'
    WHEN status_comercial = 'MORNO' THEN 'escolhendo'
    WHEN status_comercial = 'FRIO'  THEN 'finalizado'
    ELSE 'novo'
  END
WHERE kanban_stage = 'novo';

-- 3. products: garante colunas stock e image_url
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock integer DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Confirmar
SELECT 'Migration 8 OK' AS status;
