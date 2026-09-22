-- SIN RECREO · MÉTRICAS PÚBLICAS PARA HOME
-- Ejecutar en Supabase SQL Editor

create or replace function public.get_store_public_metrics()
returns table (
  active_products bigint,
  active_capsules bigint,
  total_orders bigint
)
language sql
security definer
set search_path = public
as $$
  with active_product_names as (
    select distinct p.id, p.capsule
    from public.products p
    where coalesce(p.is_active, false) = true
      and exists (
        select 1
        from public.product_variants pv
        where pv.product_id = p.id
          and coalesce(pv.is_active, false) = true
          and coalesce(pv.stock, 0) > 0
      )
  ),
  active_capsule_names as (
    select distinct ap.capsule
    from active_product_names ap
    where coalesce(trim(ap.capsule), '') <> ''
  )
  select
    (select count(*) from active_product_names) as active_products,
    (
      select count(*)
      from public.capsules c
      where coalesce(c.is_active, false) = true
        and c.name in (select capsule from active_capsule_names)
    ) as active_capsules,
    (select count(*) from public.orders) as total_orders;
$$;

grant execute on function public.get_store_public_metrics() to anon, authenticated;
