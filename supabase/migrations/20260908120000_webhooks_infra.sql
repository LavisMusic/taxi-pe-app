-- =========================================================================
-- Infraestructura de webhooks Taxi-PE ↔ Caja-Registradora.
--   Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh)
--   Ver WEBHOOKS.md en la raíz del repo para el contrato completo.
--
-- Este archivo trae:
--   1) Extensiones (pg_net, pg_cron, pgcrypto, supabase_vault)
--   2) Tablas outbox / inbox
--   3) Helpers de emisión (fn_webhook_emitir / _despachar / _reconciliar)
--   4) pg_cron cada minuto para reintentos
--   5) Columnas nuevas: fiados_conductores.origen/.origen_ref,
--      tabla pedidos_delivery_entrantes
--   6) Trigger EMISOR de 3.3 (pago de fiado de conductor → Caja)
--   7) RPCs RECEPTORES de 3.1 y 3.2 (los llama la Edge Function)
--
-- Idempotente: create ... if not exists / create or replace / drop ... if exists.
-- =========================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;
create extension if not exists pgcrypto;
create extension if not exists supabase_vault;

-- =========================================================================
-- 1) OUTBOX — eventos que este proyecto EMITE hacia el otro.
-- =========================================================================

create table if not exists public.webhook_outbox (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null unique,
  event_type         text not null,
  destino            text not null,                 -- 'caja'
  url                text not null,
  payload            jsonb not null,                -- sobre COMPLETO (con event_id, occurred_at, source, data)
  intentos           int  not null default 0,
  max_intentos       int  not null default 8,
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente', 'enviado', 'fallido')),
  ultimo_request_id  bigint,
  ultimo_error       text,
  proximo_intento_at timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  enviado_at         timestamptz
);

create index if not exists webhook_outbox_pendientes_idx
  on public.webhook_outbox (proximo_intento_at)
  where estado = 'pendiente';

alter table public.webhook_outbox enable row level security;
-- Sin políticas: solo service_role / SQL Editor / funciones security definer.

-- =========================================================================
-- 2) INBOX — eventos que este proyecto RECIBE (idempotencia + auditoría).
--    Lo escribe el RPC receptor (security definer), no la Edge Function
--    directamente.
-- =========================================================================

create table if not exists public.webhook_inbox (
  event_id     uuid primary key,
  event_type   text not null,
  payload      jsonb not null,
  estado       text not null default 'recibido'
               check (estado in ('recibido', 'procesado', 'sin_match', 'error')),
  nota         text,
  recibido_at  timestamptz not null default now(),
  procesado_at timestamptz
);

alter table public.webhook_inbox enable row level security;

-- =========================================================================
-- 3) HELPERS DE EMISIÓN
-- =========================================================================

-- Lee un secreto del Vault por nombre. Devuelve NULL si no existe.
create or replace function public.fn_webhook_secret(p_nombre text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_nombre
  limit 1;
$$;

-- Firma HMAC-SHA256 en base64 sobre `${ts}.${body}`.
-- hmac() viene de pgcrypto, que en Supabase vive en el schema `extensions`
-- — hay que calificarlo (o no está en el search_path de esta función).
create or replace function public.fn_webhook_firmar(p_ts bigint, p_body text, p_secret text)
returns text
language sql
immutable
set search_path = extensions, public, pg_catalog
as $$
  select encode(extensions.hmac(p_ts::text || '.' || p_body, p_secret, 'sha256'), 'base64');
$$;

-- Despacha (o re-despacha) una fila del outbox: arma headers firmados y
-- hace el POST con pg_net. Incrementa `intentos` y guarda el request_id.
create or replace function public.fn_webhook_despachar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.webhook_outbox%rowtype;
  v_secret   text;
  v_ts       bigint := floor(extract(epoch from now()));
  v_body     text;
  v_sig      text;
  v_req_id   bigint;
begin
  select * into r from public.webhook_outbox where id = p_id for update;
  if not found then return; end if;

  v_secret := public.fn_webhook_secret('webhook_secret_taxi_to_caja');
  if v_secret is null then
    update public.webhook_outbox
      set ultimo_error = 'falta vault secret webhook_secret_taxi_to_caja',
          proximo_intento_at = now() + interval '5 min'
      where id = p_id;
    return;
  end if;

  v_body := r.payload::text;
  v_sig  := public.fn_webhook_firmar(v_ts, v_body, v_secret);

  select net.http_post(
    url     := r.url,
    body    := r.payload,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'X-Webhook-Id',        r.event_id::text,
      'X-Webhook-Timestamp', v_ts::text,
      'X-Webhook-Signature', v_sig
    )
  ) into v_req_id;

  update public.webhook_outbox
    set intentos          = intentos + 1,
        ultimo_request_id = v_req_id,
        ultimo_error      = null
    where id = p_id;
end;
$$;

