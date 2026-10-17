-- =========================================================================
-- Conductor: "Repartiendo" / "En carrera", recargas por su cuenta y meta
-- del día.
--
--   * En carrera (pasajero con oferta aceptada o en tránsito): no recibe
--     ni acepta repartos. Si tiene el modo delivery encendido los negocios
--     lo siguen viendo, pero bloqueado.
--   * Repartiendo (entregas aceptadas o en ruta): puede seguir recibiendo
--     solicitudes y aceptar hasta 5 a la vez (antes, apenas recogía un
--     pedido dejaba de recibir otros). No acepta pasajeros: al aceptar el
--     primer reparto su taxi pasa a Desconectado y no puede volver a
--     Activo/Ocupado hasta entregar todo. Tampoco puede apagar el modo
--     delivery con repartos pendientes (si la membresía vence en pleno
--     reparto, se apaga recién al terminar).
--   * rpc_conductores_para_reparto devuelve además en_carrera y
--     repartos_activos (tarjetas de "Asignar repartidor" en Caja Tonazo).
--   * peticiones_recarga_conductor: el conductor pide membresía o gemas
--     con su comprobante; el Admin la aprueba en el Centro de Peticiones
--     (ahí se registra la venta con taxi_registrar_recarga). Con membresía
--     vigente no se pide nada (misma regla de la recarga del Admin) y hay
--     una sola solicitud pendiente a la vez.
--   * conductores.meta_diaria: meta de ganancia del día.
--
-- Requiere 20261014160000_turnos_y_modo_delivery_conductor.sql.
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Ayudantes --------------------------------------------------------
create or replace function public.taxi_conductor_en_carrera(p_conductor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_mensajes
    where conductor_id = p_conductor_id
      and tipo = 'oferta'
      and estado_oferta in ('aceptada', 'en_transito')
  );
$$;
grant execute on function public.taxi_conductor_en_carrera(uuid) to authenticated;

create or replace function public.taxi_conductor_repartos_activos(p_conductor_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.entregas
  where conductor_id = p_conductor_id and estado in ('aceptado', 'en_ruta');
$$;
grant execute on function public.taxi_conductor_repartos_activos(uuid) to authenticated;

-- ---------- Bloqueos del propio conductor -------------------------------------
create or replace function public.fn_conductores_repartiendo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.taxi_es_admin() then
    if coalesce(old.modo_delivery, false) and not coalesce(new.modo_delivery, false)
       and public.taxi_conductor_repartos_activos(new.id) > 0 then
      raise exception 'Tienes repartos pendientes: entrégalos antes de apagar el modo delivery.'
        using errcode = '22023';
    end if;
    if new.estado in ('activo', 'ocupado') and new.estado is distinct from old.estado
       and public.taxi_conductor_repartos_activos(new.id) > 0 then
      raise exception 'Estás repartiendo: termina tus repartos para recibir pasajeros.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_conductores_repartiendo on public.conductores;
create trigger trg_conductores_repartiendo
  before update on public.conductores
  for each row execute function public.fn_conductores_repartiendo();

-- ---------- Saldos: el modo delivery se apaga recién sin repartos -------------
create or replace function public.taxi_aplicar_saldos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conductores c
    set creditos = greatest(c.creditos - d.dias, 0),
        ultimo_descuento_creditos = c.ultimo_descuento_creditos + d.dias * interval '1 day'
  from (
    select id, floor(extract(epoch from now() - ultimo_descuento_creditos) / 86400)::integer as dias
    from public.conductores
    where coalesce(creditos, 0) > 0 and ultimo_descuento_creditos is not null
      and ultimo_descuento_creditos <= now() - interval '1 day'
  ) d
  where c.id = d.id and d.dias > 0;

  update public.conductores
    set ultimo_descuento_creditos = now()
    where coalesce(creditos, 0) > 0 and ultimo_descuento_creditos is null
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now());

  update public.conductores
    set estado = 'desconectado'
    where estado in ('activo', 'ocupado')
      and coalesce(creditos, 0) <= 0
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now());

  update public.conductores
    set modo_delivery = false
    where modo_delivery
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now())
      and public.taxi_conductor_repartos_activos(id) = 0;
end;
$$;
revoke execute on function public.taxi_aplicar_saldos() from public, anon, authenticated;

