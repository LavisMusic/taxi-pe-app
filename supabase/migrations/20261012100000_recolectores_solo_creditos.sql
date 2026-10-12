-- =========================================================================
-- Recolectores: solo compran créditos; vender una membresía les cuesta un
-- crédito por día.
--
--   * taxi_registrar_recarga: un recolector sin membresía vigente paga
--     con sus créditos 1 por crédito vendido y, por una membresía de N
--     días, N créditos (antes no podía vender membresías).
--   * La base ya no deja darle una membresía nueva (ni extenderla) a un
--     recolector; las que ya tenían siguen hasta que venzan.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

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
    -- Sin membresía vigente paga con sus créditos: 1 por crédito vendido
    -- y, por una membresía, 1 por cada día (30 días = 30 créditos).
    if v_rec.membresia_vencimiento is null or v_rec.membresia_vencimiento <= now() then
      if v_paq.tipo_item = 'membresia' then
        v_cobrado := v_dias;
      else
        v_cobrado := v_cred;
      end if;
      if coalesce(v_rec.creditos_disponibles, 0) < v_cobrado then
        return jsonb_build_object('estado', 'recolector_sin_creditos', 'disponibles', coalesce(v_rec.creditos_disponibles, 0), 'necesarios', v_cobrado);
      end if;
      update public.usuarios set creditos_disponibles = coalesce(creditos_disponibles, 0) - v_cobrado where id = v_uid;
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

create or replace function public.fn_usuarios_recolector_sin_membresia()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_antes timestamptz := null;
begin
  if new.rol <> 'recolector' or new.membresia_vencimiento is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_antes := old.membresia_vencimiento;
  end if;
  if v_antes is null or new.membresia_vencimiento > v_antes then
    raise exception 'Los recolectores solo compran paquetes de créditos.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_zz_usuarios_recolector_sin_membresia on public.usuarios;
create trigger trg_zz_usuarios_recolector_sin_membresia
  before insert or update on public.usuarios
  for each row execute function public.fn_usuarios_recolector_sin_membresia();
