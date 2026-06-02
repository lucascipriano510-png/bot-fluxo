-- Campos já adicionados por add_crm_pro.sql (idempotente)
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS first_contact_at timestamptz;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;

-- Índice para o Kanban carregar rápido por estágio
CREATE INDEX IF NOT EXISTS idx_bot_leads_kanban ON bot_leads(store_id, kanban_stage);
