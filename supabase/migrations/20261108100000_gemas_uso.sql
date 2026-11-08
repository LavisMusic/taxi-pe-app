-- =========================================================================
-- Gemas cruzadas, fase 2 (lado Taxi-PE): usar la gema verde en un viaje.
--
--   * Al aceptar la oferta, el pasajero puede usar 1 gema verde: se aparta
--     de su saldo (taxi_gemas_saldos.verdes, que ya se refleja en Caja).
--     Si el viaje se cancela, vuelve a su saldo; si termina, la cobra el
--     conductor (taxi_gemas_conductores.recolectadas).
--   * La gema es un PAGO de su valor (S/ 0.10): la tarifa no cambia, el
--     pasajero paga en mano la tarifa menos la gema.
--   * Reglas: interruptor de gemas prendido, tarifa de S/ 1 o más, saldo
--     de al menos 1, y el conductor sin su tope lleno (recolectadas +
--     apartadas). El tope del conductor es en soles (tope_valor si el
--     tope es 'monto'; con 'porcentaje', S/ 5 hasta que haya membresías).
--   * Todo lo hace la base en el mismo UPDATE que acepta la oferta: si no
--     se puede usar, la oferta se acepta igual, sin gema.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.chat_mensajes add column if not exists gema_usada boolean not null default false;
alter table public.chat_mensajes add column if not exists gema_estado text;
alter table public.chat_mensajes add column if not exists gema_valor numeric(6,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_mensajes_gema_estado_check') then
    alter table public.chat_mensajes add constraint chat_mensajes_gema_estado_check
      check (gema_estado is null or gema_estado in ('apartada', 'cobrada', 'devuelta'));
  end if;
end $$;
create index if not exists chat_mensajes_gema_apartada_idx
  on public.chat_mensajes (conductor_id) where gema_estado = 'apartada';

-- ---------- Gemas que cobró cada conductor --------------------------------
create table if not exists public.taxi_gemas_conductores (
  conductor_id uuid primary key,
  recolectadas integer not null default 0 check (recolectadas >= 0),
  actualizado timestamptz not null default now()
);
alter table public.taxi_gemas_conductores enable row level security;
revoke all on public.taxi_gemas_conductores from anon, authenticated;
grant select on public.taxi_gemas_conductores to authenticated;
drop policy if exists taxi_gemas_conductores_leer on public.taxi_gemas_conductores;
create policy taxi_gemas_conductores_leer on public.taxi_gemas_conductores for select to authenticated
  using (conductor_id = public.taxi_mi_conductor_id() or public.taxi_es_admin());

-- Tope del conductor en gemas (siempre en soles).
create or replace function public.taxi__tope_gemas_conductor()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(floor(
    (case when c.tope_tipo = 'monto' then c.tope_valor else 5 end) / nullif(c.valor, 0)
  ), 0)::integer
  from public.taxi_gemas_config c where c.id;
$$;
revoke execute on function public.taxi__tope_gemas_conductor() from public, anon, authenticated;

-- Cobradas + apartadas en viajes en curso.
create or replace function public.taxi__gemas_conductor_ocupadas(p_conductor uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select recolectadas from public.taxi_gemas_conductores where conductor_id = p_conductor), 0)
       + (select count(*)::integer from public.chat_mensajes
           where conductor_id = p_conductor and gema_estado = 'apartada');
$$;
revoke execute on function public.taxi__gemas_conductor_ocupadas(uuid) from public, anon, authenticated;

-- "S/ 8.00" -> 8.00
create or replace function public.taxi__tarifa_oferta(p_texto text)
returns numeric
language sql
immutable
as $$
  select nullif((regexp_match(replace(coalesce(p_texto, ''), ',', '.'), '(\d+(?:\.\d+)?)'))[1], '')::numeric;
$$;

-- ---------- Apartar / devolver / cobrar -----------------------------------
create or replace function public.fn_chat_oferta_gema_verde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.taxi_gemas_config;
  v_tel text;
  v_saldo integer;
  v_tarifa numeric;
