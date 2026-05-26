-- ============================================================
-- BOT_SETUP_BASE.sql  (rodar ANTES da Migration 5)
-- Projeto Supabase novo — cria todas as tabelas do zero
-- ============================================================

-- ── stores ───────────────────────────────────────────────────
create table if not exists stores (
  id              uuid        default gen_random_uuid() primary key,
  slug            text        unique not null,
  name            text        not null,
  whatsapp_number text,
  logo_url        text,
  is_active       boolean     default true,
  created_at      timestamptz default now()
);

-- ── bot_sessions ──────────────────────────────────────────────
create table if not exists bot_sessions (
  id            uuid        default gen_random_uuid() primary key,
  phone         text        not null,
  nome          text,
  current_node  text        not null default 'INICIO',
  context       jsonb       not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_bot_sessions_phone
  on bot_sessions(phone);
create index if not exists idx_bot_sessions_atualizado_em
  on bot_sessions(atualizado_em desc);

-- ── bot_mensagens ─────────────────────────────────────────────
create table if not exists bot_mensagens (
  id        uuid        default gen_random_uuid() primary key,
  phone     text        not null,
  direcao   text        not null check (direcao in ('entrada','saida')),
  conteudo  text        not null,
  node      text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_bot_mensagens_phone
  on bot_mensagens(phone);
create index if not exists idx_bot_mensagens_criado_em
  on bot_mensagens(criado_em desc);

-- ── bot_leads ─────────────────────────────────────────────────
create table if not exists bot_leads (
  id               uuid        default gen_random_uuid() primary key,
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

create index if not exists idx_bot_leads_phone  on bot_leads(phone);
create index if not exists idx_bot_leads_status on bot_leads(status);

-- ── bot_optouts ───────────────────────────────────────────────
create table if not exists bot_optouts (
  id        uuid        default gen_random_uuid() primary key,
  phone     text        not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_bot_optouts_phone on bot_optouts(phone);

-- ── bot_flow_config ───────────────────────────────────────────
create table if not exists bot_flow_config (
  id            uuid        default gen_random_uuid() primary key,
  node_id       text        not null,
  message       text,
  options       jsonb,
  default_next  text,
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_bot_flow_config_node_id
  on bot_flow_config(node_id);

-- ── products ──────────────────────────────────────────────────
create table if not exists products (
  id                bigserial    primary key,
  store_id          uuid         not null references stores(id) on delete cascade,
  name              text         not null,
  sku               text,
  price             numeric(10,2),
  promotional_price numeric(10,2),
  category          text,
  subcategory       text,
  product_type      text,
  color             text,
  colors            text[],
  material          text,
  search_tags       text[],
  bot_description   text,
  sizes             jsonb        default '[]',
  image_url         text,
  extra_images      text[],
  is_active         boolean      default true,
  is_kit            boolean      default false,
  featured          boolean      default false,
  created_at        timestamptz  default now(),
  updated_at        timestamptz  default now()
);

create index if not exists idx_products_store_id       on products(store_id);
create index if not exists idx_products_store_active   on products(store_id, is_active);
create index if not exists idx_products_store_category on products(store_id, category);
create index if not exists idx_products_store_featured on products(store_id, featured);

-- ── store_bot_settings ────────────────────────────────────────
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

-- ── bot_conversations ─────────────────────────────────────────
create table if not exists bot_conversations (
  id             bigserial   primary key,
  store_id       uuid        not null references stores(id) on delete cascade,
  customer_phone text        not null,
  state          text,
  last_message   text,
  updated_at     timestamptz default now()
);

create index if not exists idx_bot_conversations_store_phone
  on bot_conversations(store_id, customer_phone);

-- ── orders ────────────────────────────────────────────────────
create table if not exists orders (
  id             bigserial    primary key,
  store_id       uuid         not null references stores(id) on delete cascade,
  customer_name  text,
  customer_phone text         not null,
  status         text         default 'pending',
  total          numeric(10,2),
  created_at     timestamptz  default now()
);

create index if not exists idx_orders_store_id on orders(store_id);

-- ── Triggers updated_at ───────────────────────────────────────
create or replace function _bot_set_updated_at()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end; $$;

create or replace function _bot_products_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_bot_sessions_updated_at    on bot_sessions;
create trigger trg_bot_sessions_updated_at
  before update on bot_sessions
  for each row execute function _bot_set_updated_at();

drop trigger if exists trg_bot_leads_updated_at       on bot_leads;
create trigger trg_bot_leads_updated_at
  before update on bot_leads
  for each row execute function _bot_set_updated_at();

drop trigger if exists trg_bot_flow_config_updated_at on bot_flow_config;
create trigger trg_bot_flow_config_updated_at
  before update on bot_flow_config
  for each row execute function _bot_set_updated_at();

drop trigger if exists trg_products_updated_at        on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function _bot_products_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
alter table stores             enable row level security;
alter table bot_sessions       enable row level security;
alter table bot_mensagens      enable row level security;
alter table bot_leads          enable row level security;
alter table bot_optouts        enable row level security;
alter table bot_flow_config    enable row level security;
alter table products           enable row level security;
alter table store_bot_settings enable row level security;
alter table bot_conversations  enable row level security;
alter table orders             enable row level security;

drop policy if exists "service_all_stores"          on stores;
drop policy if exists "service_all_sessions"        on bot_sessions;
drop policy if exists "service_all_mensagens"       on bot_mensagens;
drop policy if exists "service_all_leads"           on bot_leads;
drop policy if exists "service_all_optouts"         on bot_optouts;
drop policy if exists "service_all_flow_config"     on bot_flow_config;
drop policy if exists "service_all_products"        on products;
drop policy if exists "service_all_bot_settings"    on store_bot_settings;
drop policy if exists "service_all_conversations"   on bot_conversations;
drop policy if exists "service_all_orders"          on orders;

create policy "service_all_stores"        on stores             for all to service_role using (true) with check (true);
create policy "service_all_sessions"      on bot_sessions       for all to service_role using (true) with check (true);
create policy "service_all_mensagens"     on bot_mensagens      for all to service_role using (true) with check (true);
create policy "service_all_leads"         on bot_leads          for all to service_role using (true) with check (true);
create policy "service_all_optouts"       on bot_optouts        for all to service_role using (true) with check (true);
create policy "service_all_flow_config"   on bot_flow_config    for all to service_role using (true) with check (true);
create policy "service_all_products"      on products           for all to service_role using (true) with check (true);
create policy "service_all_bot_settings"  on store_bot_settings for all to service_role using (true) with check (true);
create policy "service_all_conversations" on bot_conversations  for all to service_role using (true) with check (true);
create policy "service_all_orders"        on orders             for all to service_role using (true) with check (true);

-- ── Confirmação ───────────────────────────────────────────────
select tablename from pg_tables
where schemaname = 'public'
  and tablename in (
    'stores','bot_sessions','bot_mensagens','bot_leads',
    'bot_optouts','bot_flow_config','products',
    'store_bot_settings','bot_conversations','orders'
  )
order by tablename;
