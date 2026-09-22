-- ============================================
-- SIN RECREO · CÁPSULAS EDITABLES + DROP DESTACADO
-- Ejecutar en Supabase SQL Editor
-- ============================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create table if not exists public.capsules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  badge_label text not null default 'Activa ahora',
  short_description text,
  hero_title text,
  hero_body text,
  hero_cta_text text not null default 'Ver cápsula',
  is_active boolean not null default true,
  is_featured_drop boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capsules_name_key unique (name),
  constraint capsules_slug_key unique (slug)
);

create or replace function public.set_updated_at_capsules()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_capsules_updated_at on public.capsules;
create trigger trg_capsules_updated_at
before update on public.capsules
for each row
execute function public.set_updated_at_capsules();

-- Solo puede existir una cápsula marcada como Drop destacado.
drop index if exists capsules_single_featured_drop_idx;
create unique index capsules_single_featured_drop_idx
on public.capsules ((1))
where is_featured_drop = true;

alter table public.capsules enable row level security;

-- Lectura pública solo de cápsulas activas.
drop policy if exists "capsules_public_read_active" on public.capsules;
create policy "capsules_public_read_active"
on public.capsules
for select
using (is_active = true);

-- Administración completa para perfiles admin.
drop policy if exists "capsules_admin_all" on public.capsules;
create policy "capsules_admin_all"
on public.capsules
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_admin, false) = true
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_admin, false) = true
  )
);

-- ============================================
-- BOOTSTRAP: crear cápsulas tomando los nombres
-- actuales desde products (si todavía no existen)
-- ============================================
insert into public.capsules (
  name,
  slug,
  badge_label,
  short_description,
  hero_title,
  hero_body,
  hero_cta_text,
  is_active,
  is_featured_drop
)
select distinct
  trim(p.capsule) as name,
  trim(both '-' from regexp_replace(lower(unaccent(trim(p.capsule))), '[^a-z0-9]+', '-', 'g')) as slug,
  'Activa ahora' as badge_label,
  'Completá esta descripción desde el panel de cápsulas.' as short_description,
  'Cápsula "' || trim(p.capsule) || '" — activa ahora' as hero_title,
  'Completá esta presentación desde el panel de cápsulas para que aparezca en Drop destacado.' as hero_body,
  'Ver cápsula' as hero_cta_text,
  true as is_active,
  false as is_featured_drop
from public.products p
where coalesce(trim(p.capsule), '') <> ''
on conflict (name) do nothing;

-- Si existe "Memoria y archivo" y todavía no hay drop destacado,
-- la marcamos como destacada para arrancar.
update public.capsules
set is_featured_drop = true
where name = 'Memoria y archivo'
  and not exists (
    select 1 from public.capsules where is_featured_drop = true
  );

-- Si sigue sin haber destacada, elegimos la primera activa.
with candidate as (
  select id
  from public.capsules
  where is_active = true
  order by created_at asc
  limit 1
)
update public.capsules c
set is_featured_drop = true
from candidate
where c.id = candidate.id
  and not exists (
    select 1 from public.capsules where is_featured_drop = true
  );
