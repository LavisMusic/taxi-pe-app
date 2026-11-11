-- =========================================================================
-- Reportes y reputación, fase 3a (Taxi-PE).
--
--   * Ocultar con reglas: el CONDUCTOR puede ocultar (y volver a mostrar)
--     un comentario sobre él (taxi_ocultar_mi_comentario). Las estrellas
--     siguen contando; los demás ven "Comentario oculto por el conductor";
--     el autor lo sigue viendo; el admin lo ve completo y puede mostrarlo.
--     Lo que ocultó la moderación (admin) el conductor no lo puede mostrar.
--     taxi_calificaciones.oculto_por: 'admin' | 'calificado'.
--   * taxi_entrega_claves(p_entrega_id): el pedido de Caja y el token de una
--     entrega, SOLO para su repartidor o para quien tiene la oferta
--     pendiente: con eso Caja le da las estrellas del negocio y del cliente
--     (caja_reputacion_entrega).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_calificaciones add column if not exists oculto_por text
  check (oculto_por is null or oculto_por in ('admin', 'calificado'));
update public.taxi_calificaciones set oculto_por = 'admin' where oculto and oculto_por is null;

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
  update public.taxi_calificaciones
     set oculto = coalesce(p_oculto, true),
         oculto_por = case when coalesce(p_oculto, true) then 'admin' end
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_ocultar_calificacion(uuid, boolean) from public, anon;
grant execute on function public.taxi_ocultar_calificacion(uuid, boolean) to authenticated;

create or replace function public.taxi_ocultar_mi_comentario(p_id uuid, p_oculto boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
  v_c public.taxi_calificaciones;
begin
  select * into v_c from public.taxi_calificaciones where id = p_id and calificado_tipo = 'conductor';
  if v_cond is null or v_c.id is null or v_c.calificado_id <> v_cond then
    raise exception 'Solo ocultas comentarios sobre ti.' using errcode = '42501';
  end if;
  if v_c.oculto_por = 'admin' then
    raise exception 'Este comentario lo ocultó la moderación.' using errcode = '42501';
  end if;
  update public.taxi_calificaciones
     set oculto = coalesce(p_oculto, true),
         oculto_por = case when coalesce(p_oculto, true) then 'calificado' end
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_ocultar_mi_comentario(uuid, boolean) from public, anon;
grant execute on function public.taxi_ocultar_mi_comentario(uuid, boolean) to authenticated;

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
  v_admin boolean := coalesce(public.taxi_es_admin(), false);
  -- El conductor ve el texto de lo que ocultó, para poder volver a mostrarlo.
  v_dueno boolean := public.taxi_mi_conductor_id() is not distinct from p_conductor_id and p_conductor_id is not null;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'servicio', k.servicio, 'estrellas', k.estrellas,
             'comentario', case when k.oculto and not v_admin and not k.mio
                                     and not (v_dueno and k.oculto_por = 'calificado') then null else k.comentario end,
             'oculto', k.oculto, 'oculto_por', k.oculto_por,
             'fecha', k.created_at, 'editado', k.updated_at > k.created_at + interval '1 minute',
             'respuesta', k.respuesta, 'respuesta_at', k.respuesta_at,
             'autor', case k.autor_tipo when 'pasajero' then 'Pasajero verificado'
                                        when 'cliente' then 'Cliente verificado'
                                        when 'negocio' then 'Negocio verificado'
                                        else 'Usuario verificado' end,
             'es_mio', k.mio,
             'ref', case when k.mio then k.ref end)
           order by k.created_at desc)
      from (
        select c.*, (c.autor_tipo = 'pasajero' and v_uid is not null and c.autor_id = v_uid::text) as mio
          from public.taxi_calificaciones c
         where c.calificado_tipo = 'conductor' and c.calificado_id = p_conductor_id
           and c.comentario is not null
           and (p_estrellas is null or c.estrellas = p_estrellas)
           and (p_antes is null or c.created_at < p_antes)
         order by c.created_at desc
         limit least(greatest(coalesce(p_limite, 15), 1), 50)
      ) k
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.taxi_comentarios_conductor(uuid, integer, timestamptz, integer) from public;
grant execute on function public.taxi_comentarios_conductor(uuid, integer, timestamptz, integer) to anon, authenticated;

-- ---------- Claves de una entrega para pedir su reputación a Caja ----------
create or replace function public.taxi_entrega_claves(p_entrega_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
  v_e public.entregas;
begin
  if v_cond is null then
    return null;
  end if;
  select * into v_e from public.entregas where id = p_entrega_id;
  if v_e.id is null or v_e.caja_pedido_ref is null then
    return null;
  end if;
  if v_e.conductor_id is distinct from v_cond
     and not exists (select 1 from public.entrega_ofertas o
                      where o.entrega_id = v_e.id and o.conductor_id = v_cond and o.estado = 'pendiente') then
    return null;
  end if;
  return jsonb_build_object('caja_pedido_ref', v_e.caja_pedido_ref, 'session_token', v_e.session_token);
end;
$$;
revoke execute on function public.taxi_entrega_claves(uuid) from public, anon;
grant execute on function public.taxi_entrega_claves(uuid) to authenticated;

notify pgrst, 'reload schema';
