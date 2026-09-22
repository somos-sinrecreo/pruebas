-- SIN RECREO · Stock general de remeras lisas
-- Ejecutar en Supabase SQL Editor antes de subir los nuevos HTML.

create extension if not exists pgcrypto;

create table if not exists public.blank_stock (
  id uuid primary key default gen_random_uuid(),
  cut text not null check (cut in ('unisex', 'oversize', 'femenina')),
  color text not null,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blank_stock_unique unique (cut, color, size)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_blank_stock_updated_at on public.blank_stock;
create trigger trg_blank_stock_updated_at
before update on public.blank_stock
for each row execute function public.touch_updated_at();

-- Columnas necesarias para que cada item de pedido sepa qué remera lisa descuenta.
alter table public.order_items
  add column if not exists product_id uuid null references public.products(id) on delete set null,
  add column if not exists product_slug text null,
  add column if not exists sku text null,
  add column if not exists capsule text null,
  add column if not exists fit text null,
  add column if not exists color text null,
  add column if not exists blank_stock_id uuid null references public.blank_stock(id) on delete set null,
  add column if not exists base_price numeric null,
  add column if not exists discount numeric null;

alter table public.orders
  add column if not exists stock_discounted_at timestamptz null;

create index if not exists idx_blank_stock_active on public.blank_stock(is_active, stock);
create index if not exists idx_blank_stock_combo on public.blank_stock(cut, color, size);
create index if not exists idx_order_items_blank_stock on public.order_items(blank_stock_id);

-- Lectura pública: la tienda necesita leer stock disponible.
alter table public.blank_stock enable row level security;

drop policy if exists "Public can read blank stock" on public.blank_stock;
create policy "Public can read blank stock"
on public.blank_stock
for select
to anon, authenticated
using (true);

-- Gestión admin: solo perfiles con is_admin = true pueden modificar stock.
drop policy if exists "Admins can manage blank stock" on public.blank_stock;
create policy "Admins can manage blank stock"
on public.blank_stock
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  )
);

-- Descuento idempotente: si un pedido ya descontó stock, no vuelve a descontar.
create or replace function public.decrement_blank_stock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
begin
  if exists (
    select 1 from public.orders
    where id = p_order_id
      and stock_discounted_at is not null
  ) then
    return;
  end if;

  for item in
    select blank_stock_id, quantity
    from public.order_items
    where order_id = p_order_id
      and blank_stock_id is not null
  loop
    update public.blank_stock
    set stock = greatest(0, stock - coalesce(item.quantity, 1)),
        is_active = greatest(0, stock - coalesce(item.quantity, 1)) > 0
    where id = item.blank_stock_id;
  end loop;

  update public.orders
  set stock_discounted_at = now()
  where id = p_order_id;
end;
$$;

grant execute on function public.decrement_blank_stock_for_order(uuid) to service_role, authenticated;

-- Métricas públicas actualizadas: los productos activos se muestran si existe stock base.
create or replace function public.get_store_public_metrics()
returns table(active_products bigint, active_capsules bigint, total_orders bigint)
language sql
security definer
set search_path = public
as $$
  with has_stock as (
    select exists (
      select 1 from public.blank_stock
      where is_active = true and stock > 0
    ) as ok
  )
  select
    (select count(*) from public.products p, has_stock h where p.is_active = true and h.ok = true) as active_products,
    (select count(distinct p.capsule) from public.products p, has_stock h where p.is_active = true and h.ok = true and p.capsule is not null) as active_capsules,
    (select count(*) from public.orders) as total_orders;
$$;

grant execute on function public.get_store_public_metrics() to anon, authenticated;

-- Carga inicial sugerida. Podés cambiar cantidades/colores después desde el ADMIN.
insert into public.blank_stock (cut, color, size, stock, is_active)
values
  ('unisex','Hueso','S',0,false),
  ('unisex','Hueso','M',0,false),
  ('unisex','Hueso','L',0,false),
  ('unisex','Hueso','XL',0,false),
  ('oversize','Hueso','S',0,false),
  ('oversize','Hueso','M',0,false),
  ('oversize','Hueso','L',0,false),
  ('femenina','Hueso','S',0,false),
  ('femenina','Hueso','M',0,false),
  ('femenina','Hueso','L',0,false)
on conflict (cut, color, size) do nothing;
