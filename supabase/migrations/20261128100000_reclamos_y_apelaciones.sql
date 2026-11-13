-- =========================================================================
-- Fase C2 (Taxi-PE): suspensión por reclamos y apelaciones.
--
--   * Dos reclamos confirmados en 90 días ("pedido no entregado" o "dinero
--     no rendido", resueltos con una medida) suspenden al repartidor, de
--     reparto Y de taxi, hasta que el Admin lo levante (sanción sin fecha
--     de fin). Se aplica sola al resolver el segundo reclamo.
--   * Apelar: quien está suspendido o bloqueado puede apelar UNA vez por
--     sanción desde la pantalla de bloqueo (taxi_apelar_sancion). La
--     apelación sale en el centro de reportes (filtro "Apelaciones", con
--     su número en la cabecera). El Admin la levanta ("Levantar") o la
--     rechaza (taxi_admin_rechazar_apelacion); en los dos casos se le avisa
--     por su chat.
--   * taxi_admin_reportes pasa a ser un envoltorio de la función de siempre
--     (taxi__admin_reportes_base) que agrega el filtro 'apelacion' y su
--     conteo.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_sanciones add column if not exists apelacion text;
alter table public.taxi_sanciones add column if not exists apelada_at timestamptz;
alter table public.taxi_sanciones add column if not exists apelacion_resuelta_at timestamptz;
alter table public.taxi_sanciones add column if not exists apelacion_respuesta text;

-- La sanción vigente, ahora con su apelación.
create or replace function public.taxi__sancion_activa(p_tipo text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'accion', s.accion, 'hasta', s.hasta, 'motivo', s.motivo, 'desde', s.created_at,
                            'reporte_id', s.reporte_id, 'apelacion', s.apelacion, 'apelada_at', s.apelada_at,
                            'apelacion_resuelta_at', s.apelacion_resuelta_at, 'apelacion_respuesta', s.apelacion_respuesta)
    from public.taxi_sanciones s
   where s.cuenta_tipo = p_tipo and s.cuenta_id = p_id and p_id is not null
     and s.levantada_at is null and (s.hasta is null or s.hasta > now())
   order by (s.hasta is null) desc, s.hasta desc
   limit 1;
$$;
revoke execute on function public.taxi__sancion_activa(text, uuid) from public, anon, authenticated;

-- ---------- Dos reclamos = suspensión hasta que el Admin la levante ---------
create or replace function public.fn_taxi_reclamos_suspension()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'resuelto' and old.estado is distinct from 'resuelto'
     and new.reportado_tipo = 'conductor' and new.servicio = 'entrega'
     and new.motivo in ('pedido_no_entregado', 'dinero_no_rendido')
     and new.accion in ('advertencia', 'suspension', 'bloqueo')
     and public.taxi__reclamos_confirmados(new.reportado_id) >= 2
     and not exists (select 1 from public.taxi_sanciones s
                      where s.cuenta_tipo = 'conductor' and s.cuenta_id = new.reportado_id
                        and s.levantada_at is null and s.hasta is null) then
    insert into public.taxi_sanciones (cuenta_tipo, cuenta_id, accion, hasta, reporte_id, motivo)
    values ('conductor', new.reportado_id, 'suspension', null, new.id, 'reclamos');
    update public.conductores
       set estado = case when estado in ('activo', 'ocupado') then 'desconectado' else estado end,
           modo_delivery = false
     where id = new.reportado_id;
    perform public.taxi__mensaje_a(public.taxi__usuario_de_conductor(new.reportado_id), 'Cuenta suspendida',
      'Tu cuenta está suspendida (reparto y taxi) por dos reclamos confirmados en los últimos 90 días '
      || '(pedido no entregado o dinero no rendido). Seguirá así hasta que el administrador la revise. '
      || 'Si crees que es un error, puedes apelar desde la pantalla de tu cuenta.');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_taxi_reclamos_suspension on public.taxi_reportes;
create trigger trg_taxi_reclamos_suspension
  after update of estado on public.taxi_reportes
  for each row execute function public.fn_taxi_reclamos_suspension();

-- ---------- Apelar (el sancionado) ------------------------------------------
create or replace function public.taxi_apelar_sancion(p_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
  v_s public.taxi_sanciones;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para apelar.' using errcode = '42501';
  end if;
  if v_texto is null or char_length(v_texto) < 10 then
    raise exception 'Cuéntanos por qué (al menos 10 letras).' using errcode = '22023';
  end if;
  if char_length(v_texto) > 600 then
    raise exception 'La apelación puede tener hasta 600 letras.' using errcode = '22023';
  end if;
  select * into v_s from public.taxi_sanciones
   where id = p_id and levantada_at is null and (hasta is null or hasta > now())
     and ((cuenta_tipo = 'pasajero' and cuenta_id = v_uid)
          or (cuenta_tipo = 'conductor' and v_cond is not null and cuenta_id = v_cond))
   for update;
  if v_s.id is null then
    raise exception 'Esa sanción no es tuya o ya no está vigente.' using errcode = '42501';
  end if;
  if v_s.apelada_at is not null then
    raise exception 'Ya apelaste esta sanción.' using errcode = '23505';
  end if;
  update public.taxi_sanciones set apelacion = v_texto, apelada_at = now() where id = v_s.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_apelar_sancion(uuid, text) from public, anon;
grant execute on function public.taxi_apelar_sancion(uuid, text) to authenticated;

-- ---------- Rechazar una apelación (el Admin) -------------------------------
create or replace function public.taxi_admin_rechazar_apelacion(p_id uuid, p_respuesta text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.taxi_sanciones;
  v_resp text := left(nullif(trim(coalesce(p_respuesta, '')), ''), 400);
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador.' using errcode = '42501';
  end if;
  update public.taxi_sanciones
     set apelacion_resuelta_at = now(), apelacion_respuesta = v_resp
   where id = p_id and apelada_at is not null and apelacion_resuelta_at is null and levantada_at is null
  returning * into v_s;
  if v_s.id is null then
    raise exception 'Esa apelación ya se respondió.' using errcode = '22023';
  end if;
  perform public.taxi__mensaje_a(public.taxi__usuario_de_cuenta(v_s.cuenta_tipo, v_s.cuenta_id), 'Revisamos tu apelación',
    'Revisamos tu apelación y por ahora la sanción sigue.' || coalesce(' ' || v_resp, ''));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.taxi_admin_rechazar_apelacion(uuid, text) from public, anon;
grant execute on function public.taxi_admin_rechazar_apelacion(uuid, text) to authenticated, service_role;

-- Levantar también cierra su apelación.
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
  update public.taxi_sanciones
     set levantada_at = now(), levantada_por = auth.uid(),
         apelacion_resuelta_at = case when apelada_at is not null then coalesce(apelacion_resuelta_at, now()) end
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

-- ---------- Centro de reportes: filtro "Apelaciones" ------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'taxi__admin_reportes_base'
  ) then
    alter function public.taxi_admin_reportes(text) rename to taxi__admin_reportes_base;
  end if;
end;
$$;
revoke execute on function public.taxi__admin_reportes_base(text) from public, anon, authenticated;

create or replace function public.taxi_admin_reportes(p_estado text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_apel integer;
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador.' using errcode = '42501';
  end if;
  select count(*)::integer into v_apel
    from public.taxi_sanciones s
   where s.apelada_at is not null and s.apelacion_resuelta_at is null
     and s.levantada_at is null and (s.hasta is null or s.hasta > now());
  if p_estado = 'apelacion' then
    v_base := public.taxi__admin_reportes_base(null);
    return jsonb_build_object(
      'reportes', coalesce((
        select jsonb_agg(x order by x->'reportado'->'sancion'->>'apelada_at')
          from jsonb_array_elements(v_base->'reportes') x
         where x->'reportado'->'sancion'->>'apelada_at' is not null
           and x->'reportado'->'sancion'->>'apelacion_resuelta_at' is null
           and x->'reportado'->'sancion'->>'reporte_id' = x->>'id'), '[]'::jsonb),
      'conteo', (v_base->'conteo') || jsonb_build_object('apelacion', v_apel));
  end if;
  v_base := public.taxi__admin_reportes_base(p_estado);
  return jsonb_build_object('reportes', v_base->'reportes',
                            'conteo', (v_base->'conteo') || jsonb_build_object('apelacion', v_apel));
end;
$$;
revoke execute on function public.taxi_admin_reportes(text) from public, anon;
grant execute on function public.taxi_admin_reportes(text) to authenticated, service_role;

notify pgrst, 'reload schema';
