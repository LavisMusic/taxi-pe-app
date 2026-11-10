-- =========================================================================
-- Reportes y reputación, fase 2 (Taxi-PE): página del conductor con
-- comentarios.
--
--   * taxi_perfil_conductor(p_clave): datos públicos del conductor por su
--     @usuario o su id (para /conductores/<usuario>): foto, portada, placa,
--     nivel, asientos, descripción, viajes y entregas completados, desde
--     cuándo, reputación (promedio, total, barras, etiqueta) y etiquetas.
--   * taxi_comentarios_conductor: los comentarios (solo los que tienen
--     texto; las estrellas solas suman al promedio y a las barras), de
--     pasajeros, clientes y negocios, SIEMPRE anónimos ("Pasajero
--     verificado"…). Al autor le llega su `ref` para editar o borrar; el
--     conductor ve si puede responder; el admin ve los ocultos.
--   * taxi_responder_calificacion: el conductor responde una vez (editar =
--     volver a responder; texto vacío = borrar la respuesta).
--   * taxi_ocultar_calificacion: el admin oculta o muestra un comentario
--     ofensivo (las estrellas siguen contando).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_calificaciones add column if not exists respuesta text
  check (respuesta is null or char_length(respuesta) <= 280);
alter table public.taxi_calificaciones add column if not exists respuesta_at timestamptz;

create or replace function public.taxi__conductor_por_clave(p_clave text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_clave text := trim(coalesce(p_clave, ''));
begin
  if v_clave ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_id from public.conductores where id = v_clave::uuid;
    return v_id;
  end if;
  select c.id into v_id
    from public.usuarios u
    join public.conductores c on c.telefono = u.telefono
   where u.rol = 'conductor' and lower(u.nombre_usuario) = lower(ltrim(v_clave, '@'))
   limit 1;
  return v_id;
end;
$$;
revoke execute on function public.taxi__conductor_por_clave(text) from public, anon, authenticated;

create or replace function public.taxi_perfil_conductor(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := public.taxi__conductor_por_clave(p_clave);
  v_c public.conductores;
  v_usuario text;
  v_rep public.taxi_reputacion;
begin
  if v_id is null then
    return null;
  end if;
  select * into v_c from public.conductores where id = v_id;
  if v_c.estado in ('rechazado', 'inhabilitado') or not coalesce(v_c.aprobado, false) then
    return null;
  end if;
  select nombre_usuario into v_usuario from public.usuarios
   where rol = 'conductor' and telefono = v_c.telefono and nombre_usuario !~ '^\d{6,}$'
   limit 1;
  select * into v_rep from public.taxi_reputacion where calificado_tipo = 'conductor' and calificado_id = v_id;
  return jsonb_build_object(
    'id', v_c.id, 'nombre', v_c.nombre, 'nombre_usuario', v_usuario,
    'foto_url', v_c.foto_url, 'foto_portada_url', v_c.foto_portada_url, 'descripcion', v_c.descripcion,
    'placa', v_c.placa, 'nivel_servicio', v_c.nivel_servicio, 'asientos_totales', v_c.asientos_totales,
    'estado', v_c.estado, 'desde', v_c.created_at,
    'viajes', (select count(*) from public.chat_mensajes
                where conductor_id = v_id and tipo = 'oferta' and estado_oferta = 'finalizado'),
    'entregas', (select count(*) from public.entregas where conductor_id = v_id and estado = 'entregado'),
    'reputacion', jsonb_build_object('total', coalesce(v_rep.total, 0), 'promedio', coalesce(v_rep.promedio, 0),
                                     'distribucion', coalesce(v_rep.distribucion, '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb),
                                     'etiqueta', coalesce(v_rep.etiqueta, 'nuevo')),
    'etiquetas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', etiqueta, 'color', color) order by created_at)
                             from public.taxi_etiquetas where calificado_tipo = 'conductor' and calificado_id = v_id), '[]'::jsonb),
    'es_mio', v_id = public.taxi_mi_conductor_id(),
    'puede_ocultar', coalesce(public.taxi_es_admin(), false)
  );
end;
$$;
revoke execute on function public.taxi_perfil_conductor(text) from public;
grant execute on function public.taxi_perfil_conductor(text) to anon, authenticated;

-- Comentarios: p_estrellas null = todos; p_antes para "Ver más".
create or replace function public.taxi_comentarios_conductor(
  p_conductor_id uuid, p_estrellas integer default null, p_antes timestamptz default null, p_limite integer default 15
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_admin boolean := coalesce(public.taxi_es_admin(), false);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'servicio', k.servicio, 'estrellas', k.estrellas,
             'comentario', case when k.oculto and not v_admin then null else k.comentario end,
             'oculto', k.oculto, 'fecha', k.created_at, 'editado', k.updated_at > k.created_at + interval '1 minute',
             'respuesta', k.respuesta, 'respuesta_at', k.respuesta_at,
             'autor', case k.autor_tipo when 'pasajero' then 'Pasajero verificado'
                                        when 'cliente' then 'Cliente verificado'
                                        when 'negocio' then 'Negocio verificado'
                                        else 'Usuario verificado' end,
             'es_mio', (k.autor_tipo = 'pasajero' and v_uid is not null and k.autor_id = v_uid::text),
             'ref', case when k.autor_tipo = 'pasajero' and v_uid is not null and k.autor_id = v_uid::text then k.ref end)
           order by k.created_at desc)
      from (
        select * from public.taxi_calificaciones
         where calificado_tipo = 'conductor' and calificado_id = p_conductor_id
           and comentario is not null
           and (p_estrellas is null or estrellas = p_estrellas)
           and (p_antes is null or created_at < p_antes)
         order by created_at desc
         limit least(greatest(coalesce(p_limite, 15), 1), 50)
      ) k
  ), '[]'::jsonb) || '[]'::jsonb;
end;
$$;
revoke execute on function public.taxi_comentarios_conductor(uuid, integer, timestamptz, integer) from public;
grant execute on function public.taxi_comentarios_conductor(uuid, integer, timestamptz, integer) to anon, authenticated;

create or replace function public.taxi_responder_calificacion(p_id uuid, p_respuesta text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
  v_txt text := nullif(trim(coalesce(p_respuesta, '')), '');
begin
  if v_cond is null then
    raise exception 'Solo el conductor responde.' using errcode = '42501';
  end if;
  if v_txt is not null and char_length(v_txt) > 280 then
    raise exception 'La respuesta puede tener hasta 280 letras.' using errcode = '22023';
  end if;
  update public.taxi_calificaciones
     set respuesta = v_txt, respuesta_at = case when v_txt is null then null else now() end
   where id = p_id and calificado_tipo = 'conductor' and calificado_id = v_cond and comentario is not null;
  if not found then
    raise exception 'Solo respondes comentarios sobre ti.' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_responder_calificacion(uuid, text) from public, anon;
grant execute on function public.taxi_responder_calificacion(uuid, text) to authenticated;

create or replace function public.taxi_ocultar_calificacion(p_id uuid, p_oculto boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi_es_admin() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;
  update public.taxi_calificaciones set oculto = coalesce(p_oculto, true) where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_ocultar_calificacion(uuid, boolean) from public, anon;
grant execute on function public.taxi_ocultar_calificacion(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