-- Punto de entrada para los triggers emisores: arma el sobre, inserta en
-- outbox y despacha una vez de inmediato.
create or replace function public.fn_webhook_emitir(
  p_event_type text,
  p_destino    text,
  p_data       jsonb
)
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
    when 'taxi.pago_fiado_conductor' then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    else null
  end;
  if v_url is null then
    raise exception 'fn_webhook_emitir: sin URL para event_type %', p_event_type;
  end if;

  v_sobre := jsonb_build_object(
    'event_id',    v_event_id,
    'event_type',  p_event_type,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source',      'taxi',
    'data',        p_data
  );

  insert into public.webhook_outbox (event_id, event_type, destino, url, payload)
  values (v_event_id, p_event_type, p_destino, v_url, v_sobre);

  perform public.fn_webhook_despachar(
    (select id from public.webhook_outbox where event_id = v_event_id)
  );
  return v_event_id;
end;
$$;

-- Reconciliación: la corre pg_cron. Cruza outbox pendiente contra
-- net._http_response y reintenta con backoff exponencial.
create or replace function public.fn_webhook_reconciliar()
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  r        public.webhook_outbox%rowtype;
  v_status int;
begin
  for r in
    select * from public.webhook_outbox
    where estado = 'pendiente'
    order by proximo_intento_at
    limit 100
  loop
    v_status := null;
    if r.ultimo_request_id is not null then
      -- net._http_response guarda la respuesta de cada net.http_post por
      -- su id. Se purga sola a las ~6 h; si ya no está, v_status queda
      -- NULL y la fila reintenta hasta max_intentos.
      select status_code into v_status
      from net._http_response
      where id = r.ultimo_request_id;
    end if;

    if v_status between 200 and 299 then
      update public.webhook_outbox
        set estado = 'enviado', enviado_at = now(), ultimo_error = null
        where id = r.id;

    elsif r.intentos >= r.max_intentos then
      update public.webhook_outbox
        set estado = 'fallido',
            ultimo_error = coalesce('HTTP ' || v_status, 'sin respuesta tras max_intentos')
        where id = r.id;

    elsif now() >= r.proximo_intento_at then
      update public.webhook_outbox
        set proximo_intento_at = now() + (interval '1 minute' * power(2, r.intentos)),
            ultimo_error = coalesce('HTTP ' || v_status, 'sin respuesta, reintentando')
        where id = r.id;
      perform public.fn_webhook_despachar(r.id);
    end if;
  end loop;
end;
$$;

-- =========================================================================
-- 4) pg_cron — reconciliación cada minuto.
-- =========================================================================

select cron.unschedule('webhook-reconciliar')
where exists (select 1 from cron.job where jobname = 'webhook-reconciliar');

select cron.schedule('webhook-reconciliar', '* * * * *', $$select public.fn_webhook_reconciliar()$$);

-- =========================================================================
-- 5) COLUMNAS / TABLAS NUEVAS DE DOMINIO
-- =========================================================================

-- fiados_conductores: marca de origen para dedupe y anti-bucle.
alter table public.fiados_conductores
  add column if not exists origen     text not null default 'local',
  add column if not exists origen_ref text;

create unique index if not exists fiados_conductores_origen_ref_uidx
  on public.fiados_conductores (origen, origen_ref)
  where origen <> 'local';

-- Pedidos delivery entrantes desde la Caja (3.2). La asignación de
-- vehículo la hace la app Taxi-PE; esto es solo la bandeja de entrada.
create table if not exists public.pedidos_delivery_entrantes (
  id               uuid primary key default gen_random_uuid(),
  origen           text not null default 'webhook:caja',
  origen_ref       text not null,
  estado           text not null default 'nuevo'
                   check (estado in ('nuevo', 'asignado', 'en_ruta', 'entregado', 'cancelado')),
  sucursal         text,
  origen_texto     text,
  origen_lat       numeric,
  origen_lng       numeric,
  cliente_nombre   text,
  cliente_telefono text,
  items            jsonb not null default '[]'::jsonb,
  total            numeric,
  metodo_pago      text,
  conductor_id     uuid references public.conductores(id),
  recibido_at      timestamptz not null default now(),
  actualizado_at   timestamptz not null default now()
);

create unique index if not exists pedidos_delivery_entrantes_origen_ref_uidx
  on public.pedidos_delivery_entrantes (origen, origen_ref);

alter table public.pedidos_delivery_entrantes enable row level security;

drop policy if exists "pedidos_delivery_entrantes_staff_all" on public.pedidos_delivery_entrantes;
create policy "pedidos_delivery_entrantes_staff_all" on public.pedidos_delivery_entrantes
  for all using (true) with check (true);
-- NOTA: política abierta a `authenticated` porque Taxi-PE no tiene helper
-- is_staff() y el panel de despacho corre con el rol de admin logueado.
-- Endurecer cuando exista el gate de rol (mismo pendiente que el resto de RLS).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'pedidos_delivery_entrantes'
  ) then
    execute 'alter publication supabase_realtime add table public.pedidos_delivery_entrantes';
  end if;
end $$;

-- =========================================================================
-- 6) EMISOR 3.3 — pago de fiado de conductor (Taxi-PE → Caja)
-- =========================================================================

create or replace function public.fn_emitir_pago_fiado_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dni      text;
  v_telefono text;