-- ---------- Repartidores para Caja: con su estado de reparto ------------------
-- Cambia el tipo de retorno (columnas nuevas): hay que borrarla antes.
drop function if exists public.rpc_conductores_para_reparto();
create function public.rpc_conductores_para_reparto()
returns table (
  id               uuid,
  nombre           text,
  placa            text,
  foto_url         text,
  estado           text,
  ultima_lat       numeric,
  ultima_lng       numeric,
  en_carrera       boolean,
  repartos_activos integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nombre, c.placa, c.foto_url, c.estado, c.ultima_lat, c.ultima_lng,
         public.taxi_conductor_en_carrera(c.id),
         public.taxi_conductor_repartos_activos(c.id)
  from public.conductores c
  join public.usuarios u
    on u.telefono = c.telefono
   and u.rol = 'conductor'
   and coalesce(u.estado_verificacion, 'permanente') = 'permanente'
  where coalesce(c.aprobado, false)
    and coalesce(c.modo_delivery, false)
    and c.vencimiento_suscripcion > now()
    and c.ultima_lat is not null
    and c.ultima_lng is not null
    and c.ultima_actualizacion > now() - interval '2 minutes';
$$;
grant execute on function public.rpc_conductores_para_reparto() to anon, authenticated;

-- ---------- Ofrecer (Caja): no a quien está en carrera o ya lleva 5 -----------
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
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= 5 then
    return jsonb_build_object('status', 'limite_repartos');
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
grant execute on function public.rpc_entrega_ofertar(uuid, uuid, numeric) to anon, authenticated;

-- ---------- Aceptar (conductor): hasta 5 a la vez, nunca en carrera -----------
create or replace function public.rpc_entrega_aceptar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entrega_id uuid;
  v_taken      uuid;
  v_nombre     text;
  v_total      numeric;
begin
  if public.taxi_conductor_en_carrera(p_conductor_id) then
    return jsonb_build_object('status', 'conductor_en_carrera');
  end if;
  -- Cuenta con el conductor bloqueado: dos "Aceptar" a la vez no pasan de 5.
  perform 1 from public.conductores where id = p_conductor_id for update;
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= 5 then
    return jsonb_build_object('status', 'limite_repartos');
  end if;

  select entrega_id into v_entrega_id
  from public.entrega_ofertas
  where id = p_oferta_id and conductor_id = p_conductor_id and estado = 'pendiente';
  if v_entrega_id is null then return jsonb_build_object('status', 'oferta_invalida'); end if;

  select conductor_id, total into v_taken, v_total from public.entregas where id = v_entrega_id for update;
  if v_taken is not null then
    update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now() where id = p_oferta_id;
    return jsonb_build_object('status', 'ya_tomada');
  end if;

  update public.entregas
    set conductor_id = p_conductor_id, estado = 'aceptado',
        aceptado_at = now(), actualizado_at = now()
    where id = v_entrega_id;

  update public.entrega_ofertas set estado = 'aceptada', resuelta_at = now() where id = p_oferta_id;
  update public.entrega_ofertas set estado = 'cerrada',  resuelta_at = now()
    where entrega_id = v_entrega_id and id <> p_oferta_id and estado = 'pendiente';

  -- Repartiendo: deja de recibir pasajeros hasta entregar todo.
  update public.conductores set estado = 'desconectado'
    where id = p_conductor_id and estado in ('activo', 'ocupado');

  select nullif(trim(nombre), '') into v_nombre from public.conductores where id = p_conductor_id;

  -- (horas escalonadas: en el chat aparecen en este orden)
  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje, created_at) values
    (v_entrega_id, 'cajero_conductor', 'conductor',
     '🛵 Hola, ' || coalesce('soy ' || v_nombre || ' y ', '') ||
     'voy en camino a la tienda a recoger el pedido. Por favor, tenlo listo.', now()),
    (v_entrega_id, 'cajero_conductor', 'cajero',
     '🏪 ¡Perfecto! Estamos pendientes de tu llegada. Recuerda que para retirar el pedido tienes que pagar su valor' ||
     coalesce(': S/ ' || to_char(v_total, 'FM999990.00'), '') || '.', now() + interval '2 seconds'),
    (v_entrega_id, 'cliente_conductor', 'conductor',
     '🛵 Hola, ' || coalesce('soy ' || v_nombre || ', ', '') ||
     'ya voy en camino a recoger tu pedido. Mantente atento y activa tus notificaciones para saber cuándo llego.', now()),
    (v_entrega_id, 'cliente_cajero', 'cajero',
     '🏪 El conductor está en camino a recoger tu pedido. Activa tus notificaciones y mantente atento.', now());

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id);
end;
$$;

