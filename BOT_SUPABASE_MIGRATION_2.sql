-- =====================================================================
-- Migration 2: opt-outs (LGPD) + session timeout index
-- Execute no SQL Editor do projeto Supabase do bot
-- Requer: BOT_SUPABASE_SETUP.sql + BOT_SUPABASE_MIGRATION.sql
-- =====================================================================

-- 1. Tabela de opt-outs (usuários que solicitaram parar de receber mensagens)
create table if not exists bot_optouts (
  id        uuid default gen_random_uuid() primary key,
  phone     text not null unique,
  criado_em timestamptz not null default now()
);

create index if not exists idx_bot_optouts_phone on bot_optouts(phone);

-- RLS
alter table bot_optouts enable row level security;
create policy "service_all_optouts" on bot_optouts
  for all to service_role using (true) with check (true);

-- 2. Índice para consultas de sessões por tempo (session timeout)
create index if not exists idx_bot_sessions_atualizado_em
  on bot_sessions(atualizado_em desc);

-- =====================================================================
-- PRONTO.
-- =====================================================================
