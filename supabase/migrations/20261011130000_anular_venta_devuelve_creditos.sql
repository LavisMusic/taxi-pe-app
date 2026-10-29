-- =========================================================================
-- Anular ventas: una operación de la base que también devuelve al
-- recolector los créditos que gastó.
--
--   * ventas guarda lo que otorgó (creditos_otorgados / dias_otorgados)
--     y cuántos créditos le descontó al recolector (creditos_descontados:
--     0 si tenía membresía o si vendió el Admin).
--   * taxi_anular_venta: el Admin anula cualquiera; cada recolector solo
--     SUS ventas. Le quita al conductor lo que recibió (créditos sin bajar
--     de 0, o los días de membresía), devuelve los créditos al recolector y
--     anula el fiado si lo hubo. Las ventas viejas (sin estas columnas) se
--     revierten leyendo el detalle, como hacía la app.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.ventas
  add column if not exists creditos_otorgados integer,
  add column if not exists dias_otorgados integer,
  add column if not exists creditos_descontados integer not null default 0;

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
  v_cobrado  integer := 0;
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
      v_cobrado := v_cred;
    end if;
  end if;

  v_detalle := coalesce(
    nullif(trim(p_detalle), ''),
    case when v_paq.tipo_item = 'membresia' then 'Membresía · ' || v_dias || ' días' else v_cred || ' créditos' end
  );

  insert into public.ventas (
    conductor_id, cliente_id, recolector_id, tipo_item, detalle, monto, metodo_pago, voucher_url,
    creditos_otorgados, dias_otorgados, creditos_descontados
  )
  values (
    v_cond.id, null, case when v_rol = 'recolector' then v_uid else null end, v_paq.tipo_item, v_detalle, v_paq.precio, p_metodo_pago, p_voucher_url,
    case when v_paq.tipo_item = 'creditos' then v_cred else null end,
    case when v_paq.tipo_item = 'membresia' then v_dias else null end,
    v_cobrado
  )
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


-- estado: 'ok' | 'sin_permiso' | 'no_existe' | 'ya_anulada'.
-- Devuelve también era_fiado / fiado_encontrado (como hacía la app).
create or replace function public.taxi_anular_venta(p_venta_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol    text := public.taxi_rol();
  v_uid    uuid := auth.uid();
  v_venta  public.ventas;
  v_cred   integer;
  v_dias   integer;
  v_fiados integer := 0;
begin
  if v_rol is null or v_rol not in ('admin', 'recolector') then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;

  select * into v_venta from public.ventas where id::text = p_venta_id for update;
  if v_venta.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_rol = 'recolector' and v_venta.recolector_id is distinct from v_uid then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if coalesce(v_venta.anulado, false) then
    return jsonb_build_object('estado', 'ya_anulada');
  end if;

  v_cred := coalesce(v_venta.creditos_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '^(\d+)'), '')::integer, 0);
  v_dias := coalesce(v_venta.dias_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '·\s*(\d+)\s*días'), '')::integer, 30);

  -- Al conductor (o al cliente, en ventas viejas) se le quita lo recibido.
  if v_venta.conductor_id is not null then
    if v_venta.tipo_item = 'membresia' then
      update public.conductores
        set vencimiento_suscripcion = vencimiento_suscripcion - v_dias * interval '1 day'
        where id = v_venta.conductor_id and vencimiento_suscripcion is not null;
    else
      update public.conductores
        set creditos = greatest(coalesce(creditos, 0) - v_cred, 0)
        where id = v_venta.conductor_id;
    end if;
  elsif v_venta.cliente_id is not null and v_venta.tipo_item = 'creditos' then
    update public.usuarios
      set creditos_disponibles = greatest(coalesce(creditos_disponibles, 0) - v_cred, 0)
      where id = v_venta.cliente_id;
  end if;

  -- Al recolector se le devuelven los créditos que gastó.
  if v_venta.recolector_id is not null and v_venta.creditos_descontados > 0 then
    update public.usuarios
      set creditos_disponibles = coalesce(creditos_disponibles, 0) + v_venta.creditos_descontados
      where id = v_venta.recolector_id;
  end if;

  update public.ventas set anulado = true where id = v_venta.id;

  if v_venta.metodo_pago = 'fiado' then
    update public.fiados_conductores set estado = 'anulado' where venta_id = v_venta.id;
    get diagnostics v_fiados = row_count;
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'era_fiado', v_venta.metodo_pago = 'fiado',
    'fiado_encontrado', v_venta.metodo_pago <> 'fiado' or v_fiados > 0
  );
end;
$$;
revoke execute on function public.taxi_anular_venta(text) from public, anon;
grant execute on function public.taxi_anular_venta(text) to authenticated;
