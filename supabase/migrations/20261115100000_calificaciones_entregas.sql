-- =========================================================================
-- Reportes y reputación, fase 1b (Taxi-PE): calificaciones de entregas.
--
--   * El repartidor califica al negocio y al cliente de una entrega
--     terminada (taxi_calificar_entrega). Se guarda acá en
--     taxi_calificaciones_salientes (para editarla o borrarla) y viaja a
--     Caja por webhook firmado ('taxi.calificacion'), donde vive la
--     reputación de negocios y clientes.
--   * El cliente y el negocio califican al repartidor desde Caja: llega por
--     'caja.calificacion' (rpc_webhook_caja_calificacion) y se suma a su
--     reputación de conductor.
--   * Borrar la propia (taxi_borrar_calificacion) y leerla para editarla
--     (taxi_mi_calificacion), para viajes y entregas. Lo ya calificado se
--     puede editar después de los 7 días; calificar por primera vez, no.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_calificaciones_salientes (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  conductor_id uuid not null,
  calificado_tipo text not null check (calificado_tipo in ('negocio', 'cliente')),
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ref, calificado_tipo)
);
alter table public.taxi_calificaciones_salientes enable row level security;
revoke all on public.taxi_calificaciones_salientes from anon, authenticated;

-- Emisor de webhooks: + 'taxi.calificacion' (al receptor de Caja webhook-taxi-mirror-cuenta).
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
    when 'taxi.calificacion'              then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
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

