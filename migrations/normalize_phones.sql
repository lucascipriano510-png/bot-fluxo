-- Normaliza phones para formato padrao: so digitos, DDI 55 prefixado para BR.
-- Rodar UMA VEZ no SQL Editor do Supabase apos o deploy do P10.

UPDATE wa_conversations
SET phone = '55' || regexp_replace(phone, '[^0-9]', '', 'g')
WHERE regexp_replace(phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$'
  AND phone NOT LIKE '55%';

UPDATE wa_messages
SET phone = '55' || regexp_replace(phone, '[^0-9]', '', 'g')
WHERE regexp_replace(phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$'
  AND phone NOT LIKE '55%';

UPDATE bot_leads
SET phone = '55' || regexp_replace(phone, '[^0-9]', '', 'g')
WHERE regexp_replace(phone, '[^0-9]', '', 'g') ~ '^[0-9]{10,11}$'
  AND phone NOT LIKE '55%';
