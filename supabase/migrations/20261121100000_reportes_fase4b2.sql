-- =========================================================================
-- Reportes y reputación, fase 4b-2 (Taxi-PE): reportes que cruzan las apps.
--
--   * El cliente o el negocio de Caja reportan al REPARTIDOR (event
--     'caja.reporte'): se guarda en taxi_reportes (servicio 'entrega',
--     caja_reporte_id) y lo resuelve el Admin (o el superadmin por el
--     puente). El resultado vuelve a Caja ('taxi.reporte_resuelto') y le
--     llega a quien reportó en su chat "Tonazo".
--   * El repartidor reporta al NEGOCIO o al CLIENTE de una entrega:
--     taxi_reportar('entrega:<id>', ...) guarda una copia en
--     taxi_reportes_salientes y lo manda a Caja ('taxi.reporte'), donde lo
--     resuelve el superadmin. El resultado vuelve ('caja.reporte_resuelto')
--     y le llega al repartidor en su chat "Taxi PE".
--   * Fotos que cruzan: van directo al bucket privado de la app que
--     resuelve. Acá: verificaciones/reportes-caja/<uuid>.jpg (la sube el
--     cliente o el negocio de Caja sin sesión de Taxi; solo el Admin la ve).
--   * El superadmin ve y resuelve los reportes de Taxi-PE por el puente
--     (webhook-caja-superadmin, service_role): taxi__admin_o_puente().
--
-- Requiere: 20261119100000_reportes_fase4a.sql. Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Admin o el puente del superadmin --------------------------------
create or replace function public.taxi__admin_o_puente()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.taxi_es_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;
revoke execute on function public.taxi__admin_o_puente() from public, anon;
grant execute on function public.taxi__admin_o_puente() to authenticated, service_role;

-- ---------- Tablas ---------------------------------------------------------
alter table public.taxi_reportes add column if not exists caja_reporte_id uuid;
create unique index if not exists taxi_reportes_caja_reporte_idx
  on public.taxi_reportes (caja_reporte_id) where caja_reporte_id is not null;

-- Lo que reportó el repartidor (vive en Caja; acá su copia y su estado).
create table if not exists public.taxi_reportes_salientes (
  id              uuid primary key default gen_random_uuid(),
  entrega_id      uuid not null,
  conductor_id    uuid not null,
  caja_pedido_ref text,
  reportado_tipo  text not null check (reportado_tipo in ('negocio', 'cliente')),
  nombre          text,
  foto_url        text,
  motivo          text not null,
  descripcion     text check (descripcion is null or char_length(descripcion) <= 600),
  foto            text,
  fecha           timestamptz,
  estado          text not null default 'nuevo' check (estado in ('nuevo', 'en_revision', 'resuelto', 'descartado')),
  medidas         boolean not null default false,
  respuesta       text,
  created_at      timestamptz not null default now(),
  resuelto_at     timestamptz,
  unique (entrega_id, reportado_tipo)
);
create index if not exists taxi_reportes_salientes_conductor_idx
  on public.taxi_reportes_salientes (conductor_id, created_at desc);
alter table public.taxi_reportes_salientes enable row level security;
revoke all on public.taxi_reportes_salientes from anon, authenticated;

-- ---------- Motivos de negocio y cliente (iguales a Caja / MisReportes.jsx) --
create or replace function public.taxi__motivo_valido_caja(p_reportado text, p_motivo text)
returns boolean
language sql
immutable
as $$
  select p_motivo = 'otro' or coalesce(case
    when p_reportado = 'negocio' then p_motivo in ('producto_mal', 'cobro_indebido', 'no_entrego', 'maltrato')
    when p_reportado = 'cliente' then p_motivo in ('no_recibio', 'no_pago', 'direccion_falsa', 'maltrato')
  end, false);
$$;

-- ---------- Emisor de webhooks: + taxi.reporte y taxi.reporte_resuelto -------
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
    when 'taxi.reporte'                   then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    when 'taxi.reporte_resuelto'          then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
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

