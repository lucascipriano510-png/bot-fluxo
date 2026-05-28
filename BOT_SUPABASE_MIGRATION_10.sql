-- Migration 10: Evolution API credentials + Respostas Rápidas
-- Execute no Supabase SQL Editor

-- 1. Adiciona colunas de credenciais Evolution API na tabela bot_settings
ALTER TABLE bot_settings
  ADD COLUMN IF NOT EXISTS evolution_url      text,
  ADD COLUMN IF NOT EXISTS evolution_instance text,
  ADD COLUMN IF NOT EXISTS evolution_token    text;

-- 2. Cria tabela de respostas rápidas por loja
CREATE TABLE IF NOT EXISTS bot_respostas_rapidas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  titulo        text        NOT NULL,
  gatilhos      text[]      NOT NULL DEFAULT '{}',
  resposta      text        NOT NULL,
  ativo         boolean     NOT NULL DEFAULT true,
  prioridade    int         NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_respostas_rapidas_store
  ON bot_respostas_rapidas(store_id);

-- 3. Habilita RLS
ALTER TABLE bot_respostas_rapidas ENABLE ROW LEVEL SECURITY;

-- 4. Política service_role (igual às demais tabelas do bot)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bot_respostas_rapidas'
      AND policyname = 'service_role all'
  ) THEN
    CREATE POLICY "service_role all"
      ON bot_respostas_rapidas
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 5. (Opcional) Seed de respostas padrão para lojas que não têm nenhuma
-- Descomente e adapte se quiser popular lojas existentes:
-- INSERT INTO bot_respostas_rapidas (store_id, titulo, gatilhos, resposta, ativo)
-- SELECT id, 'Horário de funcionamento', ARRAY['horário','abre','fecha','funciona'], 'Nosso horário de atendimento está configurado nas nossas configurações.', true
-- FROM stores WHERE id NOT IN (SELECT DISTINCT store_id FROM bot_respostas_rapidas);
