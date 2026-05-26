-- ================================================================
-- BOT_RESET_CLEAN.sql
-- Apaga e recria SOMENTE as tabelas do bot.
-- NÃO toca em: products, orders, site_config nem nada do site.
-- ================================================================

-- ── 1. Drop na ordem certa (dependentes primeiro) ────────────
drop table if exists bot_flow_config  cascade;
drop table if exists bot_optouts      cascade;
drop table if exists bot_leads        cascade;
drop table if exists bot_mensagens    cascade;
drop table if exists bot_sessions     cascade;
drop table if exists stores           cascade;

-- ── 2. stores ────────────────────────────────────────────────
create table stores (
  id              uuid        default gen_random_uuid() primary key,
  slug            text        unique not null,
  name            text        not null,
  whatsapp_number text        unique,
  logo_url        text,
  is_active       boolean     default true,
  created_at      timestamptz default now()
);

insert into stores (slug, name, whatsapp_number, is_active)
values ('fluxo-outlet', 'Fluxo Outlet', '5534984148067', true);

-- ── 3. bot_sessions ──────────────────────────────────────────
create table bot_sessions (
  id            uuid        default gen_random_uuid() primary key,
  store_id      uuid        not null references stores(id),
  phone         text        not null,
  nome          text,
  current_node  text        not null default 'INICIO',
  context       jsonb       not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (store_id, phone)
);

create index idx_bot_sessions_store_phone on bot_sessions(store_id, phone);
create index idx_bot_sessions_atualizado  on bot_sessions(atualizado_em desc);

-- ── 4. bot_mensagens ─────────────────────────────────────────
create table bot_mensagens (
  id        uuid        default gen_random_uuid() primary key,
  store_id  uuid        not null references stores(id),
  phone     text        not null,
  direcao   text        not null check (direcao in ('entrada','saida')),
  conteudo  text        not null,
  node      text,
  criado_em timestamptz not null default now()
);

create index idx_bot_mensagens_store_phone on bot_mensagens(store_id, phone);
create index idx_bot_mensagens_criado_em   on bot_mensagens(criado_em desc);

-- ── 5. bot_leads ─────────────────────────────────────────────
create table bot_leads (
  id               uuid        default gen_random_uuid() primary key,
  store_id         uuid        not null references stores(id),
  phone            text        not null,
  nome             text,
  interesse        text,
  origem           text,
  produto          text,
  tamanho          text,
  estilo           text,
  cidade           text,
  intencao_compra  text,
  status_comercial text        default 'FRIO'
                   check (status_comercial in ('QUENTE','MORNO','FRIO')),
  proxima_acao     text,
  valor_potencial  numeric(10,2),
  status           text        not null default 'novo'
                   check (status in ('novo','qualificado','encaminhado','concluido')),
  context          jsonb       default '{}'::jsonb,
  qualificado_em   timestamptz not null default now(),
  atualizado_em    timestamptz default now(),
  unique (store_id, phone)
);

create index idx_bot_leads_store_id     on bot_leads(store_id);
create index idx_bot_leads_store_status on bot_leads(store_id, status_comercial);
create index idx_bot_leads_atualizado   on bot_leads(atualizado_em desc);

-- ── 6. bot_optouts ───────────────────────────────────────────
create table bot_optouts (
  id        uuid        default gen_random_uuid() primary key,
  store_id  uuid        not null references stores(id),
  phone     text        not null,
  criado_em timestamptz not null default now(),
  unique (store_id, phone)
);

create index idx_bot_optouts_store_phone on bot_optouts(store_id, phone);

-- ── 7. bot_flow_config ───────────────────────────────────────
create table bot_flow_config (
  id            uuid        default gen_random_uuid() primary key,
  store_id      uuid        not null references stores(id),
  node_id       text        not null,
  message       text,
  options       jsonb,
  default_next  text,
  atualizado_em timestamptz not null default now(),
  unique (store_id, node_id)
);

create index idx_bot_flow_config_store_node on bot_flow_config(store_id, node_id);

-- ── 8. RLS ───────────────────────────────────────────────────
alter table stores          enable row level security;
alter table bot_sessions    enable row level security;
alter table bot_mensagens   enable row level security;
alter table bot_leads       enable row level security;
alter table bot_optouts     enable row level security;
alter table bot_flow_config enable row level security;

create policy "service_all_stores"      on stores          for all to service_role using (true) with check (true);
create policy "service_all_sessions"    on bot_sessions    for all to service_role using (true) with check (true);
create policy "service_all_mensagens"   on bot_mensagens   for all to service_role using (true) with check (true);
create policy "service_all_leads"       on bot_leads       for all to service_role using (true) with check (true);
create policy "service_all_optouts"     on bot_optouts     for all to service_role using (true) with check (true);
create policy "service_all_flow_config" on bot_flow_config for all to service_role using (true) with check (true);

-- ── 9. Confirmação ───────────────────────────────────────────
select
  t.table_name,
  (select count(*)
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = t.table_name
  )::int as colunas,
  'OK' as status
from (values
  ('stores'),('bot_sessions'),('bot_mensagens'),
  ('bot_leads'),('bot_optouts'),('bot_flow_config')
) as t(table_name)
order by t.table_name;
