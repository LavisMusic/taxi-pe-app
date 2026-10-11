-- =========================================================================
-- Créditos y membresías: conteos separados y reglas firmes (fase A).
--
-- CONDUCTOR (conductores.creditos / .vencimiento_suscripcion)
--   * Con membresía vigente NO puede comprar créditos.
--   * Al pasar a membresía, sus créditos quedan en 0 y corre la membresía.
--   * 1 crédito = 24 h de acceso, corre siempre: al empezar cada bloque de
--     24 h se descuenta 1 (ultimo_descuento_creditos marca el inicio). El
--     descuento lo hace la base cada 10 min (pg_cron), no la app.
--   * Sin membresía vigente y sin créditos no tiene acceso: no puede
--     ponerse Activo/Ocupado y, si lo estaba, la base lo pasa a
--     Desconectado (sale del catálogo y del mapa).
--
-- CLIENTE (usuarios rol 'pasajero')
--   * Ya no tiene membresías: las vigentes se quitan ahora y la base no
--     deja volver a asignarlas (se quita también la membresía gratis de
--     registro). Sus créditos son PUNTOS que se ganan comprando en Caja
--     Tonazo (fase B): la app no puede sumárselos ni venderlos.
--
-- RECOLECTOR (usuarios rol 'recolector')
--   * La recarga a un conductor pasa a ser UNA operación de la base
--     (taxi_registrar_recarga): valida, descuenta al recolector, registra
--     la venta, actualiza al conductor y crea el fiado, todo junto.
--   * Con membresía vigente vende créditos y membresías sin límite.
--   * Sin membresía: cada crédito vendido le descuenta 1 crédito suyo y no
--     puede vender membresías. Sin membresía ni créditos, no recarga.
--   * Sus créditos son mercadería: NO se ponen en 0 si compra membresía.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- CONDUCTOR -----------------------------------------------------
create or replace function public.fn_conductores_reglas_saldo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mem_nueva  boolean := new.vencimiento_suscripcion is not null and new.vencimiento_suscripcion > now();
  v_mem_vieja  boolean := tg_op = 'UPDATE' and old.vencimiento_suscripcion is not null and old.vencimiento_suscripcion > now();
  v_cred_viejo integer := case when tg_op = 'UPDATE' then coalesce(old.creditos, 0) else 0 end;
begin
  -- Pasa a membresía: los créditos quedan en 0.
  if v_mem_nueva and not v_mem_vieja then
    new.creditos := 0;
    new.ultimo_descuento_creditos := null;
  -- Con membresía vigente no se compran créditos.
  elsif v_mem_nueva and coalesce(new.creditos, 0) > v_cred_viejo then
    raise exception 'Tiene una membresía activa: no puede comprar créditos hasta que termine.' using errcode = '22023';
  end if;

  -- Empieza el reloj de 24 h al tener créditos de nuevo.
  if coalesce(new.creditos, 0) > 0 and v_cred_viejo <= 0 and not v_mem_nueva then
    new.ultimo_descuento_creditos := now();
  end if;
  if coalesce(new.creditos, 0) <= 0 then
    new.creditos := greatest(coalesce(new.creditos, 0), 0);
  end if;

  -- Sin acceso no se pone Activo/Ocupado (la app; la base sí puede
  -- apagarlo).
  if current_user in ('anon', 'authenticated')
     and new.estado in ('activo', 'ocupado')
     and (tg_op = 'INSERT' or old.estado is distinct from new.estado)
     and not v_mem_nueva and coalesce(new.creditos, 0) <= 0 then
    raise exception 'Sin saldo: necesitas créditos o una membresía activa para conectarte.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_conductores_reglas_saldo on public.conductores;
create trigger trg_zz_conductores_reglas_saldo
  before insert or update on public.conductores
  for each row execute function public.fn_conductores_reglas_saldo();

-- Descuento de 1 crédito por cada 24 h y apagado de quien quedó sin
-- acceso (cada 10 min).
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
end;
$$;
revoke execute on function public.taxi_aplicar_saldos() from public, anon, authenticated;

select cron.schedule('taxi-aplicar-saldos', '*/10 * * * *', $$select public.taxi_aplicar_saldos()$$);

-- Conductores que hoy tienen membresía vigente Y créditos: se quedan con
-- la membresía y los créditos en 0.
update public.conductores
  set creditos = 0, ultimo_descuento_creditos = null
  where vencimiento_suscripcion > now() and coalesce(creditos, 0) > 0;

-- ---------- CLIENTE (pasajero) --------------------------------------------
drop trigger if exists trg_membresia_gratis_pasajero on public.usuarios;

create or replace function public.fn_usuarios_reglas_saldo_pasajero()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rol <> 'pasajero' then
    return new;
  end if;
  -- Los clientes no tienen membresías.
  new.membresia_vencimiento := null;
  -- Sus créditos (puntos) solo los suma la base (compras en Caja).
  if current_user in ('anon', 'authenticated')
     and coalesce(new.creditos_disponibles, 0) > case when tg_op = 'UPDATE' then coalesce(old.creditos_disponibles, 0) else 0 end then
    raise exception 'Los puntos del cliente solo se ganan comprando.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_usuarios_reglas_saldo_pasajero on public.usuarios;
create trigger trg_zz_usuarios_reglas_saldo_pasajero
  before insert or update on public.usuarios
  for each row execute function public.fn_usuarios_reglas_saldo_pasajero();

