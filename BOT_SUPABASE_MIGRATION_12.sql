-- ── wa_messages: mensagens WhatsApp direto via Baileys ──────────────────────
CREATE TABLE IF NOT EXISTS wa_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid REFERENCES stores(id) ON DELETE CASCADE,
  phone      text NOT NULL,
  direction  text NOT NULL CHECK (direction IN ('in', 'out')),
  text       text NOT NULL,
  timestamp  timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_messages_owner" ON wa_messages
  USING      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_wa_messages_phone
  ON wa_messages(store_id, phone, timestamp DESC);

-- ── wa_conversations: lista de conversas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid REFERENCES stores(id) ON DELETE CASCADE,
  phone        text NOT NULL,
  name         text,
  last_message text,
  last_time    timestamptz DEFAULT now(),
  unread_count int DEFAULT 0,
  UNIQUE(store_id, phone)
);

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_conversations_owner" ON wa_conversations
  USING      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));
