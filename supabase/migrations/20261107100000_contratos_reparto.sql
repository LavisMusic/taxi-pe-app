-- =========================================================================
-- Contrato negocio–repartidor y pago del envío al recoger (lado Taxi-PE).
-- Pareja de caja-app/supabase/migrations/0146_contratos_reparto.sql.
--
--   * 'caja.contrato_invitar': un negocio invita a un conductor (por su
--     id o su celular). Queda 'pendiente' hasta que el conductor acepte o
--     rechace en su panel; si no existe, 'no_encontrado'. Vence a los 7
--     días. Cada cambio vuelve a Caja con 'taxi.contrato_reparto'.
--   * 'caja.contrato_terminar': el negocio lo terminó. El conductor
--     también puede terminarlo (taxi_terminar_contrato).
--   * rpc_conductores_para_reparto_negocio: el mismo radar de siempre, con
--     'del_negocio' para los repartidores con contrato activo con ese
--     negocio (Caja los muestra primero).
--   * 'caja.envio_pagado': la tienda le pagó el envío al repartidor al
--     recoger. El repartidor confirma "Recibí el pago" (o "No lo recibí")
--     y recién con el pago confirmado puede salir con el pedido (las
--     entregas nuevas; las que ya estaban en curso siguen como antes).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Contratos -----------------------------------------------------
create table if not exists public.taxi_contratos_reparto (
  id uuid primary key,              -- el mismo id que en Caja
  negocio_id uuid not null,
  negocio_nombre text,
  negocio_logo text,
  conductor_id uuid references public.conductores(id) on delete cascade,
  telefono_invitado text,
  estado text not null default 'pendiente' check (estado in (
    'pendiente', 'activo', 'rechazado', 'terminado', 'no_encontrado', 'duplicado', 'vencido'
  )),
  created_at timestamptz not null default now(),
  respondido_at timestamptz,
  terminado_at timestamptz
);
create index if not exists taxi_contratos_conductor_idx on public.taxi_contratos_reparto (conductor_id, estado);
create index if not exists taxi_contratos_negocio_idx on public.taxi_contratos_reparto (negocio_id, estado);
alter table public.taxi_contratos_reparto enable row level security;
revoke insert, update, delete on public.taxi_contratos_reparto from anon, authenticated;
drop policy if exists taxi_contratos_conductor_leer on public.taxi_contratos_reparto;
create policy taxi_contratos_conductor_leer on public.taxi_contratos_reparto for select to authenticated
  using (conductor_id = public.taxi_mi_conductor_id());
grant select on public.taxi_contratos_reparto to authenticated;

-- La invitación le aparece al conductor al instante.
do $$
begin
  alter publication supabase_realtime add table public.taxi_contratos_reparto;
exception when others then
  null; -- ya estaba
end $$;

-- ---------- Avisos a Caja: ruta nueva -------------------------------------
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
    when 'taxi.contrato_reparto'          then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
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

-- Cada cambio de estado vuelve a Caja, con los datos del conductor.
create or replace function public.fn_taxi_contrato_avisar_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.conductores;
begin
  if tg_op = 'UPDATE' and new.estado is not distinct from old.estado
     and new.conductor_id is not distinct from old.conductor_id then
    return new;
  end if;
  select * into v_c from public.conductores where id = new.conductor_id;
  begin
    perform public.fn_webhook_emitir('taxi.contrato_reparto', 'caja', jsonb_build_object(
      'contrato_id', new.id, 'estado', new.estado, 'conductor_id', new.conductor_id,
      'nombre', v_c.nombre, 'placa', v_c.placa, 'foto_url', v_c.foto_url
    ));
  exception when others then
    raise warning 'fn_taxi_contrato_avisar_caja: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_taxi_contrato_avisar_caja on public.taxi_contratos_reparto;
create trigger trg_taxi_contrato_avisar_caja
  after insert or update on public.taxi_contratos_reparto
  for each row execute function public.fn_taxi_contrato_avisar_caja();