-- ---------- Recargas pedidas por el conductor ---------------------------------
create table if not exists public.peticiones_recarga_conductor (
  id                  bigserial primary key,
  conductor_id        uuid not null references public.conductores (id) on delete cascade,
  paquete_id          text not null,
  paquete_nombre      text,
  paquete_descripcion text,
  tipo_item           text,
  creditos            integer,
  dias_membresia      integer,
  monto               numeric(10, 2),
  metodo_pago         text not null,
  comprobante_url     text,
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  venta_id            text,
  created_at          timestamptz not null default now(),
  resuelto_at         timestamptz
);
create index if not exists peticiones_recarga_conductor_estado
  on public.peticiones_recarga_conductor (estado, created_at desc);
create unique index if not exists peticiones_recarga_conductor_una_pendiente
  on public.peticiones_recarga_conductor (conductor_id) where estado = 'pendiente';

-- Al crearla, el paquete se copia de la tabla `paquetes` (no del teléfono):
-- nadie pide un paquete con otro precio. Con membresía vigente no se pide.
create or replace function public.fn_peticion_recarga_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p     public.paquetes;
  v_vence timestamptz;
begin
  select * into v_p from public.paquetes where id::text = new.paquete_id and coalesce(activo, true);
  if not found then
    raise exception 'Ese paquete ya no existe. Elige otro.' using errcode = '22023';
  end if;
  select vencimiento_suscripcion into v_vence from public.conductores where id = new.conductor_id;
  if v_vence is not null and v_vence > now() then
    raise exception 'Tienes una membresía vigente: podrás recargar cuando termine.' using errcode = '22023';
  end if;
  if new.metodo_pago not in ('yape', 'plin', 'otros') or nullif(trim(new.comprobante_url), '') is null then
    raise exception 'Elige Yape, Plin u Otros y adjunta tu comprobante.' using errcode = '22023';
  end if;
  new.paquete_nombre      := v_p.nombre;
  new.paquete_descripcion := v_p.descripcion;
  new.tipo_item           := v_p.tipo_item;
  new.creditos            := v_p.creditos;
  new.dias_membresia      := v_p.dias_membresia;
  new.monto               := v_p.precio;
  new.estado              := 'pendiente';
  new.venta_id            := null;
  new.resuelto_at         := null;
  new.created_at          := now();
  return new;
end;
$$;
drop trigger if exists trg_peticion_recarga_conductor on public.peticiones_recarga_conductor;
create trigger trg_peticion_recarga_conductor
  before insert on public.peticiones_recarga_conductor
  for each row execute function public.fn_peticion_recarga_conductor();

alter table public.peticiones_recarga_conductor enable row level security;
select public.taxi_reiniciar_politicas('peticiones_recarga_conductor');
revoke all on public.peticiones_recarga_conductor from anon;
grant select, insert, update, delete on public.peticiones_recarga_conductor to authenticated;
grant usage, select on sequence public.peticiones_recarga_conductor_id_seq to authenticated;
create policy peticiones_recarga_conductor_admin on public.peticiones_recarga_conductor for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy peticiones_recarga_conductor_leer on public.peticiones_recarga_conductor for select to authenticated
  using (conductor_id = public.taxi_mi_conductor_id());
create policy peticiones_recarga_conductor_crear on public.peticiones_recarga_conductor for insert to authenticated
  with check (conductor_id = public.taxi_mi_conductor_id() and estado = 'pendiente');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peticiones_recarga_conductor'
  ) then
    execute 'alter publication supabase_realtime add table public.peticiones_recarga_conductor';
  end if;
end $$;

-- Comprobantes del conductor: van al bucket PRIVADO 'verificaciones'
-- (carpeta comprobantes/), que cualquiera con sesión ya puede subir y
-- solo el Admin (y quien la subió) ve.

-- ---------- Meta del día -------------------------------------------------------
alter table public.conductores add column if not exists meta_diaria numeric(10, 2)
  check (meta_diaria is null or (meta_diaria > 0 and meta_diaria <= 100000));
grant select (meta_diaria) on public.conductores to authenticated;

notify pgrst, 'reload schema';
