-- =========================================================================
-- Fase C1 (Taxi-PE): niveles de confianza del repartidor.
--
-- Por entregas completadas, con un límite por pedido (valor de la
-- mercadería: el delivery siempre se paga por adelantado):
--     Nuevo        0 a  9   →  S/  50
--     Confiable   10 a 29   →  S/ 100
--     Destacado   30 a 59   →  S/ 200
--     Certificado 60 o más  →  S/ 300
-- Un reclamo confirmado en los últimos 90 días ("pedido no entregado" o
-- "dinero no rendido", resuelto con una medida) baja un nivel. (Dos
-- reclamos = suspensión: fase C2.)
--
--   * taxi__nivel_repartidor(conductor) → { nivel, limite, entregas,
--     reclamos, siguiente, faltan }.
--   * taxi_mi_nivel_repartidor(): el del conductor con sesión (su panel).
--   * taxi_niveles_repartidores(ids): los del radar del negocio en Caja
--     (sin sesión de Taxi: solo nivel, límite y entregas).
--   * rpc_entrega_ofertar: no se ofrece un pedido que supera el límite del
--     repartidor, salvo que el negocio lo autorice a mano para ESE pedido
--     (rpc_entrega_autorizar_mayor), y solo cuando no hay ningún repartidor
--     disponible que lo alcance. Queda registrado quién lo autorizó.
--   * Motivos nuevos del reporte al repartidor: pedido_no_entregado y
--     dinero_no_rendido (son los "reclamos").
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Motivos -----------------------------------------------------------
create or replace function public.taxi__motivo_valido(p_reportado text, p_servicio text, p_motivo text)
returns boolean
language sql
immutable
as $$
  select p_motivo = 'otro' or coalesce(case
    when p_reportado = 'conductor' and p_servicio = 'viaje'
      then p_motivo in ('manejo_peligroso', 'cobro_distinto', 'maltrato', 'vehiculo_distinto', 'no_llego')
    when p_reportado = 'conductor' and p_servicio = 'entrega'
      then p_motivo in ('pedido_danado', 'demora', 'cobro_indebido', 'maltrato', 'pedido_no_entregado', 'dinero_no_rendido')
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
    when 'pedido_no_entregado' then 'pedido no entregado'
    when 'dinero_no_rendido' then 'dinero no rendido'
    when 'no_se_presento' then 'no se presentó'
    when 'no_pago' then 'no pagó o pagó menos'
    when 'danos_vehiculo' then 'daños al vehículo'
    else 'otro motivo'
  end;
$$;

-- ---------- Niveles -----------------------------------------------------------
-- Reclamos confirmados (90 días) contra este repartidor.
create or replace function public.taxi__reclamos_confirmados(p_conductor uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.taxi_reportes r
   where r.reportado_tipo = 'conductor' and r.reportado_id = p_conductor and r.servicio = 'entrega'
     and r.motivo in ('pedido_no_entregado', 'dinero_no_rendido')
     and r.estado = 'resuelto' and r.accion in ('advertencia', 'suspension', 'bloqueo')
     and r.resuelto_at >= now() - interval '90 days';
$$;
revoke execute on function public.taxi__reclamos_confirmados(uuid) from public, anon, authenticated;

create or replace function public.taxi__nivel_repartidor(p_conductor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nombres text[] := array['nuevo', 'confiable', 'destacado', 'certificado'];
  v_limites numeric[] := array[50, 100, 200, 300];
  v_umbrales integer[] := array[0, 10, 30, 60];
  v_entregas integer;
  v_reclamos integer;
  v_base integer;
  v_i integer;
begin
  select count(*)::integer into v_entregas
    from public.entregas where conductor_id = p_conductor and estado = 'entregado';
  v_reclamos := public.taxi__reclamos_confirmados(p_conductor);
  v_base := case when v_entregas >= 60 then 4 when v_entregas >= 30 then 3 when v_entregas >= 10 then 2 else 1 end;
  -- Un reclamo confirmado baja un nivel (nunca por debajo de Nuevo).
  v_i := greatest(v_base - least(v_reclamos, 1), 1);
  return jsonb_build_object(
    'nivel', v_nombres[v_i],
    'limite', v_limites[v_i],
    'entregas', v_entregas,
    'reclamos', v_reclamos,
    'bajado', v_i < v_base,
    'siguiente', case when v_base < 4 then v_nombres[v_base + 1] end,
    'faltan', case when v_base < 4 then v_umbrales[v_base + 1] - v_entregas end,
    'limite_siguiente', case when v_base < 4 then v_limites[v_base + 1] end
  );
end;
$$;
revoke execute on function public.taxi__nivel_repartidor(uuid) from public, anon, authenticated;

create or replace function public.taxi_mi_nivel_repartidor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cond uuid := public.taxi_mi_conductor_id();
begin
  if v_cond is null then
    return null;
  end if;
  return public.taxi__nivel_repartidor(v_cond);
end;
$$;
revoke execute on function public.taxi_mi_nivel_repartidor() from public, anon;
grant execute on function public.taxi_mi_nivel_repartidor() to authenticated;

-- Para el radar del negocio (Caja llama sin sesión de Taxi).
create or replace function public.taxi_niveles_repartidores(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'nivel', n->>'nivel',
           'limite', (n->>'limite')::numeric,
           'entregas', (n->>'entregas')::integer)), '[]'::jsonb)
    from public.conductores c
    cross join lateral public.taxi__nivel_repartidor(c.id) as n
   where c.id = any(p_ids) and cardinality(p_ids) <= 100;
$$;
revoke execute on function public.taxi_niveles_repartidores(uuid[]) from public;
grant execute on function public.taxi_niveles_repartidores(uuid[]) to anon, authenticated;

-- ---------- Autorización manual del negocio (un pedido, un repartidor) -------
create table if not exists public.taxi_entrega_autorizaciones (
  entrega_id     uuid not null references public.entregas (id) on delete cascade,
  conductor_id   uuid not null references public.conductores (id) on delete cascade,
  monto          numeric not null,
  limite         numeric not null,
  autorizado_por text,
  created_at     timestamptz not null default now(),
  primary key (entrega_id, conductor_id)
);
alter table public.taxi_entrega_autorizaciones enable row level security;
revoke all on public.taxi_entrega_autorizaciones from anon, authenticated;
drop policy if exists entrega_autorizaciones_admin on public.taxi_entrega_autorizaciones;
create policy entrega_autorizaciones_admin on public.taxi_entrega_autorizaciones
  for select to authenticated using (public.taxi_es_admin());
grant select on public.taxi_entrega_autorizaciones to authenticated;

-- ¿Algún repartidor disponible alcanza este monto? (para no autorizar a mano
-- si hay quien lo lleve normalmente).
create or replace function public.taxi__hay_repartidor_que_alcance(p_monto numeric)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rpc_conductores_para_reparto() r
     where not r.en_carrera and r.repartos_activos < public.taxi_max_repartos()
       and (public.taxi__nivel_repartidor(r.id)->>'limite')::numeric >= p_monto
  );
