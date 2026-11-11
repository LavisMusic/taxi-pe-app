-- =========================================================================
-- Reportes y reputación, fase 4a (Taxi-PE): centro de reportes de los viajes.
--
--   * taxi_viajes_hechos: copia mínima de cada viaje terminado (el chat se
--     borra a las 24 h; reportar se puede hasta 30 días después).
--   * taxi_reportes: un reporte por servicio y por sentido, atado a un
--     servicio real; motivo por tipo (+ 'otro' con descripción), foto
--     opcional en el bucket privado 'verificaciones' (carpeta reportes/<uid>/,
--     solo la ven el Admin y quien la subió). El reportado nunca sabe quién.
--     Estados: nuevo → en_revision → resuelto | descartado.
--     Acción: sin_accion | advertencia | suspension (X días) | bloqueo.
--   * taxi_sanciones: suspensión (con fecha) o bloqueo (hasta que el Admin
--     lo levante). Suspendido/bloqueado: el conductor no se conecta ni toma
--     viajes o repartos; el pasajero no pide viajes (no escribe ni acepta).
--   * mensajes_plataforma.destinatario_id: mensajes del chat fijado
--     "Taxi PE" para UNA persona (el resultado del reporte, la sanción).
--     Su aviso emergente va aparte (push_personal_pendiente) para que una
--     versión vieja de push-enviar nunca lo mande a todo el rol.
--   * Etiqueta automática 'en_observacion': 2 o más reportes con acción
--     (advertencia o más) en los últimos 90 días.
-- Entregas (cliente/negocio ↔ repartidor) y Caja: fase 4b.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Viajes terminados ----------------------------------------------
create table if not exists public.taxi_viajes_hechos (
  oferta_id     uuid primary key,
  pasajero_id   uuid not null,
  conductor_id  uuid not null,
  finalizado_at timestamptz not null
);
create index if not exists taxi_viajes_hechos_pasajero_idx on public.taxi_viajes_hechos (pasajero_id, finalizado_at desc);
create index if not exists taxi_viajes_hechos_conductor_idx on public.taxi_viajes_hechos (conductor_id, finalizado_at desc);
alter table public.taxi_viajes_hechos enable row level security;
revoke all on public.taxi_viajes_hechos from anon, authenticated;

create or replace function public.fn_taxi_viaje_hecho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'oferta' and new.estado_oferta = 'finalizado'
     and new.pasajero_id is not null and new.conductor_id is not null then
    insert into public.taxi_viajes_hechos (oferta_id, pasajero_id, conductor_id, finalizado_at)
    values (new.id, new.pasajero_id, new.conductor_id, coalesce(new.finalizado_at, now()))
    on conflict (oferta_id) do update
      set finalizado_at = coalesce(new.finalizado_at, public.taxi_viajes_hechos.finalizado_at);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_taxi_viaje_hecho on public.chat_mensajes;
create trigger trg_taxi_viaje_hecho
  after insert or update of estado_oferta, finalizado_at on public.chat_mensajes
  for each row execute function public.fn_taxi_viaje_hecho();

insert into public.taxi_viajes_hechos (oferta_id, pasajero_id, conductor_id, finalizado_at)
select id, pasajero_id, conductor_id, coalesce(finalizado_at, created_at)
  from public.chat_mensajes
 where tipo = 'oferta' and estado_oferta = 'finalizado'
   and pasajero_id is not null and conductor_id is not null
on conflict (oferta_id) do nothing;