begin
  if new.tipo is distinct from 'oferta' then
    return new;
  end if;
  -- Estas columnas solo las mueve esta función.
  new.gema_estado := old.gema_estado;
  new.gema_valor := old.gema_valor;

  -- Aceptar: el pasajero pidió usar su gema.
  if old.estado_oferta = 'pendiente' and new.estado_oferta = 'aceptada' then
    if not coalesce(new.gema_usada, false) then
      new.gema_usada := false;
      return new;
    end if;
    new.gema_usada := false;
    select * into v_cfg from public.taxi_gemas_config where id;
    v_tarifa := public.taxi__tarifa_oferta(new.mensaje);
    if not coalesce(v_cfg.activo, false) or coalesce(v_tarifa, 0) < 1 then
      return new;
    end if;
    select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
    if v_tel is null then
      return new;
    end if;
    perform pg_advisory_xact_lock(hashtext('gema-conductor:' || new.conductor_id::text));
    if public.taxi__gemas_conductor_ocupadas(new.conductor_id) >= public.taxi__tope_gemas_conductor() then
      return new;
    end if;
    select verdes into v_saldo from public.taxi_gemas_saldos where telefono = v_tel for update;
    if coalesce(v_saldo, 0) < 1 then
      return new;
    end if;
    insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
    values (v_tel, 'verde', -1, 'viaje', 'uso:oferta:' || new.id::text, new.conductor_id)
    on conflict (ref) do nothing;
    if not found then
      return new;
    end if;
    update public.taxi_gemas_saldos set verdes = verdes - 1, actualizado = now() where telefono = v_tel;
    new.gema_usada := true;
    new.gema_estado := 'apartada';
    new.gema_valor := v_cfg.valor;
    return new;
  end if;

  -- Fuera de la aceptación nadie cambia si se usó la gema.
  new.gema_usada := old.gema_usada;

  if old.gema_estado = 'apartada' and new.estado_oferta in ('cancelada', 'rechazada') then
    select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
    if v_tel is not null then
      insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
      values (v_tel, 'verde', 1, 'viaje', 'devolucion:oferta:' || new.id::text, new.conductor_id)
      on conflict (ref) do nothing;
      if found then
        insert into public.taxi_gemas_saldos (telefono, verdes) values (v_tel, 1)
        on conflict (telefono) do update
          set verdes = public.taxi_gemas_saldos.verdes + 1, actualizado = now();
      end if;
    end if;
    new.gema_estado := 'devuelta';
  elsif old.gema_estado = 'apartada' and new.estado_oferta = 'finalizado' then
    insert into public.taxi_gemas_conductores (conductor_id, recolectadas) values (new.conductor_id, 1)
    on conflict (conductor_id) do update
      set recolectadas = public.taxi_gemas_conductores.recolectadas + 1, actualizado = now();
    new.gema_estado := 'cobrada';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_chat_oferta_gema_verde on public.chat_mensajes;
create trigger trg_chat_oferta_gema_verde
  before update on public.chat_mensajes
  for each row execute function public.fn_chat_oferta_gema_verde();

-- Una conversación borrada con la gema todavía apartada: vuelve al pasajero.
create or replace function public.fn_chat_oferta_gema_borrada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
begin
  if old.gema_estado is distinct from 'apartada' then
    return old;
  end if;
  select telefono into v_tel from public.usuarios where id = old.pasajero_id and rol = 'pasajero';
  if v_tel is null then
    return old;
  end if;
  insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
  values (v_tel, 'verde', 1, 'viaje', 'devolucion:oferta:' || old.id::text, old.conductor_id)
  on conflict (ref) do nothing;
  if found then
    insert into public.taxi_gemas_saldos (telefono, verdes) values (v_tel, 1)
    on conflict (telefono) do update
      set verdes = public.taxi_gemas_saldos.verdes + 1, actualizado = now();
  end if;
  return old;
end;
$$;
drop trigger if exists trg_chat_oferta_gema_borrada on public.chat_mensajes;
create trigger trg_chat_oferta_gema_borrada
  after delete on public.chat_mensajes
  for each row execute function public.fn_chat_oferta_gema_borrada();

-- ---------- Lo que ve la app ----------------------------------------------
-- Pasajero, al ver una oferta: ¿puede usar su gema con este conductor?
create or replace function public.taxi_gema_para_oferta(p_conductor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg public.taxi_gemas_config;
  v_tel text;
  v_saldo integer;
begin
  select * into v_cfg from public.taxi_gemas_config where id;
  select telefono into v_tel from public.usuarios where id = auth.uid() and rol = 'pasajero';
  select coalesce(max(verdes), 0) into v_saldo from public.taxi_gemas_saldos where telefono = v_tel;
  return jsonb_build_object(
    'activo', coalesce(v_cfg.activo, false),
    'valor', coalesce(v_cfg.valor, 0.10),
    'saldo', coalesce(v_saldo, 0),
    'lleno', p_conductor_id is not null
             and public.taxi__gemas_conductor_ocupadas(p_conductor_id) >= public.taxi__tope_gemas_conductor()
  );
end;
$$;
revoke execute on function public.taxi_gema_para_oferta(uuid) from public, anon;
grant execute on function public.taxi_gema_para_oferta(uuid) to authenticated;

-- Conductor: su caja de gemas cobradas.
create or replace function public.taxi_mis_gemas_conductor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
  v_cfg public.taxi_gemas_config;
begin
  if v_cond is null then
    raise exception 'Solo conductores.' using errcode = '42501';
  end if;
  select * into v_cfg from public.taxi_gemas_config where id;
  return jsonb_build_object(
    'recolectadas', coalesce((select recolectadas from public.taxi_gemas_conductores where conductor_id = v_cond), 0),
    'apartadas', (select count(*) from public.chat_mensajes where conductor_id = v_cond and gema_estado = 'apartada'),
    'tope', public.taxi__tope_gemas_conductor(),
    'valor', coalesce(v_cfg.valor, 0.10),
    'activo', coalesce(v_cfg.activo, false)
  );
end;
$$;
revoke execute on function public.taxi_mis_gemas_conductor() from public, anon;
grant execute on function public.taxi_mis_gemas_conductor() to authenticated;

notify pgrst, 'reload schema';
