-- Histórico de compras do cliente
CREATE TABLE IF NOT EXISTS lead_purchases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid REFERENCES stores(id) ON DELETE CASCADE,
  lead_id     uuid REFERENCES bot_leads(id) ON DELETE CASCADE,
  phone       text NOT NULL,
  produto     text,
  valor       numeric,
  data_compra timestamptz DEFAULT now(),
  notes       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE lead_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_purchases_owner" ON lead_purchases
  USING (store_id = ((auth.jwt()->'app_metadata'->>'store_id'))::uuid);

CREATE INDEX IF NOT EXISTS idx_lead_purchases_lead ON lead_purchases(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_purchases_phone ON lead_purchases(store_id, phone);

-- Adicionar campos de score e métricas ao bot_leads
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS conversion_score int DEFAULT 0;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS total_purchases int DEFAULT 0;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS lifetime_value numeric DEFAULT 0;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS first_contact_at timestamptz;
ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;