-- Quita las membresías de clientes que había (el trigger de saldo avisa a
-- Caja Tonazo).
update public.usuarios set membresia_vencimiento = null
  where rol = 'pasajero' and membresia_vencimiento is not null;

-- La app ya no registra ventas a clientes.
create or replace function public.fn_ventas_sin_clientes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and new.cliente_id is not null then
    raise exception 'Ya no se venden créditos a clientes: los ganan comprando.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ventas_sin_clientes on public.ventas;
create trigger trg_ventas_sin_clientes
  before insert on public.ventas
  for each row execute function public.fn_ventas_sin_clientes();

-- ---------- RECARGA A CONDUCTOR (Admin o recolector) ----------------------
-- estado: 'ok' | 'sin_permiso' | 'paquete_invalido' | 'no_existe' |
-- 'no_aprobado' | 'membresia_activa' | 'conductor_con_membresia' |
-- 'recolector_sin_membresia' | 'recolector_sin_creditos'
create or replace function public.taxi_registrar_recarga(
  p_conductor_id uuid,
  p_paquete_id text,
  p_metodo_pago text,
  p_voucher_url text default null,
  p_detalle text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol      text := public.taxi_rol();
  v_uid      uuid := auth.uid();
  v_paq      public.paquetes;
  v_cond     public.conductores;
  v_rec      public.usuarios;
  v_venta    public.ventas;
  v_mem_cond boolean;
  v_cred     integer;
  v_dias     integer;
  v_detalle  text;
begin
  if v_rol is null or v_rol not in ('admin', 'recolector') then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;

  select * into v_paq from public.paquetes where id::text = p_paquete_id;
  if v_paq.id is null then
    return jsonb_build_object('estado', 'paquete_invalido');
  end if;
  v_cred := coalesce(v_paq.creditos, 0);
  v_dias := coalesce(v_paq.dias_membresia, 30);

  select * into v_cond from public.conductores where id = p_conductor_id for update;
  if v_cond.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_cond.aprobado is false then
    return jsonb_build_object('estado', 'no_aprobado');
  end if;

  v_mem_cond := v_cond.vencimiento_suscripcion is not null and v_cond.vencimiento_suscripcion > now();
  if v_paq.tipo_item = 'membresia' and v_mem_cond then
    return jsonb_build_object('estado', 'membresia_activa', 'vence', v_cond.vencimiento_suscripcion);
  end if;
  if v_paq.tipo_item = 'creditos' and v_mem_cond then
    return jsonb_build_object('estado', 'conductor_con_membresia', 'vence', v_cond.vencimiento_suscripcion);
  end if;

  if v_rol = 'recolector' then
    select * into v_rec from public.usuarios where id = v_uid for update;
    if v_rec.id is null then
      return jsonb_build_object('estado', 'sin_permiso');
    end if;
    if v_rec.membresia_vencimiento is null or v_rec.membresia_vencimiento <= now() then
      if v_paq.tipo_item = 'membresia' then
        return jsonb_build_object('estado', 'recolector_sin_membresia');
      end if;
      if coalesce(v_rec.creditos_disponibles, 0) < v_cred then
        return jsonb_build_object('estado', 'recolector_sin_creditos', 'disponibles', coalesce(v_rec.creditos_disponibles, 0), 'necesarios', v_cred);
      end if;
      update public.usuarios set creditos_disponibles = coalesce(creditos_disponibles, 0) - v_cred where id = v_uid;
    end if;
  end if;

  v_detalle := coalesce(
    nullif(trim(p_detalle), ''),
    case when v_paq.tipo_item = 'membresia' then 'Membresía · ' || v_dias || ' días' else v_cred || ' créditos' end
  );

  insert into public.ventas (conductor_id, cliente_id, recolector_id, tipo_item, detalle, monto, metodo_pago, voucher_url)
  values (v_cond.id, null, case when v_rol = 'recolector' then v_uid else null end, v_paq.tipo_item, v_detalle, v_paq.precio, p_metodo_pago, p_voucher_url)
  returning * into v_venta;

  if v_paq.tipo_item = 'membresia' then
    update public.conductores
      set vencimiento_suscripcion = now() + v_dias * interval '1 day',
          membresia_paquete_id = v_paq.id
      where id = v_cond.id
      returning * into v_cond;
  else
    update public.conductores
      set creditos = coalesce(creditos, 0) + v_cred,
          ultimo_paquete_creditos_nombre = v_paq.nombre,
          ultimo_paquete_creditos_descripcion = v_paq.descripcion,
          ultima_compra_creditos_at = now()
      where id = v_cond.id
      returning * into v_cond;
  end if;

  if p_metodo_pago = 'fiado' then
    insert into public.fiados_conductores (conductor_id, venta_id, concepto, monto, fecha_fiado)
    values (v_cond.id, v_venta.id, v_detalle, v_paq.precio, now());
  end if;

  return jsonb_build_object('estado', 'ok', 'venta', to_jsonb(v_venta), 'conductor', to_jsonb(v_cond));
end;
$$;
revoke execute on function public.taxi_registrar_recarga(uuid, text, text, text, text) from public, anon;
grant execute on function public.taxi_registrar_recarga(uuid, text, text, text, text) to authenticated;

-- El recolector ya no inserta ventas directo (usa taxi_registrar_recarga).
drop policy if exists ventas_recolector_crear on public.ventas;
