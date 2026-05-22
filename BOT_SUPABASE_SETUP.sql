-- =====================================================================
-- bot-fluxo — Setup do banco de dados próprio (Supabase independente)
-- Execute no SQL Editor do seu projeto Supabase do bot
-- =====================================================================

-- 1. Sessões de conversa (estado atual de cada usuário no fluxo)
create table if not exists bot_sessions (
  id            uuid default gen_random_uuid() primary key,
  phone         text not null unique,
  nome          text,
  current_node  text not null default 'INICIO',
  context       jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_bot_sessions_phone on bot_sessions(phone);

-- 2. Histórico de mensagens (entrada e saída)
create table if not exists bot_mensagens (
  id         uuid default gen_random_uuid() primary key,
  phone      text not null,
  direcao    text not null check (direcao in ('entrada', 'saida')),
  conteudo   text not null,
  node       text,
  criado_em  timestamptz not null default now()
);

create index if not exists idx_bot_mensagens_phone     on bot_mensagens(phone);
create index if not exists idx_bot_mensagens_criado_em on bot_mensagens(criado_em desc);

-- 3. Leads qualificados pelo bot
create table if not exists bot_leads (
  id               uuid default gen_random_uuid() primary key,
  phone            text not null unique,
  nome             text,
  interesse        text,
  valor_potencial  numeric(10,2),
  status           text not null default 'novo'
                   check (status in ('novo', 'qualificado', 'encaminhado', 'concluido')),
  context          jsonb default '{}'::jsonb,
  qualificado_em   timestamptz not null default now()
);

create index if not exists idx_bot_leads_status on bot_leads(status);
create index if not exists idx_bot_leads_phone  on bot_leads(phone);

-- 4. Trigger para manter atualizado_em em bot_sessions
create or replace function bot_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_bot_sessions_updated_at on bot_sessions;
create trigger trg_bot_sessions_updated_at
  before update on bot_sessions
  for each row execute function bot_set_updated_at();

-- 5. RLS
alter table bot_sessions  enable row level security;
alter table bot_mensagens enable row level security;
alter table bot_leads     enable row level security;

-- service_role tem acesso total (o bot roda com service key)
create policy "service_all_sessions"  on bot_sessions  for all to service_role using (true) with check (true);
create policy "service_all_mensagens" on bot_mensagens for all to service_role using (true) with check (true);
create policy "service_all_leads"     on bot_leads     for all to service_role using (true) with check (true);

-- =====================================================================
-- PRONTO. Tabelas criadas e isoladas do banco do site.
-- Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no .env do bot.
-- =====================================================================