-- ---------- Calificar un viaje (igual que 1a, pero editar ya no vence) -----
create or replace function public.taxi_calificar(p_ref text, p_estrellas integer, p_comentario text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_oferta public.chat_mensajes;
  v_autor_tipo text;
  v_autor_id text;
  v_tipo text;
  v_id uuid;
  v_coment text := nullif(trim(coalesce(p_comentario, '')), '');
  v_rep public.taxi_reputacion;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para calificar.' using errcode = '42501';
  end if;
  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'Elige de 1 a 5 estrellas.' using errcode = '22023';
  end if;
  if v_coment is not null and char_length(v_coment) > 280 then
    raise exception 'El comentario puede tener hasta 280 letras.' using errcode = '22023';
  end if;
  if p_ref is null or p_ref not like 'viaje:%' then
    raise exception 'Servicio inválido.' using errcode = '22023';
  end if;

  select * into v_oferta from public.chat_mensajes
   where id::text = substr(p_ref, 7) and tipo = 'oferta' and estado_oferta = 'finalizado';
  if v_oferta.id is null then
    raise exception 'Solo se califican viajes terminados.' using errcode = '42501';
  end if;

  if v_oferta.pasajero_id = v_uid then
    v_autor_tipo := 'pasajero'; v_autor_id := v_uid::text;
    v_tipo := 'conductor'; v_id := v_oferta.conductor_id;
  elsif v_cond is not null and v_oferta.conductor_id = v_cond then
    v_autor_tipo := 'conductor'; v_autor_id := v_cond::text;
    v_tipo := 'pasajero'; v_id := v_oferta.pasajero_id;
  else
    raise exception 'Solo califica quien hizo el viaje.' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'Ese viaje no tiene a quién calificar.' using errcode = '22023';
  end if;
  if coalesce(v_oferta.finalizado_at, v_oferta.created_at) < now() - interval '7 days'
     and not exists (select 1 from public.taxi_calificaciones
                      where ref = p_ref and autor_tipo = v_autor_tipo and calificado_tipo = v_tipo) then
    raise exception 'Pasaron más de 7 días: ya no se puede calificar este viaje.' using errcode = '42501';
  end if;

  insert into public.taxi_calificaciones (servicio, ref, autor_tipo, autor_id, calificado_tipo, calificado_id, estrellas, comentario)
  values ('viaje', p_ref, v_autor_tipo, v_autor_id, v_tipo, v_id, p_estrellas, v_coment)
  on conflict (ref, autor_tipo, calificado_tipo) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, updated_at = now();

  select * into v_rep from public.taxi_reputacion where calificado_tipo = v_tipo and calificado_id = v_id;
  return jsonb_build_object('ok', true, 'calificado_tipo', v_tipo, 'calificado_id', v_id,
                            'total', v_rep.total, 'promedio', v_rep.promedio, 'etiqueta', v_rep.etiqueta);
end;
$$;
revoke execute on function public.taxi_calificar(text, integer, text) from public, anon;
grant execute on function public.taxi_calificar(text, integer, text) to authenticated;

-- ---------- El repartidor califica al negocio o al cliente -----------------
create or replace function public.taxi_calificar_entrega(
  p_entrega_id uuid, p_calificado_tipo text, p_estrellas integer, p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
  v_e public.entregas;
  v_ref text := 'entrega:' || p_entrega_id;
  v_coment text := nullif(trim(coalesce(p_comentario, '')), '');
begin
  if v_cond is null then
    raise exception 'Solo el repartidor de la entrega.' using errcode = '42501';
  end if;
  if p_calificado_tipo not in ('negocio', 'cliente') then
    raise exception 'Cuenta inválida.' using errcode = '22023';
  end if;
  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'Elige de 1 a 5 estrellas.' using errcode = '22023';
  end if;
  if v_coment is not null and char_length(v_coment) > 280 then
    raise exception 'El comentario puede tener hasta 280 letras.' using errcode = '22023';
  end if;
  select * into v_e from public.entregas where id = p_entrega_id;
  if v_e.id is null or v_e.conductor_id is distinct from v_cond or v_e.estado <> 'entregado' then
    raise exception 'Solo se califican entregas que hiciste.' using errcode = '42501';
  end if;
  if v_e.caja_pedido_ref is null then
    raise exception 'Esa entrega no viene de un negocio de la plataforma.' using errcode = '22023';
  end if;
  if coalesce(v_e.entregado_at, v_e.actualizado_at) < now() - interval '7 days'
     and not exists (select 1 from public.taxi_calificaciones_salientes where ref = v_ref and calificado_tipo = p_calificado_tipo) then
    raise exception 'Pasaron más de 7 días: ya no se puede calificar esta entrega.' using errcode = '42501';
  end if;

  insert into public.taxi_calificaciones_salientes (ref, conductor_id, calificado_tipo, estrellas, comentario)
  values (v_ref, v_cond, p_calificado_tipo, p_estrellas, v_coment)
  on conflict (ref, calificado_tipo) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, updated_at = now();

  perform public.fn_webhook_emitir('taxi.calificacion', 'caja', jsonb_build_object(
    'accion', 'guardar', 'caja_pedido_ref', v_e.caja_pedido_ref, 'conductor_id', v_cond,
    'calificado_tipo', p_calificado_tipo, 'estrellas', p_estrellas, 'comentario', v_coment));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_calificar_entrega(uuid, text, integer, text) from public, anon;
grant execute on function public.taxi_calificar_entrega(uuid, text, integer, text) to authenticated;

-- ---------- Borrar la propia (viaje o entrega) -----------------------------
create or replace function public.taxi_borrar_calificacion(p_ref text, p_calificado_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_e public.entregas;
begin
  if v_uid is null then
    raise exception 'Inicia sesión.' using errcode = '42501';
  end if;
  if p_ref like 'viaje:%' then
    delete from public.taxi_calificaciones
     where ref = p_ref and calificado_tipo = p_calificado_tipo
       and ((autor_tipo = 'pasajero' and autor_id = v_uid::text)
         or (autor_tipo = 'conductor' and v_cond is not null and autor_id = v_cond::text));
    return jsonb_build_object('ok', true);
  end if;
  if p_ref like 'entrega:%' and v_cond is not null then
    select * into v_e from public.entregas where id::text = substr(p_ref, 9);
    delete from public.taxi_calificaciones_salientes
     where ref = p_ref and calificado_tipo = p_calificado_tipo and conductor_id = v_cond;
    if found and v_e.caja_pedido_ref is not null then
      perform public.fn_webhook_emitir('taxi.calificacion', 'caja', jsonb_build_object(
        'accion', 'borrar', 'caja_pedido_ref', v_e.caja_pedido_ref, 'conductor_id', v_cond,
        'calificado_tipo', p_calificado_tipo));
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Servicio inválido.' using errcode = '22023';
end;
$$;
revoke execute on function public.taxi_borrar_calificacion(text, text) from public, anon;
grant execute on function public.taxi_borrar_calificacion(text, text) to authenticated;

-- ---------- La que ya puse (para editarla) ---------------------------------
create or replace function public.taxi_mi_calificacion(p_ref text, p_calificado_tipo text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_est smallint;
  v_com text;
begin
  if p_ref like 'viaje:%' then
    select estrellas, comentario into v_est, v_com from public.taxi_calificaciones
     where ref = p_ref and calificado_tipo = p_calificado_tipo
       and ((autor_tipo = 'pasajero' and autor_id = v_uid::text)
         or (autor_tipo = 'conductor' and v_cond is not null and autor_id = v_cond::text));
  elsif p_ref like 'entrega:%' then
    select estrellas, comentario into v_est, v_com from public.taxi_calificaciones_salientes
     where ref = p_ref and calificado_tipo = p_calificado_tipo and conductor_id = v_cond;
  end if;
  return jsonb_build_object('estrellas', v_est, 'comentario', v_com);
end;
$$;
revoke execute on function public.taxi_mi_calificacion(text, text) from public, anon;
grant execute on function public.taxi_mi_calificacion(text, text) to authenticated;

-- ---------- Pendientes: viajes (1a) + entregas del repartidor --------------
create or replace function public.taxi_calificaciones_pendientes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'fecha' desc, x->>'orden')
      from (
        select jsonb_build_object(
                 'ref', 'viaje:' || m.id::text, 'servicio', 'viaje', 'orden', '1', 'fecha', coalesce(m.finalizado_at, m.created_at),
                 'calificado_tipo', 'conductor', 'calificado_id', c.id, 'nombre', c.nombre, 'foto_url', c.foto_url,
                 'detalle', c.placa) as x
          from public.chat_mensajes m
          join public.conductores c on c.id = m.conductor_id
         where m.pasajero_id = v_uid and m.tipo = 'oferta' and m.estado_oferta = 'finalizado'
           and coalesce(m.finalizado_at, m.created_at) >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones k
                            where k.ref = 'viaje:' || m.id::text and k.autor_tipo = 'pasajero' and k.calificado_tipo = 'conductor')
        union all
        select jsonb_build_object(
                 'ref', 'viaje:' || m.id::text, 'servicio', 'viaje', 'orden', '1', 'fecha', coalesce(m.finalizado_at, m.created_at),
                 'calificado_tipo', 'pasajero', 'calificado_id', u.id,
                 'nombre', case when u.nombre_usuario is not null and u.nombre_usuario !~ '^\d{6,}$'
                                then '@' || u.nombre_usuario else coalesce(u.nombre, 'Pasajero') end,
                 'foto_url', u.foto_url, 'detalle', null) as x
          from public.chat_mensajes m
          join public.usuarios u on u.id = m.pasajero_id
         where v_cond is not null and m.conductor_id = v_cond and m.tipo = 'oferta' and m.estado_oferta = 'finalizado'
           and coalesce(m.finalizado_at, m.created_at) >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones k
                            where k.ref = 'viaje:' || m.id::text and k.autor_tipo = 'conductor' and k.calificado_tipo = 'pasajero')
        union all
        -- Entregas del repartidor: primero el negocio, después el cliente.
        select jsonb_build_object(
                 'ref', 'entrega:' || e.id, 'servicio', 'entrega', 'entrega_id', e.id, 'orden', t.orden,
                 'fecha', coalesce(e.entregado_at, e.actualizado_at), 'calificado_tipo', t.tipo,
                 'nombre', case when t.tipo = 'negocio' then coalesce(e.caja_sucursal, 'Tienda') else coalesce(e.cliente_nombre, 'Cliente') end,
                 'foto_url', case when t.tipo = 'negocio' then e.caja_logo_url else null end,
                 'detalle', case when t.tipo = 'negocio' then 'Negocio de la entrega' else 'Cliente de la entrega' end) as x
          from public.entregas e
          cross join (values ('negocio', '1'), ('cliente', '2')) as t(tipo, orden)
         where v_cond is not null and e.conductor_id = v_cond and e.estado = 'entregado' and e.caja_pedido_ref is not null
           and coalesce(e.entregado_at, e.actualizado_at) >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones_salientes k
                            where k.ref = 'entrega:' || e.id and k.calificado_tipo = t.tipo)
      ) p
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.taxi_calificaciones_pendientes() from public, anon;
grant execute on function public.taxi_calificaciones_pendientes() to authenticated;

