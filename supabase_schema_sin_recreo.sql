-- SIN RECREO · Supabase base schema
-- Ejecutalo en SQL Editor de Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_admin = true
  );
$$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sku text,
  capsule text not null,
  title text not null,
  description text default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  cut text not null default 'Unisex',
  sort_date date not null default current_date,
  featured boolean not null default false,
  art_type text not null default 'poster',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  position integer not null check (position between 1 and 3),
  alt_text text,
  created_at timestamptz not null default now(),
  unique(product_id, position)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  mp_link text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(product_id, size)
);

create index if not exists idx_products_active_sort on public.products(is_active, featured, sort_date desc);
create index if not exists idx_product_images_product on public.product_images(product_id, position);
create index if not exists idx_product_variants_product on public.product_variants(product_id, is_active);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;

drop policy if exists "profiles_self_or_admin_select" on public.profiles;
create policy "profiles_self_or_admin_select"
on public.profiles
for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "public_products_read" on public.products;
create policy "public_products_read"
on public.products
for select
using (is_active = true);

drop policy if exists "admin_products_all" on public.products;
create policy "admin_products_all"
on public.products
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "public_product_images_read" on public.product_images;
create policy "public_product_images_read"
on public.product_images
for select
using (
  exists (
    select 1
    from public.products p
    where p.id = product_images.product_id
      and p.is_active = true
  )
);

drop policy if exists "admin_product_images_all" on public.product_images;
create policy "admin_product_images_all"
on public.product_images
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "public_product_variants_read" on public.product_variants;
create policy "public_product_variants_read"
on public.product_variants
for select
using (
  is_active = true
  and exists (
    select 1
    from public.products p
    where p.id = product_variants.product_id
      and p.is_active = true
  )
);

drop policy if exists "admin_product_variants_all" on public.product_variants;
create policy "admin_product_variants_all"
on public.product_variants
for all
using (public.is_admin())
with check (public.is_admin());

-- Storage bucket para imágenes
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "public_read_product_images_bucket" on storage.objects;
create policy "public_read_product_images_bucket"
on storage.objects
for select
using (bucket_id = 'product-images');

drop policy if exists "admin_insert_product_images_bucket" on storage.objects;
create policy "admin_insert_product_images_bucket"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_admin()
);

drop policy if exists "admin_update_product_images_bucket" on storage.objects;
create policy "admin_update_product_images_bucket"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_admin()
)
with check (
  bucket_id = 'product-images'
  and public.is_admin()
);

drop policy if exists "admin_delete_product_images_bucket" on storage.objects;
create policy "admin_delete_product_images_bucket"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_admin()
);

-- Cómo volver admin al primer usuario:
-- 1) Registrate desde el panel admin o desde Supabase Auth.
-- 2) Ejecutá:
-- update public.profiles set is_admin = true where email = 'TUEMAIL@DOMINIO.COM';