begin
  -- Anti-bucle: si el pago lo creó el webhook entrante desde la Caja, no
  -- lo devolvemos.
  if coalesce(new.origen, 'local') like 'webhook:%' then
    return new;
  end if;

  -- Resolver DNI/teléfono del conductor: conductores.telefono ↔ usuarios.
  select c.telefono, u.dni
    into v_telefono, v_dni
  from public.conductores c
  left join public.usuarios u on u.telefono = c.telefono
  where c.id = new.conductor_id;

  if v_telefono is null and v_dni is null then
    return new;  -- conductor sin datos de contacto: no se puede vincular
  end if;

  perform public.fn_webhook_emitir(
    'taxi.pago_fiado_conductor',
    'caja',
    jsonb_build_object(
      'identidad', jsonb_build_object('dni', v_dni, 'telefono', v_telefono),
      'pago', jsonb_build_object(
        'taxi_ref',        new.id,
        'monto',           new.monto,
        'metodo_pago',     new.metodo_pago,
        'comprobante_url', new.comprobante_url,
        'fecha',           to_char(coalesce(new.created_at, now()) at time zone 'utc',
                                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_emitir_pago_fiado_conductor on public.pagos_fiados_conductores;
create trigger trg_emitir_pago_fiado_conductor
  after insert on public.pagos_fiados_conductores
  for each row execute function public.fn_emitir_pago_fiado_conductor();

-- =========================================================================
-- 7) RECEPTORES 3.1 y 3.2 — los llama la Edge Function con service_role
--    DESPUÉS de validar el HMAC. Cada uno hace: idempotencia + dominio,
--    todo en una transacción.
-- =========================================================================

-- Resuelve un conductor. Regla de negocio (WEBHOOKS.md §6.4): se
-- reconoce por DNI **y** rol 'conductor' en usuarios. El teléfono es
-- solo fallback y también exige ese rol. Sin match → el receptor
-- responde 'sin_match' y queda para vinculación manual del Admin
-- (nunca se crea el conductor automáticamente, §6.3).
create or replace function public.fn_webhook_resolver_conductor(p_dni text, p_telefono text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select c.id
  from public.conductores c
  join public.usuarios u
    on u.telefono = c.telefono and u.rol = 'conductor'
  where (p_dni is not null and u.dni = p_dni)
     or (p_telefono is not null and c.telefono = p_telefono)
  order by (p_dni is not null and u.dni = p_dni) desc  -- prioriza match por DNI
  limit 1;
$$;

-- 3.1  caja.venta_fiado_conductor
create or replace function public.rpc_webhook_caja_venta_fiado(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo      integer;
  v_data       jsonb := p_payload -> 'data';
  v_dni        text  := v_data #>> '{identidad,dni}';
  v_telefono   text  := v_data #>> '{identidad,telefono}';
  v_caja_ref   text  := v_data #>> '{cargo,caja_ref}';
  v_conductor  uuid;
begin
  insert into public.webhook_inbox (event_id, event_type, payload)
  values (p_event_id, p_payload ->> 'event_type', p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  v_conductor := public.fn_webhook_resolver_conductor(v_dni, v_telefono);

  if v_conductor is null then
    update public.webhook_inbox
      set estado = 'sin_match', nota = 'conductor no encontrado', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'sin_match');
  end if;

  insert into public.fiados_conductores
    (conductor_id, concepto, monto, fecha_fiado, estado, origen, origen_ref)
  values
    (v_conductor,
     coalesce(v_data #>> '{cargo,concepto}', 'Venta fiado (Caja)'),
     (v_data #>> '{cargo,monto}')::numeric,
     coalesce((v_data #>> '{cargo,fecha}')::timestamptz, now()),
     'pendiente', 'webhook:caja', v_caja_ref)
  on conflict (origen, origen_ref) do nothing;

  update public.webhook_inbox
    set estado = 'procesado', procesado_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', 'ok', 'conductor_id', v_conductor);
end;
$$;

-- 3.2  caja.pedido_delivery
create or replace function public.rpc_webhook_caja_pedido_delivery(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo integer;
  v_p     jsonb := p_payload #> '{data,pedido}';
begin
  insert into public.webhook_inbox (event_id, event_type, payload)
  values (p_event_id, p_payload ->> 'event_type', p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  insert into public.pedidos_delivery_entrantes
    (origen, origen_ref, sucursal, origen_texto, origen_lat, origen_lng,
     cliente_nombre, cliente_telefono, items, total, metodo_pago)
  values
    ('webhook:caja',
     v_p ->> 'caja_ref',
     v_p ->> 'sucursal',
     v_p ->> 'origen_texto',
     (v_p ->> 'origen_lat')::numeric,
     (v_p ->> 'origen_lng')::numeric,
     v_p ->> 'cliente_nombre',
     v_p ->> 'cliente_telefono',
     coalesce(v_p -> 'items', '[]'::jsonb),
     (v_p ->> 'total')::numeric,
     v_p ->> 'metodo_pago')
  on conflict (origen, origen_ref) do nothing;

  update public.webhook_inbox
    set estado = 'procesado', procesado_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', 'ok');
end;
$$;
