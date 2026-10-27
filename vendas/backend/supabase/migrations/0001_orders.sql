-- ============================================================
-- PROFESSOR DO FUTURO — VENDAS
-- Migração 0001: tabela orders (registro de compras)
-- ------------------------------------------------------------
-- Usada pelo webhook do Mercado Pago para registrar cada compra
-- e garantir que NENHUMA conta seja criada duas vezes (anti-duplicado).
--
-- Para aplicar: Supabase Dashboard > SQL Editor > rodar este script.
-- (ou: supabase db push)
-- ============================================================

create extension if not exists "pgcrypto";

-- Tabela de pedidos
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  payment_id    text not null,          -- id do pagamento no Mercado Pago
  status        text not null,          -- approved / pending / rejected / etc
  email         text not null,
  customer_name text,
  product_id    text not null,
  amount        numeric(10,2),
  currency      text default 'BRL',
  meta          jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Anti-duplicação: cada pagamento do Mercado Pago pode gerar o mesmo
-- payment_id; o índice único impede inserir duas linhas e, assim,
-- impede a criação de duas contas para a MESMA compra.
create unique index if not exists orders_payment_id_unique
  on public.orders (payment_id);

create index if not exists orders_email_idx on public.orders (email);

-- row level security: dados manipulam-se via Edge Functions (service_role).
alter table public.orders enable row level security;

-- Se preferir expor leitura apenas para o dono (opcional):
-- create policy "select own" on public.orders
--   for select using (auth.uid() is not null);