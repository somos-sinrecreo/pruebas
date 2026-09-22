-- Tabla para códigos promocionales de SIN RECREO
-- Ejecutar una vez en Supabase SQL Editor.

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent > 0 and discount_percent <= 100),
  is_active boolean not null default true,
  starts_at date,
  ends_at date,
  max_uses integer check (max_uses is null or max_uses >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists promo_codes_code_upper_key
  on public.promo_codes (upper(code));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_promo_codes_updated_at on public.promo_codes;
create trigger set_promo_codes_updated_at
before update on public.promo_codes
for each row execute function public.set_updated_at();

alter table public.promo_codes enable row level security;

drop policy if exists "promo_codes_public_read_active" on public.promo_codes;
create policy "promo_codes_public_read_active"
on public.promo_codes
for select
using (is_active = true);

drop policy if exists "promo_codes_admin_all" on public.promo_codes;
create policy "promo_codes_admin_all"
on public.promo_codes
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
);

-- Ejemplo opcional para dejar cargado el QR viejo:
-- insert into public.promo_codes (code, description, discount_percent, is_active, starts_at, ends_at)
-- values ('SINRECREO20', 'Promo QR / próxima compra', 20, true, current_date, null)
-- on conflict (code) do update
-- set description = excluded.description,
--     discount_percent = excluded.discount_percent,
--     is_active = excluded.is_active,
--     starts_at = excluded.starts_at,
--     ends_at = excluded.ends_at;
