-- =========================================================================
-- Gemas cruzadas, fase 1 (lado Taxi-PE).
--
--   * 💚 Verde: la gana el cliente comprando en un negocio de Caja Tonazo
--     y la gasta acá (descuento en un viaje), así que su saldo de verdad
--     vive ACÁ (taxi_gemas_saldos.verdes). Llega con 'caja.gema_verde' y
--     se le devuelve el saldo a Caja con 'taxi.gemas_verdes'.
--   * 🩵 Celeste: la gana el pasajero al terminar un viaje (la oferta pasa
--     de 'aceptada' a 'finalizado') y se gasta en los negocios, así que su
--     saldo de verdad vive en Caja: acá solo se registra lo ganado (tope
--     diario) y se avisa con 'taxi.gema_celeste'. Caja devuelve el saldo
--     con 'caja.gemas_celestes'.
--   * Las dos se copian a usuarios.gemas_verdes/gemas_celestes del
--     pasajero de ese teléfono (la app las lee en vivo de su propia fila).
--   * La configuración (valor, tope, interruptor) la manda Caja con
--     'caja.gemas_config'.
--
-- Límite contra abusos: un pasajero gana como máximo 5 celestes por día y
-- 2 por día con el mismo conductor.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Configuración (copia de la de Caja) ---------------------------
create table if not exists public.taxi_gemas_config (
  id boolean primary key default true check (id),
  valor numeric(6,2) not null default 0.10,
  tope_tipo text not null default 'monto' check (tope_tipo in ('monto', 'porcentaje')),
  tope_valor numeric(8,2) not null default 5,
  activo boolean not null default true,
  version timestamptz
);
insert into public.taxi_gemas_config (id) values (true) on conflict (id) do nothing;
alter table public.taxi_gemas_config enable row level security;
drop policy if exists taxi_gemas_config_leer on public.taxi_gemas_config;
create policy taxi_gemas_config_leer on public.taxi_gemas_config for select using (true);
revoke insert, update, delete on public.taxi_gemas_config from anon, authenticated;
grant select on public.taxi_gemas_config to anon, authenticated;

-- ---------- Saldos y registro ---------------------------------------------
create table if not exists public.taxi_gemas_saldos (
  telefono text primary key,
  verdes integer not null default 0 check (verdes >= 0),
  celestes integer not null default 0 check (celestes >= 0),
  celestes_version timestamptz,
  actualizado timestamptz not null default now()
);
alter table public.taxi_gemas_saldos enable row level security;
revoke all on public.taxi_gemas_saldos from anon, authenticated;

create table if not exists public.taxi_gemas_movimientos (
  id uuid primary key default gen_random_uuid(),
  telefono text not null,
  color text not null check (color in ('verde', 'celeste')),
  delta integer not null,
  motivo text not null,
  ref text not null unique,
  conductor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists taxi_gemas_mov_tel_idx
  on public.taxi_gemas_movimientos (telefono, color, created_at desc);
alter table public.taxi_gemas_movimientos enable row level security;
revoke all on public.taxi_gemas_movimientos from anon, authenticated;

alter table public.usuarios add column if not exists gemas_verdes integer not null default 0;
alter table public.usuarios add column if not exists gemas_celestes integer not null default 0;
-- Por si la tabla tiene permisos por columna (como conductores).
grant select (gemas_verdes, gemas_celestes) on public.usuarios to authenticated;

-- Saldo de un teléfono (para el trigger de abajo, que corre con el rol de
-- quien escribe y no puede leer taxi_gemas_saldos directo).
create or replace function public.taxi__gemas_de(p_telefono text, out verdes integer, out celestes integer)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(s.verdes), 0), coalesce(max(s.celestes), 0)
    from public.taxi_gemas_saldos s where s.telefono = p_telefono;
$$;
revoke execute on function public.taxi__gemas_de(text) from public, anon;
grant execute on function public.taxi__gemas_de(text) to authenticated;

-- Nadie las cambia desde la app; una cuenta nueva nace con su saldo.
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
    return new;
  end if;
  if current_user in ('anon', 'authenticated')
     and (new.gemas_verdes is distinct from old.gemas_verdes
          or new.gemas_celestes is distinct from old.gemas_celestes) then
    new.gemas_verdes := old.gemas_verdes;
    new.gemas_celestes := old.gemas_celestes;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuarios_gemas_protegidas on public.usuarios;
create trigger trg_usuarios_gemas_protegidas
  before insert or update on public.usuarios
  for each row execute function public.fn_usuarios_gemas_protegidas();