-- ---------- Reportar (viaje, o entrega del repartidor) ----------------------
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
  v_v public.taxi_viajes_hechos;
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
  select * into v_v from public.taxi_viajes_hechos where oferta_id::text = substr(p_ref, 7);
  if v_v.oferta_id is null then
    raise exception 'Solo se reportan viajes que hiciste.' using errcode = '42501';
  end if;
  if p_reportado_tipo = 'conductor' and v_v.pasajero_id = v_uid then
    v_autor_tipo := 'pasajero'; v_autor_id := v_uid::text; v_id := v_v.conductor_id;
  elsif p_reportado_tipo = 'pasajero' and v_cond is not null and v_v.conductor_id = v_cond then
    v_autor_tipo := 'conductor'; v_autor_id := v_cond::text; v_id := v_v.pasajero_id;
  else
    raise exception 'Solo reporta quien hizo el viaje.' using errcode = '42501';
  end if;
  if v_v.finalizado_at < now() - interval '30 days' then
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
  values ('viaje', p_ref, v_v.finalizado_at, v_autor_tipo, v_autor_id, v_uid,
          p_reportado_tipo, v_id, p_motivo, v_desc, v_foto)
  returning id into v_nuevo;
  return jsonb_build_object('ok', true, 'id', v_nuevo);
end;
$$;
revoke execute on function public.taxi_reportar(text, text, text, text, text) from public, anon;
grant execute on function public.taxi_reportar(text, text, text, text, text) to authenticated;

