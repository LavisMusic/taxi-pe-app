-- =========================================================================
-- Gemas cruzadas, fase 3a (lado Taxi-PE): canjear gemas al comprar
-- membresía.
--
--   * El conductor canjea sus gemas verdes cobradas al comprar una
--     MEMBRESÍA (nunca créditos), por las tres vías:
--       - él mismo con comprobante (peticiones_recarga_conductor): se
--         apartan al pedir; si la rechazan, vuelven;
--       - el admin o el recolector en persona (taxi_registrar_recarga).
--   * Cuando vende un RECOLECTOR, las gemas pasan a la caja del recolector
--     (taxi_gemas_recolectores, con su tope): las canjeará al renovar su
--     propia membresía (fase 3b). Si su caja está llena, se canjean solo
--     las que le entran.
--   * Topes por rol (vienen de Caja con 'caja.gemas_config'): conductores
--     y recolectores, cada uno en soles o en % del precio.
--   * Canje: todas las cobradas, sin pasar el tope ni el precio.
--   * Anular la venta devuelve las gemas.
--
-- Proyecto: Taxi-PE. Idempotente. Va después de 20261108100000.
-- =========================================================================

alter table public.taxi_gemas_config add column if not exists tope_conductor_tipo text not null default 'monto';
alter table public.taxi_gemas_config add column if not exists tope_conductor_valor numeric(8,2) not null default 5;
alter table public.taxi_gemas_config add column if not exists tope_recolector_tipo text not null default 'monto';
alter table public.taxi_gemas_config add column if not exists tope_recolector_valor numeric(8,2) not null default 5;

-- ---------- Config que llega de Caja (ahora con los topes por rol) --------
create or replace function public.rpc_webhook_caja_gemas(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_payload->>'event_type';
  v_data jsonb := p_payload->'data';
  v_tel text := nullif(trim(coalesce(v_data->>'telefono', '')), '');
  v_delta integer;
  v_id uuid;
  v_version timestamptz;
begin
  if v_tipo = 'caja.gemas_config' then
    v_version := (v_data->>'version')::timestamptz;
    update public.taxi_gemas_config
       set valor = coalesce((v_data->>'valor')::numeric, valor),
           tope_tipo = coalesce(v_data->>'tope_tipo', tope_tipo),
           tope_valor = coalesce((v_data->>'tope_valor')::numeric, tope_valor),
           tope_conductor_tipo = coalesce(v_data->>'tope_conductor_tipo', tope_conductor_tipo),
           tope_conductor_valor = coalesce((v_data->>'tope_conductor_valor')::numeric, tope_conductor_valor),
           tope_recolector_tipo = coalesce(v_data->>'tope_recolector_tipo', tope_recolector_tipo),
           tope_recolector_valor = coalesce((v_data->>'tope_recolector_valor')::numeric, tope_recolector_valor),
           activo = coalesce((v_data->>'activo')::boolean, activo),
           version = v_version
     where id and (version is null or v_version is null or v_version > version);
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tel is null then
    return jsonb_build_object('status', 'invalido');
  end if;

  if v_tipo = 'caja.gema_verde' then
    v_delta := coalesce((v_data->>'delta')::integer, 0);
    if v_delta not in (1, -1) or coalesce(v_data->>'ref', '') = '' then
      return jsonb_build_object('status', 'invalido');
    end if;
    insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref)
    values (v_tel, 'verde', v_delta, 'compra', v_data->>'ref')
    on conflict (ref) do nothing
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('status', 'duplicado');
    end if;
    insert into public.taxi_gemas_saldos (telefono, verdes)
    values (v_tel, greatest(v_delta, 0))
    on conflict (telefono) do update
      set verdes = greatest(public.taxi_gemas_saldos.verdes + v_delta, 0),
          actualizado = now();
    return jsonb_build_object('status', 'ok');
  end if;

  if v_tipo = 'caja.gemas_celestes' then
    v_version := (v_data->>'version')::timestamptz;
    insert into public.taxi_gemas_saldos (telefono, celestes, celestes_version)
    values (v_tel, greatest(coalesce((v_data->>'celestes')::integer, 0), 0), v_version)
    on conflict (telefono) do update
      set celestes = excluded.celestes,
          celestes_version = excluded.celestes_version,
          actualizado = now()
      where public.taxi_gemas_saldos.celestes_version is null
         or excluded.celestes_version is null
         or excluded.celestes_version > public.taxi_gemas_saldos.celestes_version;
    return jsonb_build_object('status', 'ok');
  end if;

  return jsonb_build_object('status', 'invalido');
