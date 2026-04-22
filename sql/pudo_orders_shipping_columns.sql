create sequence if not exists public.sinrecreo_order_number_seq
  start with 100001
  increment by 1;

alter table public.orders
  add column if not exists public_order_number bigint default nextval('public.sinrecreo_order_number_seq'),
  add column if not exists shipping_provider text,
  add column if not exists shipping_price numeric default 0,
  add column if not exists shipping_data jsonb,
  add column if not exists pudo_order_created boolean default false,
  add column if not exists pudo_order_created_at timestamptz,
  add column if not exists pudo_order_response jsonb,
  add column if not exists pudo_order_error text;

update public.orders
set public_order_number = nextval('public.sinrecreo_order_number_seq')
where public_order_number is null;

create unique index if not exists orders_public_order_number_unique
on public.orders(public_order_number);