$$;
revoke execute on function public.taxi__hay_repartidor_que_alcance(numeric) from public, anon, authenticated;

create or replace function public.rpc_entrega_autorizar_mayor(
  p_session_token uuid, p_conductor_id uuid, p_autorizado_por text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := public.fn_entrega_por_token(p_session_token);
  v_e public.entregas;
  v_limite numeric;
begin
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;
  select * into v_e from public.entregas where id = v_id;
  if v_e.estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_e.estado);
  end if;
  v_limite := (public.taxi__nivel_repartidor(p_conductor_id)->>'limite')::numeric;
  if coalesce(v_e.total, 0) <= v_limite then
    return jsonb_build_object('status', 'no_hace_falta');
  end if;
  if public.taxi__hay_repartidor_que_alcance(coalesce(v_e.total, 0)) then
    return jsonb_build_object('status', 'hay_quien_alcance');
  end if;
  insert into public.taxi_entrega_autorizaciones (entrega_id, conductor_id, monto, limite, autorizado_por)
  values (v_id, p_conductor_id, coalesce(v_e.total, 0), v_limite, left(nullif(trim(coalesce(p_autorizado_por, '')), ''), 80))
  on conflict (entrega_id, conductor_id) do nothing;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.rpc_entrega_autorizar_mayor(uuid, uuid, text) from public;
grant execute on function public.rpc_entrega_autorizar_mayor(uuid, uuid, text) to anon, authenticated;

-- ---------- Ofrecer: respeta el límite del nivel -------------------------------
create or replace function public.rpc_entrega_ofertar(
  p_session_token uuid,
  p_conductor_id  uuid,
  p_tarifa        numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_estado text;
  v_tarifa_previa numeric; v_direccion text; v_sucursal text; v_total numeric;
  v_nivel jsonb;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado, tarifa, direccion_entrega, caja_sucursal, total
    into v_estado, v_tarifa_previa, v_direccion, v_sucursal, v_total
  from public.entregas where id = v_id;
  if v_estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;

  if public.taxi_conductor_en_carrera(p_conductor_id) then
    return jsonb_build_object('status', 'conductor_en_carrera');
  end if;
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= public.taxi_max_repartos() then
    return jsonb_build_object('status', 'limite_repartos');
  end if;
  -- Nivel de confianza: el pedido no puede superar su límite, salvo que el
  -- negocio lo haya autorizado para este pedido.
  v_nivel := public.taxi__nivel_repartidor(p_conductor_id);
  if coalesce(v_total, 0) > (v_nivel->>'limite')::numeric
     and not exists (select 1 from public.taxi_entrega_autorizaciones a
                      where a.entrega_id = v_id and a.conductor_id = p_conductor_id) then
    return jsonb_build_object('status', 'limite_nivel', 'nivel', v_nivel->>'nivel', 'limite', (v_nivel->>'limite')::numeric);
  end if;

  if p_tarifa is not null and p_tarifa is distinct from v_tarifa_previa then
    update public.entregas set tarifa = p_tarifa, actualizado_at = now() where id = v_id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (
      v_id, 'cajero_conductor', 'sistema',
      format(
        '📦 Nueva oferta de reparto: %s · Sucursal %s · Monto del pedido S/ %s · Tarifa de envío S/ %s',
        coalesce(v_direccion, 'sin dirección'),
        coalesce(v_sucursal, '-'),
        trim(to_char(coalesce(v_total, 0), '999999990.00')),
        trim(to_char(p_tarifa, '999999990.00'))
      )
    );
  end if;

  insert into public.entrega_ofertas (entrega_id, conductor_id)
  values (v_id, p_conductor_id)
  on conflict (entrega_id, conductor_id) do update
    set estado = 'pendiente', resuelta_at = null, created_at = now()
    where public.entrega_ofertas.estado in ('rechazada', 'cerrada', 'expirada');

  return jsonb_build_object('status', 'ok');
end;
$$;

notify pgrst, 'reload schema';
