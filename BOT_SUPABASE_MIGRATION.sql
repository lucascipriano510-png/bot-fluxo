-- =====================================================================
-- Migration: campos comerciais em bot_leads
-- Execute no SQL Editor do projeto Supabase do bot
-- =====================================================================

ALTER TABLE bot_leads
  ADD COLUMN IF NOT EXISTS origem            text,
  ADD COLUMN IF NOT EXISTS produto           text,
  ADD COLUMN IF NOT EXISTS tamanho           text,
  ADD COLUMN IF NOT EXISTS estilo            text,
  ADD COLUMN IF NOT EXISTS cidade            text,
  ADD COLUMN IF NOT EXISTS intencao_compra   text,
  ADD COLUMN IF NOT EXISTS status_comercial  text default 'FRIO'
    check (status_comercial in ('QUENTE','MORNO','FRIO')),
  ADD COLUMN IF NOT EXISTS proxima_acao      text,
  ADD COLUMN IF NOT EXISTS atualizado_em     timestamptz default now();

-- Trigger para manter atualizado_em
create or replace function bot_leads_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_bot_leads_updated_at on bot_leads;
create trigger trg_bot_leads_updated_at
  before update on bot_leads
  for each row execute function bot_leads_set_updated_at();

-- =====================================================================
-- PRONTO. Rodar após o BOT_SUPABASE_SETUP.sql original.
-- =====================================================================
