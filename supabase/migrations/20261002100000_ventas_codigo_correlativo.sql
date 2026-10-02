-- Código de operación correlativo y automático para las ventas
-- (TX-000001, TX-000002…), igual que los pagos de planes del super
-- admin de Caja (PL-000001…). Antes la app generaba un código aleatorio
-- (REC-xxxx); ahora lo pone la base, así nunca se repite ni salta.
-- Las ventas existentes se renumeran en orden de fecha.
-- Idempotente. Correr en el SQL Editor de Taxi-PE.

create sequence if not exists public.ventas_codigo_seq;

update public.ventas v
  set codigo_venta = 'TX-' || lpad(x.n::text, 6, '0')
  from (
    select id, row_number() over (order by created_at, id) as n
    from public.ventas
    where codigo_venta is null or codigo_venta !~ '^TX-[0-9]+$'
  ) x
  where v.id = x.id
    and not exists (select 1 from public.ventas where codigo_venta ~ '^TX-[0-9]+$');

select setval(
  'public.ventas_codigo_seq',
  greatest(1, coalesce((select max(substring(codigo_venta from 4)::int) from public.ventas where codigo_venta ~ '^TX-[0-9]+$'), 0)),
  (select count(*) > 0 from public.ventas where codigo_venta ~ '^TX-[0-9]+$')
);

alter table public.ventas
  alter column codigo_venta set default ('TX-' || lpad(nextval('public.ventas_codigo_seq')::text, 6, '0'));
