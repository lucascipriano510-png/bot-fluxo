-- ============================================================
-- BOT_SUPABASE_MIGRATION_6.sql
-- Integração do bot no mesmo Supabase do site
-- Seguro: CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- Sem DROP TABLE, sem DELETE de dados
-- ============================================================

-- ── 1. Tabela stores ─────────────────────────────────────────
create table if not exists stores (
  id              uuid        default gen_random_uuid() primary key,
  slug            text        unique not null,
  name            text        not null,
  whatsapp_number text        unique,
  logo_url        text,
  is_active       boolean     default true,
  created_at      timestamptz default now()
);

-- Fluxo Outlet (idempotente — atualiza se slug já existir)
insert into stores (slug, name, whatsapp_number, is_active)
values ('fluxo-outlet', 'Fluxo Outlet', '5534984148067', true)
on conflict (slug) do update set
  whatsapp_number = excluded.whatsapp_number,
  is_active       = excluded.is_active;

-- ── 2. Criar tabelas bot_* caso ainda não existam ────────────
create table if not exists bot_sessions (
  id            uuid        default gen_random_uuid() primary key,
  store_id      uuid        references stores(id),
  phone         text        not null,
  nome          text,
  current_node  text        not null default 'INICIO',
  context       jsonb       not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists bot_mensagens (
  id        uuid        default gen_random_uuid() primary key,
  store_id  uuid        references stores(id),
  phone     text        not null,
  direcao   text        not null check (direcao in ('entrada','saida')),
  conteudo  text        not null,
  node      text,
  criado_em timestamptz not null default now()
);

create table if not exists bot_leads (
  id               uuid        default gen_random_uuid() primary key,
  store_id         uuid        references stores(id),
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
  atualizado_em    timestamptz default now()
);

create table if not exists bot_optouts (
  id        uuid        default gen_random_uuid() primary key,
  store_id  uuid        references stores(id),
  phone     text        not null,
  criado_em timestamptz not null default now()
);

create table if not exists bot_flow_config (
  id            uuid        default gen_random_uuid() primary key,
  store_id      uuid        references stores(id),
  node_id       text        not null,
  message       text,
  options       jsonb,
  default_next  text,
  atualizado_em timestamptz not null default now()
);

create table if not exists store_bot_settings (
  store_id              uuid        primary key references stores(id) on delete cascade,
  bot_name              text        default 'Assistente',
  tone                  text        default 'amigavel',
  greeting_message      text,
  fallback_message      text,
  human_support_message text,
  is_active             boolean     default true,
  updated_at            timestamptz default now()
);

create table if not exists bot_conversations (
  id             bigserial   primary key,
  store_id       uuid        not null references stores(id) on delete cascade,
  customer_phone text        not null,
  state          text,
  last_message   text,
  updated_at     timestamptz default now()
);

-- ── 3. Adicionar store_id onde possa estar faltando ──────────
-- (no-op se a coluna já existir — criada no passo 2)
alter table bot_sessions    add column if not exists store_id uuid references stores(id);
alter table bot_mensagens   add column if not exists store_id uuid references stores(id);
alter table bot_leads       add column if not exists store_id uuid references stores(id);
alter table bot_optouts     add column if not exists store_id uuid references stores(id);
alter table bot_flow_config add column if not exists store_id uuid references stores(id);

-- ── 4. Popular store_id em registros existentes sem store_id ─
update bot_sessions    set store_id = (select id from stores where slug = 'fluxo-outlet') where store_id is null;
update bot_mensagens   set store_id = (select id from stores where slug = 'fluxo-outlet') where store_id is null;
update bot_leads       set store_id = (select id from stores where slug = 'fluxo-outlet') where store_id is null;
update bot_optouts     set store_id = (select id from stores where slug = 'fluxo-outlet') where store_id is null;
update bot_flow_config set store_id = (select id from stores where slug = 'fluxo-outlet') where store_id is null;

-- ── 5. NOT NULL (todos os registros já têm store_id agora) ───
alter table bot_sessions    alter column store_id set not null;
alter table bot_mensagens   alter column store_id set not null;
alter table bot_leads       alter column store_id set not null;
alter table bot_optouts     alter column store_id set not null;
alter table bot_flow_config alter column store_id set not null;

-- ── 6. Constraints únicas multi-tenant (drop+add = idempotente) ──
alter table bot_sessions    drop constraint if exists bot_sessions_phone_key;
alter table bot_sessions    drop constraint if exists bot_sessions_store_phone_unique;
alter table bot_sessions    add constraint bot_sessions_store_phone_unique
  unique (store_id, phone);

alter table bot_leads       drop constraint if exists bot_leads_phone_key;
alter table bot_leads       drop constraint if exists bot_leads_store_phone_unique;
alter table bot_leads       add constraint bot_leads_store_phone_unique
  unique (store_id, phone);

alter table bot_optouts     drop constraint if exists bot_optouts_phone_key;
alter table bot_optouts     drop constraint if exists bot_optouts_store_phone_unique;
alter table bot_optouts     add constraint bot_optouts_store_phone_unique
  unique (store_id, phone);

alter table bot_flow_config drop constraint if exists bot_flow_config_node_id_key;
alter table bot_flow_config drop constraint if exists bot_flow_config_store_node_unique;
alter table bot_flow_config add constraint bot_flow_config_store_node_unique
  unique (store_id, node_id);

-- ── 7. Índices ────────────────────────────────────────────────
create index if not exists idx_bot_sessions_store_phone    on bot_sessions(store_id, phone);
create index if not exists idx_bot_sessions_atualizado_em  on bot_sessions(atualizado_em desc);
create index if not exists idx_bot_mensagens_store_phone   on bot_mensagens(store_id, phone);
create index if not exists idx_bot_mensagens_criado_em     on bot_mensagens(criado_em desc);
create index if not exists idx_bot_leads_store_id          on bot_leads(store_id);
create index if not exists idx_bot_leads_store_status      on bot_leads(store_id, status_comercial);
create index if not exists idx_bot_optouts_store_phone     on bot_optouts(store_id, phone);
create index if not exists idx_bot_flow_config_store_node  on bot_flow_config(store_id, node_id);
create index if not exists idx_bot_conversations_store     on bot_conversations(store_id, customer_phone);

-- ── 8. RLS ────────────────────────────────────────────────────
alter table stores             enable row level security;
alter table bot_sessions       enable row level security;
alter table bot_mensagens      enable row level security;
alter table bot_leads          enable row level security;
alter table bot_optouts        enable row level security;
alter table bot_flow_config    enable row level security;
alter table store_bot_settings enable row level security;
alter table bot_conversations  enable row level security;

drop policy if exists "service_all_stores"           on stores;
drop policy if exists "service_all_sessions"         on bot_sessions;
drop policy if exists "service_all_mensagens"        on bot_mensagens;
drop policy if exists "service_all_leads"            on bot_leads;
drop policy if exists "service_all_optouts"          on bot_optouts;
drop policy if exists "service_all_flow_config"      on bot_flow_config;
drop policy if exists "service_all_bot_settings"     on store_bot_settings;
drop policy if exists "service_all_conversations"    on bot_conversations;

create policy "service_all_stores"        on stores             for all to service_role using (true) with check (true);
create policy "service_all_sessions"      on bot_sessions       for all to service_role using (true) with check (true);
create policy "service_all_mensagens"     on bot_mensagens      for all to service_role using (true) with check (true);
create policy "service_all_leads"         on bot_leads          for all to service_role using (true) with check (true);
create policy "service_all_optouts"       on bot_optouts        for all to service_role using (true) with check (true);
create policy "service_all_flow_config"   on bot_flow_config    for all to service_role using (true) with check (true);
create policy "service_all_bot_settings"  on store_bot_settings for all to service_role using (true) with check (true);
create policy "service_all_conversations" on bot_conversations  for all to service_role using (true) with check (true);

-- ── 9. Verificação final ──────────────────────────────────────
select
  cols.table_name,
  case when cols.has_store_id then 'store_id OK' else 'store_id FALTANDO' end as status
from (
  select
    t.table_name,
    exists (
      select 1 from information_schema.columns c
      where c.table_name = t.table_name and c.column_name = 'store_id'
    ) as has_store_id
  from (values
    ('bot_sessions'), ('bot_mensagens'), ('bot_leads'),
    ('bot_optouts'), ('bot_flow_config')
  ) as t(table_name)
) cols
order by cols.table_name;