-- ---------- Mis reportes: + repartos del repartidor -------------------------
create or replace function public.taxi_mis_reportes(p_rol text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_servicios jsonb;
  v_reportes jsonb;
begin
  if v_uid is null or p_rol not in ('pasajero', 'conductor') or (p_rol = 'conductor' and v_cond is null) then
    return jsonb_build_object('servicios', '[]'::jsonb, 'reportes', '[]'::jsonb);
  end if;

  if p_rol = 'pasajero' then
    select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]'::jsonb) into v_servicios from (
      select jsonb_build_object(
               'ref', 'viaje:' || v.oferta_id, 'servicio', 'viaje', 'fecha', v.finalizado_at,
               'reportado_tipo', 'conductor', 'motivos', 'conductor',
               'nombre', c.nombre, 'foto_url', c.foto_url, 'detalle', c.placa,
               'reportado', exists (select 1 from public.taxi_reportes r
                                     where r.ref = 'viaje:' || v.oferta_id and r.autor_tipo = 'pasajero' and r.reportado_tipo = 'conductor')) as x
        from public.taxi_viajes_hechos v
        join public.conductores c on c.id = v.conductor_id
       where v.pasajero_id = v_uid and v.finalizado_at >= now() - interval '30 days'
       order by v.finalizado_at desc
       limit 60
    ) s;
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_reportes from (
      select jsonb_build_object(
               'id', r.id, 'ref', r.ref, 'servicio', r.servicio, 'fecha', r.servicio_fecha, 'motivo', r.motivo,
               'motivos', 'conductor', 'descripcion', r.descripcion, 'estado', r.estado, 'respuesta', r.respuesta,
               'medidas', r.accion in ('advertencia', 'suspension', 'bloqueo'),
               'created_at', r.created_at, 'resuelto_at', r.resuelto_at,
               'nombre', c.nombre, 'foto_url', c.foto_url, 'detalle', c.placa) as x
        from public.taxi_reportes r
        left join public.conductores c on c.id = r.reportado_id
       where r.autor_tipo = 'pasajero' and r.autor_id = v_uid::text
       order by r.created_at desc
       limit 100
    ) s;
  else
    select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]'::jsonb) into v_servicios from (
      select u2.x from (
        select jsonb_build_object(
                 'ref', 'viaje:' || v.oferta_id, 'servicio', 'viaje', 'fecha', v.finalizado_at,
                 'reportado_tipo', 'pasajero', 'motivos', 'pasajero',
                 'nombre', case when u.nombre_usuario is not null and u.nombre_usuario !~ '^\d{6,}$'
                                then '@' || u.nombre_usuario else coalesce(u.nombre, 'Pasajero') end,
                 'foto_url', u.foto_url, 'detalle', 'Pasajero',
                 'reportado', exists (select 1 from public.taxi_reportes r
                                       where r.ref = 'viaje:' || v.oferta_id and r.autor_tipo = 'conductor' and r.reportado_tipo = 'pasajero')) as x
          from public.taxi_viajes_hechos v
          join public.usuarios u on u.id = v.pasajero_id
         where v.conductor_id = v_cond and v.finalizado_at >= now() - interval '30 days'
        union all
        -- Repartos: el negocio y el cliente de cada entrega.
        select jsonb_build_object(
                 'ref', 'entrega:' || e.id, 'servicio', 'entrega', 'fecha', coalesce(e.entregado_at, e.actualizado_at),
                 'reportado_tipo', t.tipo, 'motivos', t.tipo,
                 'nombre', case when t.tipo = 'negocio' then coalesce(e.caja_sucursal, 'Tienda') else coalesce(e.cliente_nombre, 'Cliente') end,
                 'foto_url', case when t.tipo = 'negocio' then e.caja_logo_url end,
                 'detalle', case when t.tipo = 'negocio' then 'Negocio del reparto' else 'Cliente del reparto' end,
                 'reportado', exists (select 1 from public.taxi_reportes_salientes s2
                                       where s2.entrega_id = e.id and s2.reportado_tipo = t.tipo))
          from public.entregas e
          cross join (values ('negocio'), ('cliente')) as t(tipo)
         where e.conductor_id = v_cond and e.estado = 'entregado' and e.caja_pedido_ref is not null
           and coalesce(e.entregado_at, e.actualizado_at) >= now() - interval '30 days'
      ) u2
      order by u2.x->>'fecha' desc
      limit 80
    ) s;
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_reportes from (
      select u3.x from (
        select jsonb_build_object(
                 'id', r.id, 'ref', r.ref, 'servicio', r.servicio, 'fecha', r.servicio_fecha, 'motivo', r.motivo,
                 'motivos', 'pasajero', 'descripcion', r.descripcion, 'estado', r.estado, 'respuesta', r.respuesta,
                 'medidas', r.accion in ('advertencia', 'suspension', 'bloqueo'),
                 'created_at', r.created_at, 'resuelto_at', r.resuelto_at,
                 'nombre', case when u.nombre_usuario is not null and u.nombre_usuario !~ '^\d{6,}$'
                                then '@' || u.nombre_usuario else coalesce(u.nombre, 'Pasajero') end,
                 'foto_url', u.foto_url, 'detalle', 'Pasajero') as x
          from public.taxi_reportes r
          left join public.usuarios u on u.id = r.reportado_id
         where r.autor_tipo = 'conductor' and r.autor_id = v_cond::text
        union all
        select jsonb_build_object(
                 'id', s3.id, 'ref', 'entrega:' || s3.entrega_id, 'servicio', 'entrega', 'fecha', s3.fecha, 'motivo', s3.motivo,
                 'motivos', s3.reportado_tipo, 'descripcion', s3.descripcion, 'estado', s3.estado, 'respuesta', s3.respuesta,
                 'medidas', s3.medidas, 'created_at', s3.created_at, 'resuelto_at', s3.resuelto_at,
                 'nombre', s3.nombre, 'foto_url', s3.foto_url,
                 'detalle', case when s3.reportado_tipo = 'negocio' then 'Negocio del reparto' else 'Cliente del reparto' end)
          from public.taxi_reportes_salientes s3
         where s3.conductor_id = v_cond
      ) u3
      order by u3.x->>'created_at' desc
      limit 100
    ) s;
  end if;
  return jsonb_build_object('servicios', v_servicios, 'reportes', v_reportes);
end;
$$;
revoke execute on function public.taxi_mis_reportes(text) from public, anon;
grant execute on function public.taxi_mis_reportes(text) to authenticated;