-- ---------- Reportes -------------------------------------------------------
create table if not exists public.taxi_reportes (
  id             uuid primary key default gen_random_uuid(),
  servicio       text not null check (servicio in ('viaje', 'entrega')),
  ref            text not null,
  servicio_fecha timestamptz,
  autor_tipo     text not null check (autor_tipo in ('pasajero', 'conductor', 'negocio', 'cliente')),
  autor_id       text not null,
  autor_usuario  uuid,
  autor_nombre   text,
  reportado_tipo text not null check (reportado_tipo in ('conductor', 'pasajero')),
  reportado_id   uuid not null,
  motivo         text not null,
  descripcion    text check (descripcion is null or char_length(descripcion) <= 600),
  foto           text check (foto is null or char_length(foto) <= 300),
  estado         text not null default 'nuevo' check (estado in ('nuevo', 'en_revision', 'resuelto', 'descartado')),
  accion         text check (accion is null or accion in ('sin_accion', 'advertencia', 'suspension', 'bloqueo')),
  dias           integer check (dias is null or dias between 1 and 365),
  respuesta      text check (respuesta is null or char_length(respuesta) <= 400),
  revisado_por   uuid,
  resuelto_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ref, autor_tipo, reportado_tipo)
);
create index if not exists taxi_reportes_estado_idx on public.taxi_reportes (estado, created_at desc);
create index if not exists taxi_reportes_reportado_idx on public.taxi_reportes (reportado_tipo, reportado_id);
alter table public.taxi_reportes enable row level security;
revoke all on public.taxi_reportes from anon, authenticated;

-- ---------- Sanciones ------------------------------------------------------
create table if not exists public.taxi_sanciones (
  id            uuid primary key default gen_random_uuid(),
  cuenta_tipo   text not null check (cuenta_tipo in ('conductor', 'pasajero')),
  cuenta_id     uuid not null,
  accion        text not null check (accion in ('suspension', 'bloqueo')),
  hasta         timestamptz,
  reporte_id    uuid references public.taxi_reportes(id) on delete set null,
  motivo        text,
  creada_por    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  levantada_at  timestamptz,
  levantada_por uuid
);
create index if not exists taxi_sanciones_cuenta_idx on public.taxi_sanciones (cuenta_tipo, cuenta_id);
alter table public.taxi_sanciones enable row level security;
revoke all on public.taxi_sanciones from anon, authenticated;

-- La sanción vigente de una cuenta (el bloqueo primero) o null.
create or replace function public.taxi__sancion_activa(p_tipo text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'accion', s.accion, 'hasta', s.hasta, 'motivo', s.motivo, 'desde', s.created_at)
    from public.taxi_sanciones s
   where s.cuenta_tipo = p_tipo and s.cuenta_id = p_id and p_id is not null
     and s.levantada_at is null and (s.hasta is null or s.hasta > now())
   order by (s.hasta is null) desc, s.hasta desc
   limit 1;
$$;
revoke execute on function public.taxi__sancion_activa(text, uuid) from public, anon, authenticated;

-- ---------- Motivos --------------------------------------------------------
create or replace function public.taxi__motivo_valido(p_reportado text, p_servicio text, p_motivo text)
returns boolean
language sql
immutable
as $$
  select p_motivo = 'otro' or coalesce(case
    when p_reportado = 'conductor' and p_servicio = 'viaje'
      then p_motivo in ('manejo_peligroso', 'cobro_distinto', 'maltrato', 'vehiculo_distinto', 'no_llego')
    when p_reportado = 'conductor' and p_servicio = 'entrega'
      then p_motivo in ('pedido_danado', 'demora', 'cobro_indebido', 'maltrato')
    when p_reportado = 'pasajero'
      then p_motivo in ('no_se_presento', 'no_pago', 'maltrato', 'danos_vehiculo')
  end, false);
$$;

create or replace function public.taxi__motivo_texto(p_motivo text)
returns text
language sql
immutable
as $$
  select case p_motivo
    when 'manejo_peligroso' then 'manejo peligroso'
    when 'cobro_distinto' then 'cobró distinto a lo acordado'
    when 'maltrato' then 'maltrato o acoso'
    when 'vehiculo_distinto' then 'el vehículo o la placa no coinciden'
    when 'no_llego' then 'no llegó o canceló'
    when 'pedido_danado' then 'pedido incompleto o dañado'
    when 'demora' then 'demora excesiva'
    when 'cobro_indebido' then 'cobro indebido'
    when 'no_se_presento' then 'no se presentó'
    when 'no_pago' then 'no pagó o pagó menos'
    when 'danos_vehiculo' then 'daños al vehículo'
    else 'otro motivo'
  end;
$$;

