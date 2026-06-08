-- P08 — Auto CRM Pipeline: adiciona message_count e last_message_at em bot_leads
-- Rodar UMA VEZ no SQL Editor do Supabase.

ALTER TABLE bot_leads
  ADD COLUMN IF NOT EXISTS message_count  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

-- Inicializa last_message_at com atualizado_em nos leads existentes
UPDATE bot_leads
SET last_message_at = atualizado_em
WHERE last_message_at IS NULL;