-- ---------- Avisos a Caja: rutas nuevas -----------------------------------
-- Mismo receptor que el saldo del pasajero (webhook-taxi-mirror-cuenta).
create or replace function public.fn_webhook_emitir(p_event_type text, p_destino text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_url      text;
  v_sobre    jsonb;
begin
  v_url := case p_event_type
    when 'taxi.pago_fiado_conductor'      then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    when 'taxi.entrega_estado'            then public.fn_webhook_secret('webhook_url_caja_entrega_estado')
    when 'taxi.mirror_pasajero_eliminado' then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    -- Mismo receptor de Caja (webhook-taxi-mirror-cuenta).
    when 'taxi.cuenta_bloqueo'            then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    when 'taxi.saldo_pasajero'            then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    when 'taxi.perfil_pasajero'           then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    when 'taxi.gema_celeste'              then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    when 'taxi.gemas_verdes'              then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    else null
  end;
  if v_url is null then
    raise exception 'fn_webhook_emitir: sin URL para event_type %', p_event_type;
  end if;

  v_sobre := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', p_event_type,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', 'taxi',
    'data', p_data
  );

  insert into public.webhook_outbox (event_id, event_type, destino, url, payload)
  values (v_event_id, p_event_type, p_destino, v_url, v_sobre);

  perform public.fn_webhook_despachar(
    (select id from public.webhook_outbox where event_id = v_event_id)
  );
  return v_event_id;
end;
$$;
revoke execute on function public.fn_webhook_emitir(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_webhook_emitir(text, text, jsonb) to service_role;

-- Saldo -> copia en usuarios + verdes de vuelta a Caja.
create or replace function public.fn_taxi_gemas_saldos_espejar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios
     set gemas_verdes = new.verdes, gemas_celestes = new.celestes
   where telefono = new.telefono and rol = 'pasajero'
     and (gemas_verdes is distinct from new.verdes or gemas_celestes is distinct from new.celestes);

  if tg_op = 'INSERT' or new.verdes is distinct from old.verdes then
    begin
      perform public.fn_webhook_emitir('taxi.gemas_verdes', 'caja', jsonb_build_object(
        'telefono', new.telefono, 'verdes', new.verdes,
        'version', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ));
    exception when others then
      raise warning 'fn_taxi_gemas_saldos_espejar: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_taxi_gemas_saldos_espejar on public.taxi_gemas_saldos;
create trigger trg_taxi_gemas_saldos_espejar
  after insert or update on public.taxi_gemas_saldos
  for each row execute function public.fn_taxi_gemas_saldos_espejar();

-- ---------- Ganar una celeste: viaje terminado ----------------------------
create or replace function public.fn_chat_oferta_gema_celeste()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
  v_cfg public.taxi_gemas_config;
  v_hoy integer;
  v_con_el integer;
  v_desde timestamptz := (date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima');
  v_ref text := 'celeste:oferta:' || new.id::text;
  v_id uuid;
begin
  if new.tipo is distinct from 'oferta'
     or new.estado_oferta is distinct from 'finalizado'
     or old.estado_oferta is distinct from 'aceptada'
     or new.pasajero_id is null then
    return new;
  end if;
  select * into v_cfg from public.taxi_gemas_config where id;
  if not coalesce(v_cfg.activo, false) then
    return new;
  end if;
  select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
  if v_tel is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('gema-celeste:' || v_tel));
  select coalesce(sum(delta), 0),
         coalesce(sum(delta) filter (where conductor_id = new.conductor_id), 0)
    into v_hoy, v_con_el
    from public.taxi_gemas_movimientos
   where telefono = v_tel and color = 'celeste' and motivo = 'viaje' and created_at >= v_desde;
  if v_hoy >= 5 or v_con_el >= 2 then
    return new;
  end if;

  insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
  values (v_tel, 'celeste', 1, 'viaje', v_ref, new.conductor_id)
  on conflict (ref) do nothing
  returning id into v_id;
  if v_id is null then
    return new;
  end if;

  begin
    perform public.fn_webhook_emitir('taxi.gema_celeste', 'caja', jsonb_build_object(
      'ref', v_ref, 'telefono', v_tel, 'delta', 1, 'motivo', 'viaje'
    ));
  exception when others then
    raise warning 'fn_chat_oferta_gema_celeste: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_chat_oferta_gema_celeste on public.chat_mensajes;
create trigger trg_chat_oferta_gema_celeste
  after update of estado_oferta on public.chat_mensajes
  for each row execute function public.fn_chat_oferta_gema_celeste();

-- ---------- Avisos que llegan de Caja -------------------------------------
--   'caja.gema_verde'     { ref, telefono, delta }       -> saldo verde
--   'caja.gemas_celestes' { telefono, celestes, version } -> copia celeste
--   'caja.gemas_config'   { valor, tope_tipo, tope_valor, activo, version }
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
begin
  if v_tipo = 'caja.gemas_config' then
    v_version := (v_data->>'version')::timestamptz;
    update public.taxi_gemas_config
       set valor = coalesce((v_data->>'valor')::numeric, valor),
           tope_tipo = coalesce(v_data->>'tope_tipo', tope_tipo),
           tope_valor = coalesce((v_data->>'tope_valor')::numeric, tope_valor),
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
    insert into public.taxi_gemas_saldos (telefono, celestes, celestes_version)
    values (v_tel, greatest(coalesce((v_data->>'celestes')::integer, 0), 0), v_version)
    on conflict (telefono) do update
      set celestes = excluded.celestes,
          celestes_version = excluded.celestes_version,
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
