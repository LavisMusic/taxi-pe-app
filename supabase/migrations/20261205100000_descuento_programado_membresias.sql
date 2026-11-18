-- =========================================================================
-- Descuento programado en las membresías (Taxi-PE) + realtime.
--
-- paquetes (conductores) y paquetes_recolectores ganan:
--   * precio_base     — el precio sin descuento (lo que configura el admin),
--   * descuento_pct   — 0 a 99,
--   * descuento_desde / descuento_hasta — ventana del descuento (vacías =
--     siempre).
-- La columna `precio` pasa a ser el PRECIO VIGENTE: la calcula la base
-- (precio_base con el descuento si está dentro de su ventana). Así todas las
-- funciones que ya cobran con `precio` (compra del conductor, recarga del
-- recolector, canje de gemas) cobran con descuento sin reescribirlas.
--   * Trigger: al guardar recalcula `precio`. Una app vieja que todavía
--     escribe `precio` directo actualiza el precio_base.
--   * pg_cron cada minuto: cuando empieza o termina una ventana, recalcula.
-- Realtime: las dos tablas se agregan a la publicación (antes no estaban y
-- los modales no se actualizaban en vivo).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- Descuento vigente (0 fuera de la ventana).
create or replace function public.taxi__descuento_vigente(p_pct numeric, p_desde timestamptz, p_hasta timestamptz)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(p_pct, 0) <= 0 then 0
    when p_desde is not null and now() < p_desde then 0
    when p_hasta is not null and now() >= p_hasta then 0
    else least(p_pct, 99)
  end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['paquetes', 'paquetes_recolectores'] loop
    execute format('alter table public.%I add column if not exists precio_base numeric', t);
    execute format('alter table public.%I add column if not exists descuento_pct numeric not null default 0', t);
    execute format('alter table public.%I add column if not exists descuento_desde timestamptz', t);
    execute format('alter table public.%I add column if not exists descuento_hasta timestamptz', t);
    execute format('update public.%I set precio_base = precio where precio_base is null', t);
    if not exists (select 1 from pg_constraint where conname = t || '_descuento_pct_check') then
      execute format('alter table public.%I add constraint %I check (descuento_pct >= 0 and descuento_pct < 100)', t, t || '_descuento_pct_check');
    end if;
  end loop;
end $$;

-- Precio vigente al guardar.
create or replace function public.fn_paquete_precio_vigente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.precio_base := coalesce(new.precio_base, new.precio, 0);
  elsif new.precio_base is not distinct from old.precio_base and new.precio is distinct from old.precio then
    -- App vieja: escribió el precio directo → ese es el precio base.
    new.precio_base := new.precio;
  end if;
  new.descuento_pct := coalesce(new.descuento_pct, 0);
  new.precio := round(coalesce(new.precio_base, 0)
                      * (1 - public.taxi__descuento_vigente(new.descuento_pct, new.descuento_desde, new.descuento_hasta) / 100), 2);
  return new;
end;
$$;
drop trigger if exists trg_paquetes_precio_vigente on public.paquetes;
create trigger trg_paquetes_precio_vigente
  before insert or update on public.paquetes
  for each row execute function public.fn_paquete_precio_vigente();
drop trigger if exists trg_paquetes_recolectores_precio_vigente on public.paquetes_recolectores;
create trigger trg_paquetes_recolectores_precio_vigente
  before insert or update on public.paquetes_recolectores
  for each row execute function public.fn_paquete_precio_vigente();

-- Cuando empieza o termina una ventana: recalcular (el trigger hace la cuenta).
create or replace function public.taxi_actualizar_precios_vigentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  m integer;
begin
  update public.paquetes p set precio_base = p.precio_base
   where p.precio is distinct from round(coalesce(p.precio_base, 0)
         * (1 - public.taxi__descuento_vigente(p.descuento_pct, p.descuento_desde, p.descuento_hasta) / 100), 2);
  get diagnostics m = row_count;
  n := n + m;
  update public.paquetes_recolectores p set precio_base = p.precio_base
   where p.precio is distinct from round(coalesce(p.precio_base, 0)
         * (1 - public.taxi__descuento_vigente(p.descuento_pct, p.descuento_desde, p.descuento_hasta) / 100), 2);
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.taxi_actualizar_precios_vigentes() from public, anon, authenticated;

select cron.unschedule('precios-vigentes-membresias')
where exists (select 1 from cron.job where jobname = 'precios-vigentes-membresias');
select cron.schedule('precios-vigentes-membresias', '* * * * *', $$select public.taxi_actualizar_precios_vigentes()$$);

-- Primera pasada.
select public.taxi_actualizar_precios_vigentes();

-- Realtime de las membresías.
do $$
declare
  t text;
begin
  foreach t in array array['paquetes', 'paquetes_recolectores'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
