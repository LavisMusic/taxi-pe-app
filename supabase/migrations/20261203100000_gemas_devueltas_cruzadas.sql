-- =========================================================================
-- Gemas devueltas sin festejo, en las dos apps (Taxi-PE). Pareja de la
-- migración de Caja 0165_gemas_devueltas.sql.
--
-- 20261202100000 contaba las verdes devueltas en usuarios. Ahora los
-- contadores viven junto al saldo (taxi_gemas_saldos) y se copian a usuarios
-- en el mismo update que el saldo:
--   * verdes_devueltas: sube al devolver la gema de un viaje cancelado (en
--     el mismo update que el saldo) y viaja a Caja en 'taxi.gemas_verdes'
--     como 'devueltas' — así Caja tampoco la festeja.
--   * celestes_devueltas: copia de Caja ('caja.gemas_celestes' trae
--     'devueltas': pedidos o ventas canceladas con gema).
--   * usuarios.gemas_celestes_devueltas (nueva) para la app del pasajero.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_gemas_saldos add column if not exists verdes_devueltas integer not null default 0;
alter table public.taxi_gemas_saldos add column if not exists celestes_devueltas integer not null default 0;
alter table public.usuarios add column if not exists gemas_verdes_devueltas integer not null default 0;
alter table public.usuarios add column if not exists gemas_celestes_devueltas integer not null default 0;
grant select (gemas_verdes_devueltas, gemas_celestes_devueltas) on public.usuarios to authenticated;

-- Lo que 20261202100000 ya contó en usuarios pasa al saldo.
update public.taxi_gemas_saldos s
   set verdes_devueltas = greatest(s.verdes_devueltas, u.dev)
  from (select telefono, max(gemas_verdes_devueltas) as dev
          from public.usuarios where rol = 'pasajero' and telefono is not null
         group by telefono) u
 where u.telefono = s.telefono and u.dev > s.verdes_devueltas;

-- Nadie las cambia desde la app.
create or replace function public.fn_usuarios_gemas_protegidas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_s record;
begin
  if tg_op = 'INSERT' then
    if new.rol = 'pasajero' and new.telefono is not null then
      select * into v_s from public.taxi__gemas_de(new.telefono);
      new.gemas_verdes := coalesce(v_s.verdes, 0);
      new.gemas_celestes := coalesce(v_s.celestes, 0);
    else
      new.gemas_verdes := 0;
      new.gemas_celestes := 0;
    end if;
    new.gemas_verdes_devueltas := 0;
    new.gemas_celestes_devueltas := 0;
    return new;
  end if;
  if current_user in ('anon', 'authenticated') then
    new.gemas_verdes := old.gemas_verdes;
    new.gemas_celestes := old.gemas_celestes;
    new.gemas_verdes_devueltas := old.gemas_verdes_devueltas;
    new.gemas_celestes_devueltas := old.gemas_celestes_devueltas;
  end if;
  return new;
end;
$$;

-- Saldo -> copia en usuarios (con las devueltas) + verdes a Caja.
create or replace function public.fn_taxi_gemas_saldos_espejar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios
     set gemas_verdes = new.verdes, gemas_celestes = new.celestes,
         gemas_verdes_devueltas = new.verdes_devueltas, gemas_celestes_devueltas = new.celestes_devueltas
   where telefono = new.telefono and rol = 'pasajero'
     and (gemas_verdes is distinct from new.verdes or gemas_celestes is distinct from new.celestes
          or gemas_verdes_devueltas is distinct from new.verdes_devueltas
          or gemas_celestes_devueltas is distinct from new.celestes_devueltas);

  if tg_op = 'INSERT' or new.verdes is distinct from old.verdes
     or new.verdes_devueltas is distinct from old.verdes_devueltas then
    begin
      perform public.fn_webhook_emitir('taxi.gemas_verdes', 'caja', jsonb_build_object(
        'telefono', new.telefono, 'verdes', new.verdes, 'devueltas', new.verdes_devueltas,
        'version', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ));
    exception when others then
      raise warning 'fn_taxi_gemas_saldos_espejar: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

