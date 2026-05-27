-- ============================================================
-- BOT_SUPABASE_MIGRATION_7.sql
-- Invite codes + store status + RLS multi-tenant
-- Seguro: idempotente, sem DROP TABLE, sem DELETE de dados
-- ============================================================

-- ── 1. Campos de status e plano na tabela stores ─────────────
alter table stores
  add column if not exists status        text        not null default 'pending_payment',
  add column if not exists plan          text        not null default 'bot',
  add column if not exists trial_ends_at timestamptz;

-- Constraints de valores válidos
alter table stores
  drop constraint if exists stores_status_check,
  drop constraint if exists stores_plan_check;

alter table stores
  add constraint stores_status_check
    check (status in ('pending_payment','trial','active','suspended','cancelled')),
  add constraint stores_plan_check
    check (plan in ('bot','bot_inventory','full_system'));

-- Ativar loja de desenvolvimento
update stores set status = 'active' where slug = 'fluxo-outlet';

-- ── 2. Tabela invite_codes ────────────────────────────────────
create table if not exists invite_codes (
  id          uuid        primary key default gen_random_uuid(),
  code        text        unique not null,
  status      text        not null default 'active',
  max_uses    integer     not null default 1,
  used_count  integer     not null default 0,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid        references auth.users(id),
  used_by     uuid        references auth.users(id),
  used_at     timestamptz,
  plan        text        not null default 'bot',
  notes       text,
  constraint invite_codes_status_check
    check (status in ('active','used','expired','disabled')),
  constraint invite_codes_plan_check
    check (plan in ('bot','bot_inventory','full_system'))
);

-- ── 3. RLS invite_codes (apenas service_role) ────────────────
alter table invite_codes enable row level security;

drop policy if exists "service_all_invite_codes" on invite_codes;
create policy "service_all_invite_codes" on invite_codes
  for all to service_role using (true) with check (true);

-- ── 4. RLS multi-tenant para authenticated users ─────────────
-- Garante que um usuário autenticado só acessa dados da própria loja
-- (o backend já filtra por store_id, mas RLS é a segunda camada de segurança)

-- stores: usuário vê apenas sua loja
drop policy if exists "auth_own_store" on stores;
create policy "auth_own_store" on stores
  for select to authenticated
  using (id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_sessions
drop policy if exists "auth_own_bot_sessions" on bot_sessions;
create policy "auth_own_bot_sessions" on bot_sessions
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_mensagens
drop policy if exists "auth_own_bot_mensagens" on bot_mensagens;
create policy "auth_own_bot_mensagens" on bot_mensagens
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_leads
drop policy if exists "auth_own_bot_leads" on bot_leads;
create policy "auth_own_bot_leads" on bot_leads
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_optouts
drop policy if exists "auth_own_bot_optouts" on bot_optouts;
create policy "auth_own_bot_optouts" on bot_optouts
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_flow_config
drop policy if exists "auth_own_bot_flow_config" on bot_flow_config;
create policy "auth_own_bot_flow_config" on bot_flow_config
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- bot_settings
alter table bot_settings enable row level security;

drop policy if exists "service_all_bot_settings" on bot_settings;
drop policy if exists "auth_own_bot_settings"    on bot_settings;

create policy "service_all_bot_settings" on bot_settings
  for all to service_role using (true) with check (true);

create policy "auth_own_bot_settings" on bot_settings
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- products (se existir)
alter table products enable row level security;

drop policy if exists "service_all_products" on products;
drop policy if exists "auth_own_products"    on products;

create policy "service_all_products" on products
  for all to service_role using (true) with check (true);

create policy "auth_own_products" on products
  for all to authenticated
  using      (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid))
  with check (store_id = ((auth.jwt()->'app_metadata'->>'store_id')::uuid));

-- ── 5. Verificação final ──────────────────────────────────────
select
  table_name,
  (select count(*) from information_schema.table_constraints tc
   join information_schema.constraint_column_usage ccu using (constraint_name)
   where tc.table_name = t.table_name and tc.constraint_type = 'CHECK') as check_constraints
from (values
  ('stores'), ('invite_codes'), ('bot_sessions'), ('bot_leads'),
  ('bot_mensagens'), ('bot_optouts'), ('bot_flow_config'),
  ('bot_settings'), ('products')
) as t(table_name)
order by table_name;

-- ── Como gerar um código de convite manualmente: ─────────────
--
-- insert into invite_codes (code, max_uses, plan, notes)
-- values ('FLUXO-BETA-001', 1, 'bot', 'Primeiro cliente beta');
--
-- ── Como ativar manualmente uma loja após pagamento: ─────────
--
-- update stores
--   set status = 'active'
-- where slug = 'slug-da-loja';
--
-- ── Como criar um trial (30 dias): ───────────────────────────
--
-- update stores
--   set status = 'trial',
--       trial_ends_at = now() + interval '30 days'
-- where slug = 'slug-da-loja';
