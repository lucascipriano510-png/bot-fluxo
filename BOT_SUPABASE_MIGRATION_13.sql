-- Migration 13: P03 — Modo observador + integração CRM/Kanban via inbox
-- Execute no Supabase SQL Editor
-- Idempotente: ADD COLUMN IF NOT EXISTS, sem DROP, sem alteração de RLS

ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS is_group boolean DEFAULT false;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES bot_leads(id);
ALTER TABLE wa_messages      ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES bot_leads(id);

SELECT 'Migration 13 OK' AS status;