-- ---------- El conductor responde o termina -------------------------------
create or replace function public.taxi_responder_contrato(p_id uuid, p_aceptar boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila public.taxi_contratos_reparto;
begin
  select * into v_fila from public.taxi_contratos_reparto where id = p_id for update;
  if v_fila.id is null or v_fila.conductor_id is distinct from public.taxi_mi_conductor_id() then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  if v_fila.estado <> 'pendiente' then
    return v_fila.estado;
  end if;
  if v_fila.created_at < now() - interval '7 days' then
    update public.taxi_contratos_reparto set estado = 'vencido' where id = p_id;
    return 'vencido';
  end if;
  update public.taxi_contratos_reparto
     set estado = case when p_aceptar then 'activo' else 'rechazado' end, respondido_at = now()
   where id = p_id;
  return case when p_aceptar then 'activo' else 'rechazado' end;
end;
$$;
revoke execute on function public.taxi_responder_contrato(uuid, boolean) from public, anon;
grant execute on function public.taxi_responder_contrato(uuid, boolean) to authenticated;

create or replace function public.taxi_terminar_contrato(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.taxi_contratos_reparto
     set estado = 'terminado', terminado_at = now()
   where id = p_id and conductor_id = public.taxi_mi_conductor_id() and estado in ('pendiente', 'activo');
end;
$$;
revoke execute on function public.taxi_terminar_contrato(uuid) from public, anon;
grant execute on function public.taxi_terminar_contrato(uuid) to authenticated;

-- Vencen a los 7 días sin respuesta.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'taxi-contratos-vencer';
    perform cron.schedule(
      'taxi-contratos-vencer', '23 * * * *',
      $c$update public.taxi_contratos_reparto set estado = 'vencido'
          where estado = 'pendiente' and created_at < now() - interval '7 days'$c$
    );
  end if;
end $$;

-- ---------- Radar por negocio ---------------------------------------------
create or replace function public.rpc_conductores_para_reparto_negocio(p_negocio_id uuid)
returns table (
  id               uuid,
  nombre           text,
  placa            text,
  foto_url         text,
  estado           text,
  ultima_lat       numeric,
  ultima_lng       numeric,
  en_carrera       boolean,
  repartos_activos integer,
  del_negocio      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.nombre, r.placa, r.foto_url, r.estado, r.ultima_lat, r.ultima_lng,
         r.en_carrera, r.repartos_activos,
         exists (
           select 1 from public.taxi_contratos_reparto k
            where k.negocio_id = p_negocio_id and k.conductor_id = r.id and k.estado = 'activo'
         )
  from public.rpc_conductores_para_reparto() r;
$$;
grant execute on function public.rpc_conductores_para_reparto_negocio(uuid) to anon, authenticated;

-- ---------- Pago del envío al recoger -------------------------------------
alter table public.entregas add column if not exists envio_pago_metodo text;
alter table public.entregas add column if not exists envio_pagado_at timestamptz;
alter table public.entregas add column if not exists envio_monto_pagado numeric(8,2);
alter table public.entregas add column if not exists envio_recibido_at timestamptz;
alter table public.entregas add column if not exists envio_no_recibido_at timestamptz;
-- Las entregas que ya existen no lo exigen; las nuevas sí.
alter table public.entregas add column if not exists pago_envio_requerido boolean not null default false;
alter table public.entregas alter column pago_envio_requerido set default true;

create or replace function public.rpc_entrega_confirmar_pago(p_entrega_id uuid, p_recibido boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.entregas;
begin
  select * into v_e from public.entregas where id = p_entrega_id for update;
  if v_e.id is null or v_e.conductor_id is distinct from public.taxi_mi_conductor_id() then
    return jsonb_build_object('status', 'sin_permiso');
  end if;
  if v_e.envio_pagado_at is null then
    return jsonb_build_object('status', 'sin_pago');
  end if;
  if v_e.envio_recibido_at is not null then
    return jsonb_build_object('status', 'ok');
  end if;
  if p_recibido then
    update public.entregas set envio_recibido_at = now(), envio_no_recibido_at = null, actualizado_at = now()
     where id = p_entrega_id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (p_entrega_id, 'cajero_conductor', 'sistema',
            '✅ El repartidor confirmó que recibió el pago del envío.');
  else
    update public.entregas set envio_no_recibido_at = now(), actualizado_at = now() where id = p_entrega_id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (p_entrega_id, 'cajero_conductor', 'sistema',
            '⚠️ El repartidor dice que todavía no recibió el pago del envío.');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.rpc_entrega_confirmar_pago(uuid, boolean) from public, anon;
grant execute on function public.rpc_entrega_confirmar_pago(uuid, boolean) to authenticated;

-- Salir con el pedido: con el pago del envío confirmado (entregas nuevas).
create or replace function public.rpc_entrega_avanzar(p_entrega_id uuid, p_conductor_id uuid, p_nuevo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.entregas;
begin
  if p_conductor_id is distinct from public.taxi_mi_conductor_id() then
    return jsonb_build_object('status', 'sin_permiso');
  end if;

  select * into v_e from public.entregas
  where id = p_entrega_id and conductor_id = p_conductor_id;
  if v_e.id is null then return jsonb_build_object('status', 'no_encontrada'); end if;

  if not (v_e.estado = 'aceptado' and p_nuevo = 'en_ruta') then
    return jsonb_build_object('status', 'transicion_invalida', 'de', v_e.estado, 'a', p_nuevo);
  end if;
  if v_e.pago_envio_requerido and coalesce(v_e.tarifa, 0) > 0 and v_e.envio_recibido_at is null then
    return jsonb_build_object('status', 'falta_pago_envio');
  end if;

  update public.entregas
    set estado = 'en_ruta', retirado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  perform public.fn_entrega_avisar_caja(p_entrega_id, 'en_ruta');
  return jsonb_build_object('status', 'ok');
end;
$$;

-- El estado que lee Caja trae también el pago del envío.
drop function if exists public.rpc_entrega_estado(uuid);
create function public.rpc_entrega_estado(p_session_token uuid)
returns table (
  id uuid, estado text, conductor_id uuid, conductor_nombre text, conductor_placa text,
  cliente_nombre text, direccion_entrega text, caja_sucursal text,
  items jsonb, total numeric, tarifa numeric, pin text,
  entrega_lat numeric, entrega_lng numeric,
  origen_lat numeric, origen_lng numeric,
  repartidor_lat numeric, repartidor_lng numeric, repartidor_pos_at timestamptz,
  aceptado_at timestamptz, retirado_at timestamptz, entregado_at timestamptz, actualizado_at timestamptz,
  envio_pago_metodo text, envio_pagado_at timestamptz, envio_monto_pagado numeric,
  envio_recibido_at timestamptz, envio_no_recibido_at timestamptz, pago_envio_requerido boolean
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.estado, e.conductor_id, c.nombre, c.placa,
         e.cliente_nombre, e.direccion_entrega, e.caja_sucursal,
         e.items, e.total, e.tarifa, e.pin,
         e.entrega_lat, e.entrega_lng,
         e.origen_lat, e.origen_lng,
         e.repartidor_lat, e.repartidor_lng, e.repartidor_pos_at,
         e.aceptado_at, e.retirado_at, e.entregado_at, e.actualizado_at,
         e.envio_pago_metodo, e.envio_pagado_at, e.envio_monto_pagado,
         e.envio_recibido_at, e.envio_no_recibido_at, e.pago_envio_requerido
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;
grant execute on function public.rpc_entrega_estado(uuid) to anon, authenticated;

-- ---------- Avisos que llegan de Caja -------------------------------------
create or replace function public.rpc_webhook_caja_reparto(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_payload->>'event_type';
  v_data jsonb := p_payload->'data';
  v_id uuid := (v_data->>'contrato_id')::uuid;
  v_conductor uuid;
  v_tel text := nullif(regexp_replace(coalesce(v_data->>'telefono', ''), '\D', '', 'g'), '');
  v_e public.entregas;
  v_monto numeric;
begin
  if v_tipo = 'caja.contrato_invitar' then
    if exists (select 1 from public.taxi_contratos_reparto where id = v_id) then
      return jsonb_build_object('status', 'duplicado');
    end if;
    v_conductor := nullif(v_data->>'conductor_id', '')::uuid;
    if v_conductor is null and v_tel is not null then
      select id into v_conductor from public.conductores
       where regexp_replace(coalesce(telefono, ''), '\D', '', 'g') in (v_tel, '51' || v_tel)
       limit 1;
    elsif v_conductor is not null and not exists (select 1 from public.conductores where id = v_conductor) then
      v_conductor := null;
    end if;

    insert into public.taxi_contratos_reparto (
      id, negocio_id, negocio_nombre, negocio_logo, conductor_id, telefono_invitado, estado
    ) values (
      v_id, (v_data->>'negocio_id')::uuid, v_data->>'negocio_nombre', v_data->>'negocio_logo',
      v_conductor, v_tel,
      case
        when v_conductor is null then 'no_encontrado'
        when exists (
          select 1 from public.taxi_contratos_reparto k
           where k.negocio_id = (v_data->>'negocio_id')::uuid and k.conductor_id = v_conductor
             and k.estado in ('pendiente', 'activo')
        ) then 'duplicado'
        else 'pendiente'
      end
    );
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tipo = 'caja.contrato_terminar' then
    update public.taxi_contratos_reparto
       set estado = 'terminado', terminado_at = now()
     where id = v_id and estado in ('pendiente', 'activo');
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tipo = 'caja.envio_pagado' then
    select * into v_e from public.entregas where id = (v_data->>'entrega_id')::uuid for update;
    if v_e.id is null then
      return jsonb_build_object('status', 'no_encontrada');
    end if;
    if v_e.envio_pagado_at is not null then
      return jsonb_build_object('status', 'duplicado');
    end if;
    v_monto := round(coalesce((v_data->>'monto')::numeric, 0), 2);
    update public.entregas
       set envio_pago_metodo = v_data->>'metodo', envio_pagado_at = now(),
           envio_monto_pagado = v_monto, actualizado_at = now()
     where id = v_e.id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (v_e.id, 'cajero_conductor', 'sistema',
            format('💵 La tienda te pagó el envío: S/ %s %s. Confirma que lo recibiste para salir con el pedido.',
                   trim(to_char(v_monto, '999990.00')),
                   case when v_data->>'metodo' = 'EFECTIVO' then 'en efectivo' else 'por Yape' end));
    return jsonb_build_object('status', 'ok');
  end if;

  return jsonb_build_object('status', 'invalido');
end;
$$;
revoke execute on function public.rpc_webhook_caja_reparto(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_reparto(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
