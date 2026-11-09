-- =========================================================================
-- Reportes y reputación, fase 1a (Taxi-PE): calificaciones de los viajes.
--
--   * taxi_calificaciones: 1–5 estrellas + comentario opcional, SIEMPRE
--     atadas a un servicio real (ref 'viaje:<id de la oferta finalizada>'),
--     una por servicio y por sentido (pasajero → conductor y conductor →
--     pasajero), con 7 días para calificar o cambiarla. 'entrega' queda
--     lista para la fase 1b (entregas, por el webhook de Caja).
--   * taxi_reputacion: promedio, total, distribución y etiqueta automática
--     de cada conductor/pasajero, recalculada por trigger.
--       nuevo (<3 calificaciones, sin estrellas a la vista) · confiable
--       (≥4.0) · destacado (≥4.5 y ≥10) · top (≥4.8 y ≥30) · por_mejorar
--       (<4.0). 'en_observacion' llega con los reportes (fase 4).
--   * taxi_etiquetas: etiquetas que pone el admin a mano ("Verificado"…).
--   * RPCs: taxi_calificar, taxi_calificaciones_pendientes,
--     taxi_poner_etiqueta (admin).
-- Lectura: la reputación y las etiquetas de los conductores son públicas
-- (el directorio se ve sin cuenta); las de los pasajeros, con sesión.
-- Quién calificó y los comentarios no se leen directo (fase 2: perfil).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_calificaciones (
  id uuid primary key default gen_random_uuid(),
  servicio text not null check (servicio in ('viaje', 'entrega')),
  ref text not null,
  autor_tipo text not null check (autor_tipo in ('pasajero', 'conductor', 'negocio', 'cliente')),
  autor_id text not null,
  calificado_tipo text not null check (calificado_tipo in ('conductor', 'pasajero')),
  calificado_id uuid not null,
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 280),
  oculto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ref, autor_tipo, calificado_tipo)
);
create index if not exists taxi_calificaciones_calificado_idx
  on public.taxi_calificaciones (calificado_tipo, calificado_id, created_at desc);
alter table public.taxi_calificaciones enable row level security;
revoke all on public.taxi_calificaciones from anon, authenticated;

create table if not exists public.taxi_reputacion (
  calificado_tipo text not null,
  calificado_id uuid not null,
  total integer not null default 0,
  suma integer not null default 0,
  promedio numeric(3,2) not null default 0,
  distribucion jsonb not null default '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb,
  etiqueta text not null default 'nuevo',
  updated_at timestamptz not null default now(),
  primary key (calificado_tipo, calificado_id)
);
alter table public.taxi_reputacion enable row level security;
revoke all on public.taxi_reputacion from anon, authenticated;
grant select on public.taxi_reputacion to anon, authenticated;
drop policy if exists taxi_reputacion_leer on public.taxi_reputacion;
create policy taxi_reputacion_leer on public.taxi_reputacion for select
  using (calificado_tipo = 'conductor' or auth.uid() is not null);

create table if not exists public.taxi_etiquetas (
  id uuid primary key default gen_random_uuid(),
  calificado_tipo text not null check (calificado_tipo in ('conductor', 'pasajero')),
  calificado_id uuid not null,
  etiqueta text not null check (char_length(etiqueta) between 2 and 24),
  color text not null default 'cyan' check (color in ('cyan', 'green', 'yellow', 'pink', 'orange')),
  puesta_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists taxi_etiquetas_unica
  on public.taxi_etiquetas (calificado_tipo, calificado_id, lower(etiqueta));
alter table public.taxi_etiquetas enable row level security;
revoke all on public.taxi_etiquetas from anon, authenticated;
grant select on public.taxi_etiquetas to anon, authenticated;
drop policy if exists taxi_etiquetas_leer on public.taxi_etiquetas;
create policy taxi_etiquetas_leer on public.taxi_etiquetas for select
  using (calificado_tipo = 'conductor' or auth.uid() is not null);

-- ---------- Etiqueta automática --------------------------------------------
create or replace function public.taxi__etiqueta_auto(p_total integer, p_promedio numeric)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_total, 0) < 3 then 'nuevo'
    when p_promedio >= 4.8 and p_total >= 30 then 'top'
    when p_promedio >= 4.5 and p_total >= 10 then 'destacado'
    when p_promedio >= 4.0 then 'confiable'
    else 'por_mejorar'
  end;