create or replace function public.taxi__fecha_lima(p_ts timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_ts at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI');
$$;

-- ---------- Mensajes para una sola persona (chat fijado "Taxi PE") ---------
alter table public.mensajes_plataforma
  add column if not exists destinatario_id uuid references public.usuarios(id) on delete cascade;
alter table public.mensajes_plataforma
  add column if not exists push_personal_pendiente boolean not null default false;
create index if not exists mensajes_plataforma_destinatario_idx
  on public.mensajes_plataforma (destinatario_id) where destinatario_id is not null;

drop policy if exists mensajes_plataforma_leer on public.mensajes_plataforma;
create policy mensajes_plataforma_leer on public.mensajes_plataforma for select to authenticated
  using (
    public.taxi_es_admin()
    or (
      programado_para <= now()
      and (vence_at is null or vence_at > now())
      and (
        (destinatario_id is null and public.taxi_rol() = any (roles))
        or destinatario_id = auth.uid()
      )
    )
  );

-- El usuario (cuenta con sesión) de un conductor: el de su teléfono.
create or replace function public.taxi__usuario_de_conductor(p_conductor uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from public.conductores c
    join public.usuarios u on u.telefono = c.telefono
   where c.id = p_conductor
   order by (u.rol = 'conductor') desc
   limit 1;
$$;
revoke execute on function public.taxi__usuario_de_conductor(uuid) from public, anon, authenticated;

create or replace function public.taxi__mensaje_a(p_usuario uuid, p_titulo text, p_mensaje text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  if p_usuario is null then
    return;
  end if;
  select rol into v_rol from public.usuarios where id = p_usuario;
  if v_rol is null then
    return;
  end if;
  -- push_enviado_at ya puesto: el envío general nunca lo toma; el aviso
  -- emergente de esta persona sale por push_personal_pendiente.
  insert into public.mensajes_plataforma (canal, titulo, mensaje, roles, destinatario_id, push_enviado_at, push_personal_pendiente)
  values ('taxipe', p_titulo, p_mensaje, array[v_rol], p_usuario, now(), true);
  perform public.taxi_push_disparar();
exception when others then
  raise warning 'taxi__mensaje_a: %', sqlerrm;
end;
$$;
revoke execute on function public.taxi__mensaje_a(uuid, text, text) from public, anon, authenticated;

-- ---------- Reputación: 'en_observacion' -----------------------------------
create or replace function public.taxi__recalcular_reputacion(p_tipo text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_suma integer;
  v_dist jsonb;
  v_prom numeric;
  v_obs boolean;
begin
  select count(*), coalesce(sum(estrellas), 0),
         jsonb_build_object(
           '1', count(*) filter (where estrellas = 1), '2', count(*) filter (where estrellas = 2),
           '3', count(*) filter (where estrellas = 3), '4', count(*) filter (where estrellas = 4),
           '5', count(*) filter (where estrellas = 5))
    into v_total, v_suma, v_dist
    from public.taxi_calificaciones
   where calificado_tipo = p_tipo and calificado_id = p_id;
  v_prom := case when v_total > 0 then round(v_suma::numeric / v_total, 2) else 0 end;
  select count(*) >= 2 into v_obs
    from public.taxi_reportes
   where reportado_tipo = p_tipo and reportado_id = p_id and estado = 'resuelto'
     and accion in ('advertencia', 'suspension', 'bloqueo')
     and resuelto_at > now() - interval '90 days';
  insert into public.taxi_reputacion (calificado_tipo, calificado_id, total, suma, promedio, distribucion, etiqueta, updated_at)
  values (p_tipo, p_id, v_total, v_suma, v_prom, v_dist,
          case when v_obs then 'en_observacion' else public.taxi__etiqueta_auto(v_total, v_prom) end, now())
  on conflict (calificado_tipo, calificado_id) do update
    set total = excluded.total, suma = excluded.suma, promedio = excluded.promedio,
        distribucion = excluded.distribucion, etiqueta = excluded.etiqueta, updated_at = now();
end;
$$;
revoke execute on function public.taxi__recalcular_reputacion(text, uuid) from public, anon, authenticated;

-- Cada día: se quita 'en_observacion' cuando pasan los 90 días y se borran
-- los viajes de más de 4 meses.
create or replace function public.taxi_reportes_mantenimiento()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select calificado_tipo, calificado_id from public.taxi_reputacion where etiqueta = 'en_observacion' loop
    perform public.taxi__recalcular_reputacion(r.calificado_tipo, r.calificado_id);
  end loop;
  delete from public.taxi_viajes_hechos where finalizado_at < now() - interval '120 days';
end;
$$;
revoke execute on function public.taxi_reportes_mantenimiento() from public, anon, authenticated;
select cron.unschedule('taxi-reportes-mantenimiento')
where exists (select 1 from cron.job where jobname = 'taxi-reportes-mantenimiento');
select cron.schedule('taxi-reportes-mantenimiento', '17 9 * * *', $$select public.taxi_reportes_mantenimiento()$$);

-- ---------- Reportar un viaje ----------------------------------------------
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
  v_autor_tipo text;
  v_autor_id text;
  v_id uuid;
  v_desc text := nullif(trim(coalesce(p_descripcion, '')), '');
  v_foto text := nullif(trim(coalesce(p_foto, '')), '');
  v_nuevo uuid;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para reportar.' using errcode = '42501';
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
  if p_motivo = 'otro' and (v_desc is null or char_length(v_desc) < 10) then
    raise exception 'Cuéntanos qué pasó (al menos 10 letras).' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 600 then
    raise exception 'La descripción puede tener hasta 600 letras.' using errcode = '22023';
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

-- ---------- Mis reportes (pestaña "Reportes" de Mi reputación) -------------
-- { servicios: viajes de los últimos 30 días (con 'reportado'),
--   reportes: los que hice, con su estado y la respuesta }.
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
       order by v.finalizado_at desc
       limit 60
    ) s;
    select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_reportes from (
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
       order by r.created_at desc
       limit 100
    ) s;
  end if;
  return jsonb_build_object('servicios', v_servicios, 'reportes', v_reportes);
end;
$$;
revoke execute on function public.taxi_mis_reportes(text) from public, anon;
grant execute on function public.taxi_mis_reportes(text) to authenticated;

-- ---------- Mi sanción (aviso en la pantalla) -------------------------------
create or replace function public.taxi_mi_sancion()
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
    return jsonb_build_object('pasajero', null, 'conductor', null);
  end if;
  return jsonb_build_object(
    'pasajero', public.taxi__sancion_activa('pasajero', v_uid),
    'conductor', case when v_cond is not null then public.taxi__sancion_activa('conductor', v_cond) end);
end;
$$;
revoke execute on function public.taxi_mi_sancion() from public, anon;
grant execute on function public.taxi_mi_sancion() to authenticated;

-- ---------- Centro de reportes del Admin -----------------------------------
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
  if not public.taxi_es_admin() then
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
               'tipo', r.reportado_tipo, 'id', r.reportado_id,
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
grant execute on function public.taxi_admin_reportes(text) to authenticated;

-- El usuario (para el chat "Taxi PE") de una cuenta reportada.
create or replace function public.taxi__usuario_de_cuenta(p_tipo text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p_tipo = 'pasajero' then p_id else public.taxi__usuario_de_conductor(p_id) end;
$$;
revoke execute on function public.taxi__usuario_de_cuenta(text, uuid) from public, anon, authenticated;

-- p_estado: en_revision | resuelto | descartado. Al resolver: p_accion
-- (y p_dias si es suspensión). p_respuesta: lo que lee quien reportó.
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
  if not public.taxi_es_admin() then
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

  if p_estado = 'en_revision' then
    update public.taxi_reportes set estado = 'en_revision', revisado_por = auth.uid(), updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true);
  end if;

  v_fecha := to_char(coalesce(v_r.servicio_fecha, v_r.created_at) at time zone 'America/Lima', 'DD/MM');
  v_motivo := public.taxi__motivo_texto(v_r.motivo);
  if v_r.reportado_tipo = 'conductor' then
    select nombre into v_nombre from public.conductores where id = v_r.reportado_id;
  else
    select case when nombre_usuario is not null and nombre_usuario !~ '^\d{6,}$' then '@' || nombre_usuario else nombre end
      into v_nombre from public.usuarios where id = v_r.reportado_id;
  end if;
  v_nombre := coalesce(v_nombre, case when v_r.reportado_tipo = 'conductor' then 'el conductor' else 'el pasajero' end);

  if p_estado = 'descartado' then
    update public.taxi_reportes
       set estado = 'descartado', accion = null, respuesta = v_resp, revisado_por = auth.uid(),
           resuelto_at = now(), updated_at = now()
     where id = p_id;
    perform public.taxi__mensaje_a(v_r.autor_usuario, 'Revisamos tu reporte',
      'Revisamos tu reporte sobre ' || v_nombre || ' (' || v_fecha || ') y lo cerramos sin medidas.'
      || coalesce(' ' || v_resp, ''));
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
  perform public.taxi__mensaje_a(v_r.autor_usuario, 'Revisamos tu reporte',
    'Gracias por avisarnos sobre ' || v_nombre || ' (' || v_fecha || '). '
    || case when p_accion = 'sin_accion' then 'Lo revisamos y por ahora no tomamos medidas.'
            else 'Tomamos medidas con esa cuenta.' end
    || coalesce(' ' || v_resp, ''));

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
grant execute on function public.taxi_admin_resolver_reporte(uuid, text, text, integer, text) to authenticated;

create or replace function public.taxi_admin_levantar_sancion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.taxi_sanciones;
begin
  if not public.taxi_es_admin() then
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
grant execute on function public.taxi_admin_levantar_sancion(uuid) to authenticated;

-- ---------- Lo que la sanción impide (en la base) ---------------------------
-- Conductor: no pasa a Activo/Ocupado ni enciende el modo delivery.
create or replace function public.fn_taxi_sancion_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.taxi_es_admin() then
    return new;
  end if;
  if ((new.estado in ('activo', 'ocupado') and new.estado is distinct from old.estado)
      or (new.modo_delivery and not coalesce(old.modo_delivery, false)))
     and public.taxi__sancion_activa('conductor', new.id) is not null then
    raise exception 'Tu cuenta está suspendida por un reporte: no puedes conectarte por ahora.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_taxi_sancion_conductor on public.conductores;
create trigger trg_taxi_sancion_conductor
  before update of estado, modo_delivery on public.conductores
  for each row execute function public.fn_taxi_sancion_conductor();

-- Repartos: no toma entregas.
create or replace function public.fn_taxi_sancion_entrega()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conductor_id is not null and new.conductor_id is distinct from old.conductor_id
     and public.taxi__sancion_activa('conductor', new.conductor_id) is not null then
    raise exception 'Tu cuenta está suspendida por un reporte: no puedes tomar repartos por ahora.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_taxi_sancion_entrega on public.entregas;
create trigger trg_taxi_sancion_entrega
  before update of conductor_id on public.entregas
  for each row execute function public.fn_taxi_sancion_entrega();

-- Chat de viajes: el sancionado no escribe ni manda ofertas; el pasajero
-- sancionado no acepta ofertas.
create or replace function public.fn_taxi_sancion_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.taxi_es_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.remitente = 'pasajero' and public.taxi__sancion_activa('pasajero', new.pasajero_id) is not null then
      raise exception 'Tu cuenta está suspendida por un reporte: no puedes pedir viajes por ahora.' using errcode = '42501';
    end if;
    if new.remitente = 'conductor' and public.taxi__sancion_activa('conductor', new.conductor_id) is not null then
      raise exception 'Tu cuenta está suspendida por un reporte: no puedes tomar viajes por ahora.' using errcode = '42501';
    end if;
  elsif new.estado_oferta = 'aceptada' and new.estado_oferta is distinct from old.estado_oferta
        and public.taxi__sancion_activa('pasajero', new.pasajero_id) is not null then
    raise exception 'Tu cuenta está suspendida por un reporte: no puedes pedir viajes por ahora.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_taxi_sancion_chat on public.chat_mensajes;
create trigger trg_taxi_sancion_chat
  before insert or update of estado_oferta on public.chat_mensajes
  for each row execute function public.fn_taxi_sancion_chat();
