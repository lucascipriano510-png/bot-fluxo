-- =====================================================================
-- Migration 3: flow config editável pelo painel
-- Execute no SQL Editor do projeto Supabase do bot
-- =====================================================================

create table if not exists bot_flow_config (
  id           uuid default gen_random_uuid() primary key,
  node_id      text not null unique,
  message      text,         -- override do texto do bot (null = usa padrão do código)
  options      jsonb,        -- array de {trigger, next, data} | null = usa padrão
  default_next text,         -- override do destino padrão | null = usa padrão
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_bot_flow_config_node_id on bot_flow_config(node_id);

alter table bot_flow_config enable row level security;
create policy "service_all_flow_config" on bot_flow_config
  for all to service_role using (true) with check (true);

create or replace function bot_flow_config_set_updated_at()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end; $$;

drop trigger if exists trg_bot_flow_config_updated_at on bot_flow_config;
create trigger trg_bot_flow_config_updated_at
  before update on bot_flow_config
  for each row execute function bot_flow_config_set_updated_at();

-- =====================================================================
-- PRONTO. Rodar após BOT_SUPABASE_SETUP.sql e as migrations anteriores.
-- =====================================================================
