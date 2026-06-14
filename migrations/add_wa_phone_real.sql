-- ═══════════════════════════════════════════════════════════════════════════
-- Captura do telefone REAL nos leads de WhatsApp
-- O WhatsApp passou a endereçar por LID (número oculto). Hoje bot_leads.phone
-- guarda o LID, não o número. Esta coluna guarda o telefone real resolvido
-- (via remoteJidAlt / mapeamento LID→PN do Baileys), sem mexer na chave `phone`
-- usada por toda a pipeline de conversa. É a chave de casamento com as compras
-- do site. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE bot_leads ADD COLUMN IF NOT EXISTS phone_real text;

CREATE INDEX IF NOT EXISTS idx_bot_leads_phone_real
  ON bot_leads(store_id, phone_real)
  WHERE phone_real IS NOT NULL;