-- ---------- Centro de reportes: Admin o el superadmin por el puente ---------
create or replace function public.taxi_admin_reportes(p_estado text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lista jsonb;
  v_conteo jsonb;
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'nuevo', count(*) filter (where estado = 'nuevo'),
           'en_revision', count(*) filter (where estado = 'en_revision'),
           'resuelto', count(*) filter (where estado = 'resuelto'),
           'descartado', count(*) filter (where estado = 'descartado'))
    into v_conteo from public.taxi_reportes;

  select coalesce(jsonb_agg(x order by (x->>'orden')::int, x->>'created_at' desc), '[]'::jsonb) into v_lista from (
    select jsonb_build_object(
             'id', r.id, 'servicio', r.servicio, 'ref', r.ref, 'fecha', r.servicio_fecha,
             'motivo', r.motivo, 'motivo_texto', public.taxi__motivo_texto(r.motivo),
             'descripcion', r.descripcion, 'foto', r.foto, 'estado', r.estado, 'accion', r.accion,
             'dias', r.dias, 'respuesta', r.respuesta, 'created_at', r.created_at, 'resuelto_at', r.resuelto_at,
             'orden', case r.estado when 'nuevo' then 1 when 'en_revision' then 2 else 3 end,
             'autor', jsonb_build_object(
               'tipo', r.autor_tipo,
               'nombre', coalesce(au.nombre, ac.nombre, r.autor_nombre, initcap(r.autor_tipo)),
               'usuario', au.nombre_usuario,
               'telefono', coalesce(au.telefono, ac.telefono, case when r.autor_tipo = 'cliente' then r.autor_id end),
               'foto_url', coalesce(au.foto_url, ac.foto_url)),
             'reportado', jsonb_build_object(
               'tipo', case when r.servicio = 'entrega' and r.reportado_tipo = 'conductor' then 'repartidor' else r.reportado_tipo end,
               'id', r.reportado_id,
               'nombre', coalesce(rc.nombre, ru.nombre, 'Cuenta'),
               'usuario', ru.nombre_usuario,
               'telefono', coalesce(rc.telefono, ru.telefono),
               'foto_url', coalesce(rc.foto_url, ru.foto_url),
               'detalle', rc.placa,
               'reputacion', (select jsonb_build_object('total', p.total, 'promedio', p.promedio, 'etiqueta', p.etiqueta)
                                from public.taxi_reputacion p
                               where p.calificado_tipo = r.reportado_tipo and p.calificado_id = r.reportado_id),
               'reportes', (select count(*) from public.taxi_reportes o
                             where o.reportado_tipo = r.reportado_tipo and o.reportado_id = r.reportado_id),
               'con_accion', (select count(*) from public.taxi_reportes o
                               where o.reportado_tipo = r.reportado_tipo and o.reportado_id = r.reportado_id
                                 and o.estado = 'resuelto' and o.accion in ('advertencia', 'suspension', 'bloqueo')),
               'sancion', public.taxi__sancion_activa(r.reportado_tipo, r.reportado_id))) as x
      from public.taxi_reportes r
      left join public.usuarios au on r.autor_tipo = 'pasajero' and au.id::text = r.autor_id
      left join public.conductores ac on r.autor_tipo = 'conductor' and ac.id::text = r.autor_id
      left join public.conductores rc on r.reportado_tipo = 'conductor' and rc.id = r.reportado_id
      left join public.usuarios ru on r.reportado_tipo = 'pasajero' and ru.id = r.reportado_id
     where p_estado is null or r.estado = p_estado
     order by case r.estado when 'nuevo' then 1 when 'en_revision' then 2 else 3 end, r.created_at desc
     limit 300
  ) s;
  return jsonb_build_object('reportes', v_lista, 'conteo', v_conteo);
end;
$$;
revoke execute on function public.taxi_admin_reportes(text) from public, anon;
grant execute on function public.taxi_admin_reportes(text) to authenticated, service_role;

