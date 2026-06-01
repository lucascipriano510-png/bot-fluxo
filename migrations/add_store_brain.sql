-- store_brain: cérebro aprendível da loja
CREATE TABLE IF NOT EXISTS store_brain (
  store_id              uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  business_context      text,
  catalog_summary       text,
  price_range           text,
  top_products          jsonb,
  successful_patterns   jsonb,
  objection_map         jsonb,
  closing_signals       jsonb,
  handoff_triggers      jsonb,
  customer_profile      text,
  peak_hours            jsonb,
  avg_conversation_turns int,
  weekly_top_queries    jsonb,
  weekly_objections     jsonb,
  conversion_rate_week  numeric,
  hot_products_now      jsonb,
  last_analysis_at      timestamptz,
  analysis_version      int DEFAULT 0,
  conversations_analyzed int DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE store_brain ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_brain_owner" ON store_brain
  USING (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- Eventos de conversão: captura o que levou a uma venda
CREATE TABLE IF NOT EXISTS store_conversion_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid REFERENCES stores(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  type        text NOT NULL,
  bot_replies jsonb,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE store_conversion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversion_events_owner" ON store_conversion_events
  USING      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  WITH CHECK (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));