$$;

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
  insert into public.taxi_reputacion (calificado_tipo, calificado_id, total, suma, promedio, distribucion, etiqueta, updated_at)
  values (p_tipo, p_id, v_total, v_suma, v_prom, v_dist, public.taxi__etiqueta_auto(v_total, v_prom), now())
  on conflict (calificado_tipo, calificado_id) do update
    set total = excluded.total, suma = excluded.suma, promedio = excluded.promedio,
        distribucion = excluded.distribucion, etiqueta = excluded.etiqueta, updated_at = now();
end;
$$;
revoke execute on function public.taxi__recalcular_reputacion(text, uuid) from public, anon, authenticated;

create or replace function public.fn_taxi_calificaciones_reputacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.taxi__recalcular_reputacion(old.calificado_tipo, old.calificado_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.taxi__recalcular_reputacion(new.calificado_tipo, new.calificado_id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_taxi_calificaciones_reputacion on public.taxi_calificaciones;
create trigger trg_taxi_calificaciones_reputacion
  after insert or update or delete on public.taxi_calificaciones
  for each row execute function public.fn_taxi_calificaciones_reputacion();

-- ---------- Calificar un viaje ---------------------------------------------
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
  if coalesce(v_oferta.finalizado_at, v_oferta.created_at) < now() - interval '7 days' then
    raise exception 'Pasaron más de 7 días: ya no se puede calificar este viaje.' using errcode = '42501';
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

-- ---------- Viajes por calificar (últimos 7 días) --------------------------
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
    select jsonb_agg(x order by x->>'fecha' desc)
      from (
        -- Como pasajero: calificar al conductor.
        select jsonb_build_object(
                 'ref', 'viaje:' || m.id::text, 'servicio', 'viaje', 'fecha', coalesce(m.finalizado_at, m.created_at),
                 'calificado_tipo', 'conductor', 'calificado_id', c.id, 'nombre', c.nombre, 'foto_url', c.foto_url,
                 'detalle', c.placa) as x
          from public.chat_mensajes m
          join public.conductores c on c.id = m.conductor_id
         where m.pasajero_id = v_uid and m.tipo = 'oferta' and m.estado_oferta = 'finalizado'
           and coalesce(m.finalizado_at, m.created_at) >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones k
                            where k.ref = 'viaje:' || m.id::text and k.autor_tipo = 'pasajero' and k.calificado_tipo = 'conductor')
        union all
        -- Como conductor: calificar al pasajero.
        select jsonb_build_object(
                 'ref', 'viaje:' || m.id::text, 'servicio', 'viaje', 'fecha', coalesce(m.finalizado_at, m.created_at),
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
      ) p
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.taxi_calificaciones_pendientes() from public, anon;
grant execute on function public.taxi_calificaciones_pendientes() to authenticated;

-- ---------- Etiquetas a mano (admin) ---------------------------------------
create or replace function public.taxi_poner_etiqueta(
  p_tipo text, p_id uuid, p_etiqueta text, p_color text default 'cyan', p_quitar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_et text := trim(coalesce(p_etiqueta, ''));
begin
  if not public.taxi_es_admin() then
    raise exception 'Solo el admin pone etiquetas.' using errcode = '42501';
  end if;
  if p_tipo not in ('conductor', 'pasajero') or p_id is null then
    raise exception 'Cuenta inválida.' using errcode = '22023';
  end if;
  if p_quitar then
    delete from public.taxi_etiquetas
     where calificado_tipo = p_tipo and calificado_id = p_id and lower(etiqueta) = lower(v_et);
    return jsonb_build_object('ok', true);
  end if;
  if char_length(v_et) < 2 or char_length(v_et) > 24 then
    raise exception 'La etiqueta debe tener de 2 a 24 letras.' using errcode = '22023';
  end if;
  insert into public.taxi_etiquetas (calificado_tipo, calificado_id, etiqueta, color)
  values (p_tipo, p_id, v_et, coalesce(nullif(p_color, ''), 'cyan'))
  on conflict (calificado_tipo, calificado_id, lower(etiqueta)) do update set color = excluded.color;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_poner_etiqueta(text, uuid, text, text, boolean) from public, anon;
grant execute on function public.taxi_poner_etiqueta(text, uuid, text, text, boolean) to authenticated;

-- Realtime: las estrellas y etiquetas cambian en vivo en las tarjetas.
do $$
declare
  t text;
begin
  foreach t in array array['taxi_reputacion', 'taxi_etiquetas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