-- Uso y devolución de la gema del viaje: la devolución suma el saldo y el
-- contador en el mismo update (ya no toca usuarios aparte).
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
        insert into public.taxi_gemas_saldos (telefono, verdes, verdes_devueltas) values (v_tel, 1, 1)
        on conflict (telefono) do update
          set verdes = public.taxi_gemas_saldos.verdes + 1,
              verdes_devueltas = public.taxi_gemas_saldos.verdes_devueltas + 1,
              actualizado = now();
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

-- Avisos que llegan de Caja: 'caja.gemas_celestes' ahora trae 'devueltas'.
create or replace function public.rpc_webhook_caja_gemas(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_payload->>'event_type';
  v_data jsonb := p_payload->'data';
  v_tel text := nullif(trim(coalesce(v_data->>'telefono', '')), '');
  v_delta integer;
  v_id uuid;
  v_version timestamptz;
  v_dev integer := nullif(v_data->>'devueltas', '')::integer;
begin
  if v_tipo = 'caja.gemas_config' then
    v_version := (v_data->>'version')::timestamptz;
    update public.taxi_gemas_config
       set valor = coalesce((v_data->>'valor')::numeric, valor),
           tope_tipo = coalesce(v_data->>'tope_tipo', tope_tipo),
           tope_valor = coalesce((v_data->>'tope_valor')::numeric, tope_valor),
           tope_conductor_tipo = coalesce(v_data->>'tope_conductor_tipo', tope_conductor_tipo),
           tope_conductor_valor = coalesce((v_data->>'tope_conductor_valor')::numeric, tope_conductor_valor),
           tope_recolector_tipo = coalesce(v_data->>'tope_recolector_tipo', tope_recolector_tipo),
           tope_recolector_valor = coalesce((v_data->>'tope_recolector_valor')::numeric, tope_recolector_valor),
           activo = coalesce((v_data->>'activo')::boolean, activo),
           version = v_version
     where id and (version is null or v_version is null or v_version > version);
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tel is null then
    return jsonb_build_object('status', 'invalido');
  end if;

  if v_tipo = 'caja.gema_verde' then
    v_delta := coalesce((v_data->>'delta')::integer, 0);
    if v_delta not in (1, -1) or coalesce(v_data->>'ref', '') = '' then
      return jsonb_build_object('status', 'invalido');
    end if;
    insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref)
    values (v_tel, 'verde', v_delta, 'compra', v_data->>'ref')
    on conflict (ref) do nothing
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('status', 'duplicado');
    end if;
    insert into public.taxi_gemas_saldos (telefono, verdes)
    values (v_tel, greatest(v_delta, 0))
    on conflict (telefono) do update
      set verdes = greatest(public.taxi_gemas_saldos.verdes + v_delta, 0),
          actualizado = now();
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tipo = 'caja.gemas_celestes' then
    v_version := (v_data->>'version')::timestamptz;
    insert into public.taxi_gemas_saldos (telefono, celestes, celestes_version, celestes_devueltas)
    values (v_tel, greatest(coalesce((v_data->>'celestes')::integer, 0), 0), v_version, greatest(coalesce(v_dev, 0), 0))
    on conflict (telefono) do update
      set celestes = excluded.celestes,
          celestes_version = excluded.celestes_version,
          celestes_devueltas = case when v_dev is null then public.taxi_gemas_saldos.celestes_devueltas else excluded.celestes_devueltas end,
          actualizado = now()
      where public.taxi_gemas_saldos.celestes_version is null
         or excluded.celestes_version is null
         or excluded.celestes_version > public.taxi_gemas_saldos.celestes_version;
    return jsonb_build_object('status', 'ok');
  end if;

  return jsonb_build_object('status', 'invalido');
end;
$$;
revoke execute on function public.rpc_webhook_caja_gemas(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_gemas(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
