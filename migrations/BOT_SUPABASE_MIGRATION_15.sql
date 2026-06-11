-- P11 — Camada de Inteligência: colunas AI + Kanban automático
-- Rodar UMA VEZ no SQL Editor do Supabase.

-- Colunas de análise de IA em bot_leads
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_score          INTEGER;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_resumo         TEXT;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_intencao       VARCHAR(50);
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_proxima_acao   TEXT;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_temperatura    VARCHAR(10);
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_kanban_sugerida VARCHAR(50);
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_confianca      DECIMAL(3,2);
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_analisado_em   TIMESTAMPTZ;

-- Controle de movimentação manual do Kanban (protege contra sobrescrita por IA)
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS kanban_movido_manualmente_em TIMESTAMPTZ;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS kanban_movido_por            VARCHAR(10) DEFAULT 'manual';
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS kanban_movimento_log         TEXT;

-- P13 — Sales Brain: urgência da análise IA
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS ai_urgencia VARCHAR(10);