-- Resultado para quien reportó: en Taxi PE por su chat; si vino de Caja,
-- vuelve a Caja ('taxi.reporte_resuelto') y le llega en su chat Tonazo.
create or replace function public.taxi__avisar_autor(
  p_r public.taxi_reportes, p_estado text, p_medidas boolean, p_texto text, p_respuesta text, p_nombre text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_r.caja_reporte_id is not null then
    perform public.fn_webhook_emitir('taxi.reporte_resuelto', 'caja', jsonb_build_object(
      'caja_reporte_id', p_r.caja_reporte_id, 'estado', p_estado, 'medidas', p_medidas,
      'respuesta', p_respuesta, 'nombre', p_nombre));
  elsif p_texto is not null then
    perform public.taxi__mensaje_a(p_r.autor_usuario, 'Revisamos tu reporte', p_texto);
  end if;
exception when others then
  raise warning 'taxi__avisar_autor: %', sqlerrm;
end;
$$;
revoke execute on function public.taxi__avisar_autor(public.taxi_reportes, text, boolean, text, text, text) from public, anon, authenticated;

create or replace function public.taxi_admin_resolver_reporte(
  p_id uuid, p_estado text, p_accion text default null, p_dias integer default null, p_respuesta text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.taxi_reportes;
  v_resp text := nullif(trim(coalesce(p_respuesta, '')), '');
  v_hasta timestamptz;
  v_fecha text;
  v_nombre text;
  v_motivo text;
  v_texto text;
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador.' using errcode = '42501';
  end if;
  select * into v_r from public.taxi_reportes where id = p_id for update;
  if v_r.id is null then
    raise exception 'Ese reporte no existe.' using errcode = '22023';
  end if;
  if v_r.estado in ('resuelto', 'descartado') then
    raise exception 'Ese reporte ya se cerró.' using errcode = '22023';
  end if;
  if v_resp is not null and char_length(v_resp) > 400 then
    raise exception 'La respuesta puede tener hasta 400 letras.' using errcode = '22023';
  end if;

  v_fecha := to_char(coalesce(v_r.servicio_fecha, v_r.created_at) at time zone 'America/Lima', 'DD/MM');
  v_motivo := public.taxi__motivo_texto(v_r.motivo);
  if v_r.reportado_tipo = 'conductor' then
    select nombre into v_nombre from public.conductores where id = v_r.reportado_id;
  else
    select case when nombre_usuario is not null and nombre_usuario !~ '^\d{6,}$' then '@' || nombre_usuario else nombre end
      into v_nombre from public.usuarios where id = v_r.reportado_id;
  end if;
  v_nombre := coalesce(v_nombre, case when v_r.reportado_tipo = 'conductor'
                                      then case when v_r.servicio = 'entrega' then 'el repartidor' else 'el conductor' end
                                      else 'el pasajero' end);

  if p_estado = 'en_revision' then
    update public.taxi_reportes set estado = 'en_revision', revisado_por = auth.uid(), updated_at = now() where id = p_id;
    perform public.taxi__avisar_autor(v_r, 'en_revision', false, null, null, v_nombre);
    return jsonb_build_object('ok', true);
  end if;

  if p_estado = 'descartado' then
    update public.taxi_reportes
       set estado = 'descartado', accion = null, respuesta = v_resp, revisado_por = auth.uid(),
           resuelto_at = now(), updated_at = now()
     where id = p_id;
    perform public.taxi__avisar_autor(v_r, 'descartado', false,
      'Revisamos tu reporte sobre ' || v_nombre || ' (' || v_fecha || ') y lo cerramos sin medidas.'
      || coalesce(' ' || v_resp, ''), v_resp, v_nombre);
    return jsonb_build_object('ok', true);
  end if;

  if p_estado <> 'resuelto' then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  if p_accion is null or p_accion not in ('sin_accion', 'advertencia', 'suspension', 'bloqueo') then
    raise exception 'Elige qué hacer.' using errcode = '22023';
  end if;
  if p_accion = 'suspension' and (p_dias is null or p_dias < 1 or p_dias > 365) then
    raise exception 'Elige de 1 a 365 días de suspensión.' using errcode = '22023';
  end if;

  update public.taxi_reportes
     set estado = 'resuelto', accion = p_accion, dias = case when p_accion = 'suspension' then p_dias end,
         respuesta = v_resp, revisado_por = auth.uid(), resuelto_at = now(), updated_at = now()
   where id = p_id;

  if p_accion in ('suspension', 'bloqueo') then
    v_hasta := case when p_accion = 'suspension' then now() + make_interval(days => p_dias) end;
    insert into public.taxi_sanciones (cuenta_tipo, cuenta_id, accion, hasta, reporte_id, motivo)
    values (v_r.reportado_tipo, v_r.reportado_id, p_accion, v_hasta, p_id, v_r.motivo);
    if v_r.reportado_tipo = 'conductor' then
      update public.conductores
         set estado = case when estado in ('activo', 'ocupado') then 'desconectado' else estado end,
             modo_delivery = false
       where id = v_r.reportado_id;
    end if;
  end if;

  -- A quien reportó (nunca se le dice a nadie quién reportó).
  perform public.taxi__avisar_autor(v_r, 'resuelto', p_accion <> 'sin_accion',
    'Gracias por avisarnos sobre ' || v_nombre || ' (' || v_fecha || '). '
    || case when p_accion = 'sin_accion' then 'Lo revisamos y por ahora no tomamos medidas.'
            else 'Tomamos medidas con esa cuenta.' end
    || coalesce(' ' || v_resp, ''), v_resp, v_nombre);

  -- Al reportado, solo si hay medida.
  if p_accion <> 'sin_accion' then
    v_texto := case p_accion
      when 'advertencia' then 'Recibiste una advertencia por un reporte sobre un '
        || case when v_r.servicio = 'viaje' then 'viaje' else 'reparto' end || ' del ' || v_fecha
        || ' (motivo: ' || v_motivo || '). Si se repite, tu cuenta puede ser suspendida.'
      when 'suspension' then 'Tu cuenta está suspendida hasta el ' || public.taxi__fecha_lima(v_hasta)
        || ' por un reporte sobre un ' || case when v_r.servicio = 'viaje' then 'viaje' else 'reparto' end
        || ' del ' || v_fecha || ' (motivo: ' || v_motivo || ').'
      else 'Tu cuenta fue bloqueada por un reporte sobre un '
        || case when v_r.servicio = 'viaje' then 'viaje' else 'reparto' end || ' del ' || v_fecha
        || ' (motivo: ' || v_motivo || '). Escríbenos si quieres que lo revisemos.'
    end;
    perform public.taxi__mensaje_a(public.taxi__usuario_de_cuenta(v_r.reportado_tipo, v_r.reportado_id),
      case p_accion when 'advertencia' then 'Advertencia' when 'suspension' then 'Cuenta suspendida' else 'Cuenta bloqueada' end,
      v_texto);
  end if;

  perform public.taxi__recalcular_reputacion(v_r.reportado_tipo, v_r.reportado_id);
  return jsonb_build_object('ok', true, 'hasta', v_hasta);
end;
$$;
revoke execute on function public.taxi_admin_resolver_reporte(uuid, text, text, integer, text) from public, anon;
grant execute on function public.taxi_admin_resolver_reporte(uuid, text, text, integer, text) to authenticated, service_role;

create or replace function public.taxi_admin_levantar_sancion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.taxi_sanciones;
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador.' using errcode = '42501';
  end if;
  update public.taxi_sanciones set levantada_at = now(), levantada_por = auth.uid()
   where id = p_id and levantada_at is null
  returning * into v_s;
  if v_s.id is null then
    raise exception 'Esa sanción ya no está vigente.' using errcode = '22023';
  end if;
  perform public.taxi__mensaje_a(public.taxi__usuario_de_cuenta(v_s.cuenta_tipo, v_s.cuenta_id),
    'Cuenta habilitada', 'Tu cuenta ya está habilitada de nuevo. ¡Gracias por tu paciencia!');
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_admin_levantar_sancion(uuid) from public, anon;
grant execute on function public.taxi_admin_levantar_sancion(uuid) to authenticated, service_role;

-- ---------- Receptor de Caja: caja.reporte y caja.reporte_resuelto ----------
-- caja.reporte: data = { caja_reporte_id, caja_pedido_ref, autor_tipo
--   (cliente|negocio), autor_id, autor_nombre, motivo, descripcion, foto }
-- caja.reporte_resuelto: data = { taxi_reporte_id, estado, medidas, respuesta }
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
    select * into v_e from public.entregas
     where caja_pedido_ref = v_d->>'caja_pedido_ref' and estado = 'entregado' and conductor_id is not null
     order by entregado_at desc nulls last
     limit 1;
    if v_e.id is null then
      return jsonb_build_object('status', 'sin_match');
    end if;
    insert into public.taxi_reportes (servicio, ref, servicio_fecha, autor_tipo, autor_id, autor_nombre,
                                      reportado_tipo, reportado_id, motivo, descripcion, foto, caja_reporte_id)
    values ('entrega', 'entrega:' || v_e.id, coalesce(v_e.entregado_at, v_e.actualizado_at), v_d->>'autor_tipo',
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

-- ---------- Foto que sube el cliente o el negocio de Caja -------------------
-- No tienen sesión de Taxi-PE: pueden SUBIR (no ver ni pisar) a la carpeta
-- reportes-caja/ del bucket privado. Solo el Admin la ve (política
-- archivos_ver_verificaciones); el superadmin, por el puente.
drop policy if exists archivos_subir_reporte_caja on storage.objects;
create policy archivos_subir_reporte_caja on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'verificaciones' and name ~ '^reportes-caja/[0-9a-f-]{36}\.jpg$');

notify pgrst, 'reload schema';