end;
$$;
revoke execute on function public.rpc_webhook_caja_gemas(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_gemas(uuid, jsonb) to service_role;

-- ---------- Topes por rol --------------------------------------------------
-- Conductor: soles, o % del precio de la membresía más barata.
create or replace function public.taxi__tope_gemas_conductor()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(floor(
    (case when c.tope_conductor_tipo = 'monto' then c.tope_conductor_valor
          else coalesce((select min(p.precio) from public.paquetes p
                          where p.tipo_item = 'membresia' and coalesce(p.activo, true) and p.precio > 0)
                        * c.tope_conductor_valor / 100, 5) end)
    / nullif(c.valor, 0)), 0)::integer
  from public.taxi_gemas_config c where c.id;
$$;
revoke execute on function public.taxi__tope_gemas_conductor() from public, anon, authenticated;

-- Recolector: soles (el % llega con su membresía, fase 3b: mientras, S/ 5).
create or replace function public.taxi__tope_gemas_recolector()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(floor(
    (case when c.tope_recolector_tipo = 'monto' then c.tope_recolector_valor else 5 end)
    / nullif(c.valor, 0)), 0)::integer
  from public.taxi_gemas_config c where c.id;
$$;
revoke execute on function public.taxi__tope_gemas_recolector() from public, anon, authenticated;

-- ---------- Caja de gemas del recolector -----------------------------------
create table if not exists public.taxi_gemas_recolectores (
  recolector_id uuid primary key,
  recolectadas integer not null default 0 check (recolectadas >= 0),
  actualizado timestamptz not null default now()
);
alter table public.taxi_gemas_recolectores enable row level security;
revoke all on public.taxi_gemas_recolectores from anon, authenticated;
grant select on public.taxi_gemas_recolectores to authenticated;
drop policy if exists taxi_gemas_recolectores_leer on public.taxi_gemas_recolectores;
create policy taxi_gemas_recolectores_leer on public.taxi_gemas_recolectores for select to authenticated
  using (recolector_id = auth.uid() or public.taxi_es_admin());

create or replace function public.taxi_mis_gemas_recolector()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg public.taxi_gemas_config;
begin
  if public.taxi_rol() is distinct from 'recolector' then
    raise exception 'Solo recolectores.' using errcode = '42501';
  end if;
  select * into v_cfg from public.taxi_gemas_config where id;
  return jsonb_build_object(
    'recolectadas', coalesce((select recolectadas from public.taxi_gemas_recolectores where recolector_id = auth.uid()), 0),
    'apartadas', 0,
    'tope', public.taxi__tope_gemas_recolector(),
    'valor', coalesce(v_cfg.valor, 0.10),
    'activo', coalesce(v_cfg.activo, false)
  );
end;
$$;
revoke execute on function public.taxi_mis_gemas_recolector() from public, anon;
grant execute on function public.taxi_mis_gemas_recolector() to authenticated;

-- ---------- Cuánto canjea un conductor en una membresía --------------------
-- n gemas y su valor en soles: todas las cobradas, sin pasar el tope del
-- conductor (en soles, o % de ESTE precio) ni el precio. p_espacio: lugar
-- que le queda al que las recibe (recolector); null = sin límite.
create or replace function public.taxi__canje_conductor(
  p_conductor uuid, p_precio numeric, p_espacio integer default null,
  out n integer, out monto numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cfg public.taxi_gemas_config;
  v_tiene integer;
  v_tope_soles numeric;
begin
  n := 0;
  monto := 0;
  select * into v_cfg from public.taxi_gemas_config where id;
  if not coalesce(v_cfg.activo, false) or coalesce(v_cfg.valor, 0) <= 0 or coalesce(p_precio, 0) <= 0 then
    return;
  end if;
  select coalesce(max(recolectadas), 0) into v_tiene from public.taxi_gemas_conductores where conductor_id = p_conductor;
  v_tope_soles := case when v_cfg.tope_conductor_tipo = 'monto' then v_cfg.tope_conductor_valor
                       else p_precio * v_cfg.tope_conductor_valor / 100 end;
  n := least(v_tiene, floor(v_tope_soles / v_cfg.valor)::integer, ceil(p_precio / v_cfg.valor)::integer);
  if p_espacio is not null then
    n := least(n, greatest(p_espacio, 0));
  end if;
  n := greatest(n, 0);
  monto := least(round(n * v_cfg.valor, 2), p_precio);
end;
$$;
revoke execute on function public.taxi__canje_conductor(uuid, numeric, integer) from public, anon, authenticated;

-- Para la app (conductor: lo suyo; admin y recolector: el conductor que
-- atienden). { tiene, n, monto, valor }
create or replace function public.taxi_gemas_canje_conductor(p_conductor_id uuid, p_paquete_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol text := public.taxi_rol();
  v_paq public.paquetes;
  v_n integer := 0;
  v_monto numeric := 0;
  v_espacio integer := null;
  v_cfg public.taxi_gemas_config;
begin
  if not (v_rol in ('admin', 'recolector') or p_conductor_id = public.taxi_mi_conductor_id()) then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select * into v_cfg from public.taxi_gemas_config where id;
  select * into v_paq from public.paquetes where id::text = p_paquete_id;
  if v_rol = 'recolector' then
    v_espacio := public.taxi__tope_gemas_recolector()
                 - coalesce((select recolectadas from public.taxi_gemas_recolectores where recolector_id = auth.uid()), 0);
  end if;
  if v_paq.id is not null and v_paq.tipo_item = 'membresia' then
    select c.n, c.monto into v_n, v_monto from public.taxi__canje_conductor(p_conductor_id, v_paq.precio, v_espacio) c;
  end if;
  return jsonb_build_object(
    'tiene', coalesce((select recolectadas from public.taxi_gemas_conductores where conductor_id = p_conductor_id), 0),
    'n', coalesce(v_n, 0),
    'monto', coalesce(v_monto, 0),
    'valor', coalesce(v_cfg.valor, 0.10),
    'lleno_recolector', v_espacio is not null and v_espacio <= 0
  );
end;
$$;
revoke execute on function public.taxi_gemas_canje_conductor(uuid, text) from public, anon;
grant execute on function public.taxi_gemas_canje_conductor(uuid, text) to authenticated;

-- ---------- Petición del conductor con comprobante -------------------------
alter table public.peticiones_recarga_conductor add column if not exists usar_gemas boolean not null default false;
alter table public.peticiones_recarga_conductor add column if not exists gemas_usadas integer not null default 0;
alter table public.peticiones_recarga_conductor add column if not exists gemas_monto numeric(10,2) not null default 0;

-- Igual que 20261014170000, más el canje: las gemas se apartan al pedir y
-- el monto a pagar ya las descuenta.
create or replace function public.fn_peticion_recarga_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p     public.paquetes;
  v_vence timestamptz;
  v_c     record;
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
  new.gemas_usadas        := 0;
  new.gemas_monto         := 0;

  if coalesce(new.usar_gemas, false) and v_p.tipo_item = 'membresia' then
    perform pg_advisory_xact_lock(hashtext('gema-conductor:' || new.conductor_id::text));
    select * into v_c from public.taxi__canje_conductor(new.conductor_id, v_p.precio, null);
    if coalesce(v_c.n, 0) > 0 then
      update public.taxi_gemas_conductores
         set recolectadas = recolectadas - v_c.n, actualizado = now()
       where conductor_id = new.conductor_id;
      new.gemas_usadas := v_c.n;
      new.gemas_monto := v_c.monto;
      new.monto := greatest(v_p.precio - v_c.monto, 0);
    end if;
  end if;
  new.usar_gemas := new.gemas_usadas > 0;
  return new;
end;
$$;

-- Rechazada: las gemas vuelven al conductor.
create or replace function public.fn_peticion_recarga_conductor_gemas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado = 'pendiente' and new.estado = 'rechazado' and coalesce(old.gemas_usadas, 0) > 0 then
    insert into public.taxi_gemas_conductores (conductor_id, recolectadas) values (old.conductor_id, old.gemas_usadas)
    on conflict (conductor_id) do update
      set recolectadas = public.taxi_gemas_conductores.recolectadas + excluded.recolectadas, actualizado = now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_peticion_recarga_conductor_gemas on public.peticiones_recarga_conductor;
create trigger trg_peticion_recarga_conductor_gemas
  after update of estado on public.peticiones_recarga_conductor
  for each row execute function public.fn_peticion_recarga_conductor_gemas();

-- ---------- Venta de la recarga (admin / recolector) -----------------------
alter table public.ventas add column if not exists gemas_usadas integer not null default 0;
alter table public.ventas add column if not exists gemas_monto numeric(10,2) not null default 0;
alter table public.ventas add column if not exists gemas_recolector uuid;

-- Igual que 20261012100000, más:
--   p_usar_gemas: canjea las gemas del conductor (solo membresía);
--   p_peticion_id: viene de una petición del conductor, que ya apartó sus
--   gemas (no se descuentan otra vez).
drop function if exists public.taxi_registrar_recarga(uuid, text, text, text, text);

create or replace function public.taxi_registrar_recarga(
  p_conductor_id uuid,
  p_paquete_id text,
  p_metodo_pago text,
  p_voucher_url text default null,
  p_detalle text default null,
  p_usar_gemas boolean default false,
  p_peticion_id bigint default null
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
  v_pet      public.peticiones_recarga_conductor;
  v_c        record;
  v_espacio  integer;
  v_gemas_n  integer := 0;
  v_gemas_m  numeric := 0;
  v_gemas_rec uuid := null;
  v_monto    numeric;
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

  -- ---- Gemas del conductor (solo membresía) ----
  if v_paq.tipo_item = 'membresia' then
    if p_peticion_id is not null then
      select * into v_pet from public.peticiones_recarga_conductor
       where id = p_peticion_id and conductor_id = v_cond.id and estado = 'pendiente';
      v_gemas_n := coalesce(v_pet.gemas_usadas, 0);
      v_gemas_m := coalesce(v_pet.gemas_monto, 0);
    elsif coalesce(p_usar_gemas, false) then
      perform pg_advisory_xact_lock(hashtext('gema-conductor:' || v_cond.id::text));
      if v_rol = 'recolector' then
        v_espacio := public.taxi__tope_gemas_recolector()
                     - coalesce((select recolectadas from public.taxi_gemas_recolectores where recolector_id = v_uid), 0);
      end if;
      select * into v_c from public.taxi__canje_conductor(v_cond.id, v_paq.precio, v_espacio);
      if coalesce(v_c.n, 0) > 0 then
        v_gemas_n := v_c.n;
        v_gemas_m := v_c.monto;
        update public.taxi_gemas_conductores
           set recolectadas = recolectadas - v_gemas_n, actualizado = now()
         where conductor_id = v_cond.id;
        if v_rol = 'recolector' then
          v_gemas_rec := v_uid;
          insert into public.taxi_gemas_recolectores (recolector_id, recolectadas) values (v_uid, v_gemas_n)
          on conflict (recolector_id) do update
            set recolectadas = public.taxi_gemas_recolectores.recolectadas + excluded.recolectadas, actualizado = now();
        end if;
      end if;
    end if;
  end if;
  v_monto := greatest(coalesce(v_paq.precio, 0) - v_gemas_m, 0);

  v_detalle := coalesce(
    nullif(trim(p_detalle), ''),
    case when v_paq.tipo_item = 'membresia' then 'Membresía · ' || v_dias || ' días' else v_cred || ' créditos' end
  );
  if v_gemas_n > 0 then
    v_detalle := v_detalle || ' · ' || v_gemas_n || ' gemas (−S/ ' || to_char(v_gemas_m, 'FM999990.00') || ')';
  end if;

  insert into public.ventas (
    conductor_id, cliente_id, recolector_id, tipo_item, detalle, monto, metodo_pago, voucher_url,
    creditos_otorgados, dias_otorgados, creditos_descontados, gemas_usadas, gemas_monto, gemas_recolector
  )
  values (
    v_cond.id, null, case when v_rol = 'recolector' then v_uid else null end, v_paq.tipo_item, v_detalle, v_monto, p_metodo_pago, p_voucher_url,
    case when v_paq.tipo_item = 'creditos' then v_cred else null end,
    case when v_paq.tipo_item = 'membresia' then v_dias else null end,
    v_cobrado, v_gemas_n, v_gemas_m, v_gemas_rec
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
    values (v_cond.id, v_venta.id, v_detalle, v_monto, now());
  end if;

  return jsonb_build_object('estado', 'ok', 'venta', to_jsonb(v_venta), 'conductor', to_jsonb(v_cond));
end;
$$;
revoke execute on function public.taxi_registrar_recarga(uuid, text, text, text, text, boolean, bigint) from public, anon;
grant execute on function public.taxi_registrar_recarga(uuid, text, text, text, text, boolean, bigint) to authenticated;

-- ---------- Anular: también devuelve las gemas -----------------------------
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
  if v_rol = 'recolector' and v_venta.created_at <= (
    select max(hasta) from public.cierres_caja where recolector_id = v_uid
  ) then
    return jsonb_build_object('estado', 'ya_cerrada');
  end if;

  v_cred := coalesce(v_venta.creditos_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '^(\d+)'), '')::integer, 0);
  v_dias := coalesce(v_venta.dias_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '·\s*(\d+)\s*días'), '')::integer, 30);

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

  if v_venta.recolector_id is not null and v_venta.creditos_descontados > 0 then
    update public.usuarios
      set creditos_disponibles = coalesce(creditos_disponibles, 0) + v_venta.creditos_descontados
      where id = v_venta.recolector_id;
  end if;

  -- Gemas canjeadas: vuelven al conductor y salen de la caja del recolector.
  if coalesce(v_venta.gemas_usadas, 0) > 0 and v_venta.conductor_id is not null then
    insert into public.taxi_gemas_conductores (conductor_id, recolectadas) values (v_venta.conductor_id, v_venta.gemas_usadas)
    on conflict (conductor_id) do update
      set recolectadas = public.taxi_gemas_conductores.recolectadas + excluded.recolectadas, actualizado = now();
    if v_venta.gemas_recolector is not null then
      update public.taxi_gemas_recolectores
         set recolectadas = greatest(recolectadas - v_venta.gemas_usadas, 0), actualizado = now()
       where recolector_id = v_venta.gemas_recolector;
    end if;
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

notify pgrst, 'reload schema';