-- ---------- Receptor: cliente o negocio califican al repartidor -----------
-- data = { accion: guardar|borrar, caja_pedido_ref, autor_tipo: cliente|negocio,
--          autor_id, estrellas, comentario }
create or replace function public.rpc_webhook_caja_calificacion(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d jsonb := p_payload->'data';
  v_autor text := v_d->>'autor_tipo';
  v_e public.entregas;
begin
  if v_autor not in ('cliente', 'negocio') or coalesce(v_d->>'caja_pedido_ref', '') = '' then
    return jsonb_build_object('status', 'invalido');
  end if;
  select * into v_e from public.entregas
   where caja_pedido_ref = v_d->>'caja_pedido_ref' and estado = 'entregado' and conductor_id is not null
   order by entregado_at desc nulls last
   limit 1;
  if v_e.id is null then
    return jsonb_build_object('status', 'sin_match');
  end if;
  if v_d->>'accion' = 'borrar' then
    delete from public.taxi_calificaciones
     where ref = 'entrega:' || v_e.id and autor_tipo = v_autor and calificado_tipo = 'conductor';
    return jsonb_build_object('status', 'ok');
  end if;
  if (v_d->>'estrellas')::int not between 1 and 5 then
    return jsonb_build_object('status', 'invalido');
  end if;
  insert into public.taxi_calificaciones (servicio, ref, autor_tipo, autor_id, calificado_tipo, calificado_id, estrellas, comentario)
  values ('entrega', 'entrega:' || v_e.id, v_autor, coalesce(v_d->>'autor_id', ''), 'conductor', v_e.conductor_id,
          (v_d->>'estrellas')::int, left(nullif(trim(coalesce(v_d->>'comentario', '')), ''), 280))
  on conflict (ref, autor_tipo, calificado_tipo) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, autor_id = excluded.autor_id, updated_at = now();
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.rpc_webhook_caja_calificacion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_calificacion(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
