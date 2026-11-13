-- =========================================================================
-- Reportes, fase B (Taxi-PE): reportar desde más lugares.
--
--   * taxi_reportar: un viaje también se puede reportar EN CURSO (oferta
--     aceptada o con el pasajero a bordo), no solo terminado. La referencia
--     es la misma ('viaje:<oferta>'), así que sigue siendo un reporte por
--     viaje y por lado.
--   * rpc_webhook_caja_reporte: Caja ya manda reportes del repartidor
--     mientras el cliente espera (reparto aceptado o en ruta).
--   * taxi_calificaciones_pendientes: lo que ya reportaste sale de "Por
--     calificar" (reportar desde la ventana de calificar reemplaza a las
--     estrellas). La función de siempre queda como
--     taxi__calificaciones_pendientes_base.
--   * taxi_servicio_para_reportar(ref | conductor): arma lo que muestra la
--     ventana de reporte (nombre, foto, placa, fecha y si ya lo reportaste)
--     para un viaje tuyo, o tu viaje más reciente (30 días) con ese
--     conductor (botón "Reportar" de su página).
--
-- Requiere: 20261121100000_reportes_fase4b2.sql. Proyecto: Taxi-PE.
-- Idempotente.
-- =========================================================================

-- ---------- Viaje en curso o terminado (para reportar) ----------------------
-- Devuelve (oferta, pasajero, conductor, fecha) del viaje; en curso, la
-- fecha es ahora.
create or replace function public.taxi__viaje_para_reportar(p_ref text)
returns table (oferta_id uuid, pasajero_id uuid, conductor_id uuid, fecha timestamptz, en_curso boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.oferta_id, v.pasajero_id, v.conductor_id, v.finalizado_at, false
    from public.taxi_viajes_hechos v
   where p_ref like 'viaje:%' and v.oferta_id::text = substr(p_ref, 7)
  union all
  select m.id, m.pasajero_id, m.conductor_id, now(), true
    from public.chat_mensajes m
   where p_ref like 'viaje:%' and m.id::text = substr(p_ref, 7)
     and m.tipo = 'oferta' and m.estado_oferta in ('aceptada', 'en_transito')
     and not exists (select 1 from public.taxi_viajes_hechos h where h.oferta_id = m.id)
  limit 1;
$$;
revoke execute on function public.taxi__viaje_para_reportar(text) from public, anon, authenticated;

-- ---------- Reportar (viaje terminado o en curso, o entrega) ----------------
create or replace function public.taxi_reportar(
  p_ref text, p_reportado_tipo text, p_motivo text, p_descripcion text default null, p_foto text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_v record;
  v_e public.entregas;
  v_autor_tipo text;
  v_autor_id text;
  v_id uuid;
  v_desc text := nullif(trim(coalesce(p_descripcion, '')), '');
  v_foto text := nullif(trim(coalesce(p_foto, '')), '');
  v_fecha timestamptz;
  v_nombre text;
  v_nuevo uuid;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para reportar.' using errcode = '42501';
  end if;
  if v_desc is not null and char_length(v_desc) > 600 then
    raise exception 'La descripción puede tener hasta 600 letras.' using errcode = '22023';
  end if;
  if coalesce(p_motivo, '') = 'otro' and (v_desc is null or char_length(v_desc) < 10) then
    raise exception 'Cuéntanos qué pasó (al menos 10 letras).' using errcode = '22023';
  end if;

  -- El repartidor reporta al negocio o al cliente de una entrega (lo
  -- resuelve el superadmin en Caja).
  if p_ref like 'entrega:%' then
    if v_cond is null then
      raise exception 'Solo reporta quien hizo el reparto.' using errcode = '42501';
    end if;
    select * into v_e from public.entregas where id::text = substr(p_ref, 9) and conductor_id = v_cond;
    if v_e.id is null or v_e.estado <> 'entregado' or v_e.caja_pedido_ref is null then
      raise exception 'Solo se reportan repartos que hiciste.' using errcode = '42501';
    end if;
    v_fecha := coalesce(v_e.entregado_at, v_e.actualizado_at);
    if v_fecha < now() - interval '30 days' then
      raise exception 'Pasaron más de 30 días: ya no se puede reportar este reparto.' using errcode = '42501';
    end if;
    if p_reportado_tipo not in ('negocio', 'cliente') or not public.taxi__motivo_valido_caja(p_reportado_tipo, coalesce(p_motivo, '')) then
      raise exception 'Elige un motivo.' using errcode = '22023';
    end if;
    if v_foto is not null and v_foto !~ '^privado:reportes-taxi/[0-9a-f-]{36}\.jpg$' then
      raise exception 'Foto inválida.' using errcode = '22023';
    end if;
    if exists (select 1 from public.taxi_reportes_salientes where entrega_id = v_e.id and reportado_tipo = p_reportado_tipo) then
      raise exception 'Ya reportaste este reparto.' using errcode = '23505';
    end if;
    insert into public.taxi_reportes_salientes (entrega_id, conductor_id, caja_pedido_ref, reportado_tipo, nombre, foto_url,
                                                motivo, descripcion, foto, fecha)
    values (v_e.id, v_cond, v_e.caja_pedido_ref, p_reportado_tipo,
            case when p_reportado_tipo = 'negocio' then coalesce(v_e.caja_sucursal, 'Tienda') else coalesce(v_e.cliente_nombre, 'Cliente') end,
            case when p_reportado_tipo = 'negocio' then v_e.caja_logo_url end,
            p_motivo, v_desc, v_foto, v_fecha)
    returning id into v_nuevo;
    select nombre into v_nombre from public.conductores where id = v_cond;
    perform public.fn_webhook_emitir('taxi.reporte', 'caja', jsonb_build_object(
      'taxi_reporte_id', v_nuevo, 'caja_pedido_ref', v_e.caja_pedido_ref, 'conductor_id', v_cond,
      'conductor_nombre', v_nombre, 'reportado_tipo', p_reportado_tipo, 'motivo', p_motivo,
      'descripcion', v_desc, 'foto', v_foto, 'fecha', v_fecha));
    return jsonb_build_object('ok', true, 'id', v_nuevo);
  end if;

  if p_ref is null or p_ref not like 'viaje:%' then
    raise exception 'Servicio inválido.' using errcode = '22023';
  end if;
  select * into v_v from public.taxi__viaje_para_reportar(p_ref);
  if v_v.oferta_id is null then
    raise exception 'Solo se reportan viajes que hiciste (en curso o terminados).' using errcode = '42501';
  end if;
  if p_reportado_tipo = 'conductor' and v_v.pasajero_id = v_uid then
    v_autor_tipo := 'pasajero'; v_autor_id := v_uid::text; v_id := v_v.conductor_id;
  elsif p_reportado_tipo = 'pasajero' and v_cond is not null and v_v.conductor_id = v_cond then
    v_autor_tipo := 'conductor'; v_autor_id := v_cond::text; v_id := v_v.pasajero_id;
  else
    raise exception 'Solo reporta quien hizo el viaje.' using errcode = '42501';
  end if;
  if v_v.fecha < now() - interval '30 days' then
    raise exception 'Pasaron más de 30 días: ya no se puede reportar este viaje.' using errcode = '42501';
  end if;
  if not public.taxi__motivo_valido(p_reportado_tipo, 'viaje', coalesce(p_motivo, '')) then
    raise exception 'Elige un motivo.' using errcode = '22023';
  end if;
  if v_foto is not null and v_foto !~ ('^privado:reportes/' || v_uid::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'Foto inválida.' using errcode = '22023';
  end if;
  if exists (select 1 from public.taxi_reportes
              where ref = p_ref and autor_tipo = v_autor_tipo and reportado_tipo = p_reportado_tipo) then
    raise exception 'Ya reportaste este viaje.' using errcode = '23505';
  end if;

  insert into public.taxi_reportes (servicio, ref, servicio_fecha, autor_tipo, autor_id, autor_usuario,
                                    reportado_tipo, reportado_id, motivo, descripcion, foto)
  values ('viaje', p_ref, v_v.fecha, v_autor_tipo, v_autor_id, v_uid,
          p_reportado_tipo, v_id, p_motivo, v_desc, v_foto)
  returning id into v_nuevo;
  return jsonb_build_object('ok', true, 'id', v_nuevo);
end;
$$;
revoke execute on function public.taxi_reportar(text, text, text, text, text) from public, anon;
grant execute on function public.taxi_reportar(text, text, text, text, text) to authenticated;

-- ---------- Reportes de Caja sobre el repartidor (también en curso) ---------
create or replace function public.rpc_webhook_caja_reporte(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_payload->>'event_type';
  v_d jsonb := p_payload->'data';
  v_e public.entregas;
  v_s public.taxi_reportes_salientes;
  v_estado text := v_d->>'estado';
  v_fecha text;
  v_resp text;
  v_texto text;
  v_desc text;
  v_foto text;
begin
  if v_tipo = 'caja.reporte' then
    if v_d->>'autor_tipo' not in ('cliente', 'negocio') or coalesce(v_d->>'caja_pedido_ref', '') = ''
       or coalesce(v_d->>'caja_reporte_id', '') = ''
       or not public.taxi__motivo_valido('conductor', 'entrega', coalesce(v_d->>'motivo', '')) then
      return jsonb_build_object('status', 'invalido');
    end if;
    v_foto := nullif(trim(coalesce(v_d->>'foto', '')), '');
    if v_foto is not null and v_foto !~ '^privado:reportes-caja/[0-9a-f-]{36}\.jpg$' then
      v_foto := null;
    end if;
    v_desc := left(nullif(trim(coalesce(v_d->>'descripcion', '')), ''), 600);
    -- Entregado, o todavía en camino (el cliente reporta mientras espera).
    select * into v_e from public.entregas
     where caja_pedido_ref = v_d->>'caja_pedido_ref' and estado in ('entregado', 'aceptado', 'en_ruta')
       and conductor_id is not null
     order by (estado = 'entregado') desc, entregado_at desc nulls last, actualizado_at desc nulls last
     limit 1;
    if v_e.id is null then
      return jsonb_build_object('status', 'sin_match');
    end if;
    insert into public.taxi_reportes (servicio, ref, servicio_fecha, autor_tipo, autor_id, autor_nombre,
                                      reportado_tipo, reportado_id, motivo, descripcion, foto, caja_reporte_id)
    values ('entrega', 'entrega:' || v_e.id, coalesce(v_e.entregado_at, v_e.actualizado_at, now()), v_d->>'autor_tipo',
            coalesce(v_d->>'autor_id', ''), left(v_d->>'autor_nombre', 120), 'conductor', v_e.conductor_id,
            v_d->>'motivo', v_desc, v_foto, (v_d->>'caja_reporte_id')::uuid)
    on conflict do nothing;
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tipo = 'caja.reporte_resuelto' then
    if v_estado not in ('en_revision', 'resuelto', 'descartado') or coalesce(v_d->>'taxi_reporte_id', '') = '' then
      return jsonb_build_object('status', 'invalido');
    end if;
    v_resp := left(nullif(trim(coalesce(v_d->>'respuesta', '')), ''), 400);
    update public.taxi_reportes_salientes
       set estado = v_estado, medidas = coalesce((v_d->>'medidas')::boolean, false), respuesta = v_resp,
           resuelto_at = case when v_estado in ('resuelto', 'descartado') then now() end
     where id = (v_d->>'taxi_reporte_id')::uuid and estado not in ('resuelto', 'descartado')
    returning * into v_s;
    if v_s.id is null then
      return jsonb_build_object('status', 'duplicado');
    end if;
    if v_estado in ('resuelto', 'descartado') then
      v_fecha := to_char(coalesce(v_s.fecha, v_s.created_at) at time zone 'America/Lima', 'DD/MM');
      v_texto := case
        when v_estado = 'descartado' then 'Revisamos tu reporte sobre ' || coalesce(v_s.nombre, 'el reparto') || ' (' || v_fecha || ') y lo cerramos sin medidas.'
        when v_s.medidas then 'Gracias por avisarnos sobre ' || coalesce(v_s.nombre, 'el reparto') || ' (' || v_fecha || '). Tomamos medidas con esa cuenta.'
        else 'Gracias por avisarnos sobre ' || coalesce(v_s.nombre, 'el reparto') || ' (' || v_fecha || '). Lo revisamos y por ahora no tomamos medidas.'
      end || coalesce(' ' || v_resp, '');
      perform public.taxi__mensaje_a(public.taxi__usuario_de_conductor(v_s.conductor_id), 'Revisamos tu reporte', v_texto);
    end if;
    return jsonb_build_object('status', 'ok');
  end if;

  return jsonb_build_object('status', 'invalido');
end;
$$;
revoke execute on function public.rpc_webhook_caja_reporte(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_reporte(uuid, jsonb) to service_role;

-- ---------- "Por calificar" sin lo ya reportado -----------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'taxi__calificaciones_pendientes_base'
  ) then
    alter function public.taxi_calificaciones_pendientes() rename to taxi__calificaciones_pendientes_base;
  end if;
end;
$$;
revoke execute on function public.taxi__calificaciones_pendientes_base() from public, anon, authenticated;

create or replace function public.taxi_calificaciones_pendientes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
    from jsonb_array_elements(public.taxi__calificaciones_pendientes_base()) with ordinality as t(x, o)
   where not (
     case
       when x->>'servicio' = 'entrega' then exists (
         select 1 from public.taxi_reportes_salientes s
          where s.entrega_id::text = x->>'entrega_id' and s.reportado_tipo = x->>'calificado_tipo')
       when x->>'calificado_tipo' = 'conductor' then exists (
         select 1 from public.taxi_reportes r
          where r.ref = x->>'ref' and r.autor_tipo = 'pasajero' and r.reportado_tipo = 'conductor')
       when x->>'calificado_tipo' = 'pasajero' then exists (
         select 1 from public.taxi_reportes r
          where r.ref = x->>'ref' and r.autor_tipo = 'conductor' and r.reportado_tipo = 'pasajero')
       else false
     end
   );
$$;
revoke execute on function public.taxi_calificaciones_pendientes() from public, anon;
grant execute on function public.taxi_calificaciones_pendientes() to authenticated;

-- ---------- Lo que muestra la ventana de reporte ----------------------------
-- p_ref: un viaje tuyo (en curso o terminado) → el otro lado.
-- p_conductor_id: tu viaje más reciente (30 días) con ese conductor.
-- Devuelve null si no hay nada que puedas reportar.
create or replace function public.taxi_servicio_para_reportar(p_ref text default null, p_conductor_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_ref text := p_ref;
  v_v record;
  v_c public.conductores;
  v_u public.usuarios;
begin
  if v_uid is null then
    return null;
  end if;
  if v_ref is null and p_conductor_id is not null then
    select 'viaje:' || x.oferta_id into v_ref
      from (
        select v.oferta_id, v.finalizado_at as fecha from public.taxi_viajes_hechos v
         where v.pasajero_id = v_uid and v.conductor_id = p_conductor_id and v.finalizado_at >= now() - interval '30 days'
        union all
        select m.id, now() from public.chat_mensajes m
         where m.pasajero_id = v_uid and m.conductor_id = p_conductor_id
           and m.tipo = 'oferta' and m.estado_oferta in ('aceptada', 'en_transito')
      ) x
     order by x.fecha desc
     limit 1;
  end if;
  if v_ref is null then
    return null;
  end if;
  select * into v_v from public.taxi__viaje_para_reportar(v_ref);
  if v_v.oferta_id is null or v_v.fecha < now() - interval '30 days' then
    return null;
  end if;
  if v_v.pasajero_id = v_uid then
    select * into v_c from public.conductores where id = v_v.conductor_id;
    return jsonb_build_object(
      'ref', v_ref, 'servicio', 'viaje', 'reportado_tipo', 'conductor', 'motivos', 'conductor',
      'nombre', coalesce(v_c.nombre, 'Tu conductor'), 'foto_url', v_c.foto_url, 'detalle', v_c.placa,
      'fecha', v_v.fecha, 'en_curso', v_v.en_curso,
      'reportado', exists (select 1 from public.taxi_reportes r
                            where r.ref = v_ref and r.autor_tipo = 'pasajero' and r.reportado_tipo = 'conductor'));
  end if;
  if v_cond is not null and v_v.conductor_id = v_cond then
    select * into v_u from public.usuarios where id = v_v.pasajero_id;
    return jsonb_build_object(
      'ref', v_ref, 'servicio', 'viaje', 'reportado_tipo', 'pasajero', 'motivos', 'pasajero',
      'nombre', case when v_u.nombre_usuario is not null and v_u.nombre_usuario !~ '^\d{6,}$'
                     then '@' || v_u.nombre_usuario else coalesce(v_u.nombre, 'Tu pasajero') end,
      'foto_url', v_u.foto_url, 'detalle', null,
      'fecha', v_v.fecha, 'en_curso', v_v.en_curso,
      'reportado', exists (select 1 from public.taxi_reportes r
                            where r.ref = v_ref and r.autor_tipo = 'conductor' and r.reportado_tipo = 'pasajero'));
  end if;
  return null;
end;
$$;
revoke execute on function public.taxi_servicio_para_reportar(text, uuid) from public, anon;
grant execute on function public.taxi_servicio_para_reportar(text, uuid) to authenticated;

notify pgrst, 'reload schema';
