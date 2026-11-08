-- =========================================================================
-- Gemas, fase 3b (Taxi-PE): adiós a los créditos; el recolector tiene
-- membresía con cupo de conductores.
--
--   * Los créditos dejan de existir: se ponen en 0 (todas las cuentas son
--     de prueba) y los paquetes de créditos se desactivan. Conductores y
--     recolectores solo compran MEMBRESÍAS.
--   * Recolector: su membresía tiene días y un CUPO de conductores
--     distintos que puede atender (venderles membresía) en su periodo. Cada
--     conductor nuevo del periodo usa 1; venderle otra vez al mismo, no.
--     Anular la venta devuelve el cupo (deja de contar).
--   * Puede comprar otra membresía en el acto cuando se le acaba el cupo o
--     cuando vence (empieza un periodo nuevo con el cupo completo).
--   * Canjea sus gemas verdes al comprarla (tope de recolectores: soles o
--     % del precio de su paquete). Por comprobante se apartan y vuelven si
--     se rechaza.
--   * Aprobar ya no lo hace la pantalla del admin sumando a mano: lo hace
--     la base (taxi_aprobar_peticion_recolector).
--
-- Proyecto: Taxi-PE. Idempotente. Va después de 20261109110000.
-- =========================================================================

-- ---------- Créditos: fuera --------------------------------------------------
update public.conductores set creditos = 0 where coalesce(creditos, 0) <> 0;
update public.usuarios set creditos_disponibles = 0 where coalesce(creditos_disponibles, 0) <> 0;
update public.paquetes set activo = false where tipo_item = 'creditos' and coalesce(activo, true);
update public.paquetes_recolectores set activo = false where tipo_item = 'creditos' and coalesce(activo, true);

-- ---------- Membresía del recolector ----------------------------------------
alter table public.paquetes_recolectores add column if not exists cupo_conductores integer;
alter table public.usuarios add column if not exists membresia_inicio timestamptz;
alter table public.usuarios add column if not exists membresia_cupo integer;
alter table public.usuarios add column if not exists membresia_paquete_id text;
grant select (membresia_inicio, membresia_cupo, membresia_paquete_id) on public.usuarios to authenticated;

-- Antes la base impedía darle membresía a un recolector.
drop trigger if exists trg_zz_usuarios_recolector_sin_membresia on public.usuarios;

-- Conductores distintos atendidos en el periodo actual.
create or replace function public.taxi__cupo_usado_recolector(p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct v.conductor_id)::integer
    from public.ventas v, public.usuarios u
   where u.id = p_uid and v.recolector_id = p_uid
     and v.tipo_item = 'membresia' and v.conductor_id is not null
     and not coalesce(v.anulado, false)
     and u.membresia_inicio is not null and v.created_at >= u.membresia_inicio;
$$;
revoke execute on function public.taxi__cupo_usado_recolector(uuid) from public, anon, authenticated;

-- Para su pantalla: { activa, vence, cupo, usado, paquete }
create or replace function public.taxi_mi_membresia_recolector()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_u public.usuarios;
begin
  if public.taxi_rol() is distinct from 'recolector' then
    raise exception 'Solo recolectores.' using errcode = '42501';
  end if;
  select * into v_u from public.usuarios where id = auth.uid();
  return jsonb_build_object(
    'activa', v_u.membresia_vencimiento is not null and v_u.membresia_vencimiento > now(),
    'vence', v_u.membresia_vencimiento,
    'inicio', v_u.membresia_inicio,
    'cupo', coalesce(v_u.membresia_cupo, 0),
    'usado', public.taxi__cupo_usado_recolector(v_u.id),
    'paquete', (select nombre from public.paquetes_recolectores where id::text = v_u.membresia_paquete_id)
  );
end;
$$;
revoke execute on function public.taxi_mi_membresia_recolector() from public, anon;
grant execute on function public.taxi_mi_membresia_recolector() to authenticated;

-- ¿Puede comprar otra ahora? Vencida, sin membresía o con el cupo agotado.
create or replace function public.taxi__recolector_puede_renovar(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select u.membresia_vencimiento is null or u.membresia_vencimiento <= now()
         or public.taxi__cupo_usado_recolector(u.id) >= coalesce(u.membresia_cupo, 0)
    from public.usuarios u where u.id = p_uid;
$$;
revoke execute on function public.taxi__recolector_puede_renovar(uuid) from public, anon, authenticated;

-- ---------- Tope y canje de gemas del recolector -----------------------------
-- Tope: soles, o % del precio de su paquete actual (sin paquete: S/ 5).
-- (La versión sin parámetro de 20261109100000 se reemplaza: con las dos,
-- la llamada sin argumentos sería ambigua.)
drop function if exists public.taxi__tope_gemas_recolector();
create or replace function public.taxi__tope_gemas_recolector(p_uid uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(floor(
    (case when c.tope_recolector_tipo = 'monto' then c.tope_recolector_valor
          else coalesce((select pr.precio from public.usuarios u join public.paquetes_recolectores pr
                          on pr.id::text = u.membresia_paquete_id where u.id = p_uid and pr.precio > 0)
                        * c.tope_recolector_valor / 100, 5) end)
    / nullif(c.valor, 0)), 0)::integer
  from public.taxi_gemas_config c where c.id;
$$;
revoke execute on function public.taxi__tope_gemas_recolector(uuid) from public, anon, authenticated;

create or replace function public.taxi__canje_recolector(p_uid uuid, p_precio numeric, out n integer, out monto numeric)
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
  select coalesce(max(recolectadas), 0) into v_tiene from public.taxi_gemas_recolectores where recolector_id = p_uid;
  v_tope_soles := case when v_cfg.tope_recolector_tipo = 'monto' then v_cfg.tope_recolector_valor
                       else p_precio * v_cfg.tope_recolector_valor / 100 end;
  n := greatest(least(v_tiene, floor(v_tope_soles / v_cfg.valor)::integer, ceil(p_precio / v_cfg.valor)::integer), 0);
  monto := least(round(n * v_cfg.valor, 2), p_precio);
end;
$$;
revoke execute on function public.taxi__canje_recolector(uuid, numeric) from public, anon, authenticated;

-- Para la app: recolector (lo suyo) o admin (ese recolector). { tiene, n, monto, valor, puede }
create or replace function public.taxi_gemas_canje_recolector(p_recolector_id uuid, p_paquete_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_precio numeric;
  v_n integer := 0;
  v_monto numeric := 0;
begin
  if not (public.taxi_es_admin() or (public.taxi_rol() = 'recolector' and p_recolector_id = auth.uid())) then
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  select precio into v_precio from public.paquetes_recolectores
   where id::text = p_paquete_id and tipo_item = 'membresia' and coalesce(activo, true);
  if v_precio is not null then
    select c.n, c.monto into v_n, v_monto from public.taxi__canje_recolector(p_recolector_id, v_precio) c;
  end if;
  return jsonb_build_object(
    'tiene', coalesce((select recolectadas from public.taxi_gemas_recolectores where recolector_id = p_recolector_id), 0),
    'n', coalesce(v_n, 0),
    'monto', coalesce(v_monto, 0),
    'valor', coalesce((select valor from public.taxi_gemas_config where id), 0.10),
    'puede', public.taxi__recolector_puede_renovar(p_recolector_id)
  );
end;
$$;
revoke execute on function public.taxi_gemas_canje_recolector(uuid, text) from public, anon;
grant execute on function public.taxi_gemas_canje_recolector(uuid, text) to authenticated;

-- La caja del recolector (fase 3a) ahora con su tope por paquete.
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
    'tope', public.taxi__tope_gemas_recolector(auth.uid()),
    'valor', coalesce(v_cfg.valor, 0.10),
    'activo', coalesce(v_cfg.activo, false)
  );
end;
$$;

-- ---------- Compra de membresía del recolector (petición) --------------------
alter table public.peticiones_recarga_recolector add column if not exists cupo_conductores integer;
alter table public.peticiones_recarga_recolector add column if not exists usar_gemas boolean not null default false;
alter table public.peticiones_recarga_recolector add column if not exists gemas_usadas integer not null default 0;
alter table public.peticiones_recarga_recolector add column if not exists gemas_monto numeric(10,2) not null default 0;

-- Al crearla: el paquete se copia de la base, solo membresías, solo si
-- puede comprar ahora; si canjea, sus gemas se apartan. Siempre nace
-- 'pendiente' (el admin la aprueba con taxi_aprobar_peticion_recolector).
create or replace function public.fn_peticion_recarga_recolector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.paquetes_recolectores;
  v_n integer := 0;
  v_monto numeric := 0;
begin
  select * into v_p from public.paquetes_recolectores
   where id::text = new.paquete_id::text and tipo_item = 'membresia' and coalesce(activo, true);
  if v_p.id is null then
    raise exception 'Ese paquete ya no está disponible. Elige otro.' using errcode = '22023';
  end if;
  if not coalesce(public.taxi__recolector_puede_renovar(new.recolector_id), true) then
    raise exception 'Tu membresía sigue vigente y con cupo: podrás comprar otra cuando se te acabe el cupo o venza.' using errcode = '22023';
  end if;
  new.paquete_nombre := v_p.nombre;
  new.tipo_item := 'membresia';
  new.creditos := null;
  new.dias_membresia := v_p.dias_membresia;
  new.cupo_conductores := v_p.cupo_conductores;
  new.monto := v_p.precio;
  new.estado := 'pendiente';
  new.resuelto_at := null;
  new.gemas_usadas := 0;
  new.gemas_monto := 0;
  if coalesce(new.usar_gemas, false) then
    perform pg_advisory_xact_lock(hashtext('gema-recolector:' || new.recolector_id::text));
    select c.n, c.monto into v_n, v_monto from public.taxi__canje_recolector(new.recolector_id, v_p.precio) c;
    if coalesce(v_n, 0) > 0 then
      update public.taxi_gemas_recolectores
         set recolectadas = recolectadas - v_n, actualizado = now()
       where recolector_id = new.recolector_id;
      new.gemas_usadas := v_n;
      new.gemas_monto := v_monto;
      new.monto := greatest(v_p.precio - v_monto, 0);
    end if;
  end if;
  new.usar_gemas := new.gemas_usadas > 0;
  return new;
end;
$$;
drop trigger if exists trg_peticion_recarga_recolector on public.peticiones_recarga_recolector;
create trigger trg_peticion_recarga_recolector
  before insert on public.peticiones_recarga_recolector
  for each row execute function public.fn_peticion_recarga_recolector();

-- Rechazada: las gemas vuelven a su caja.
create or replace function public.fn_peticion_recarga_recolector_gemas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado = 'pendiente' and new.estado = 'rechazado' and coalesce(old.gemas_usadas, 0) > 0 then
    insert into public.taxi_gemas_recolectores (recolector_id, recolectadas) values (old.recolector_id, old.gemas_usadas)
    on conflict (recolector_id) do update
      set recolectadas = public.taxi_gemas_recolectores.recolectadas + excluded.recolectadas, actualizado = now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_peticion_recarga_recolector_gemas on public.peticiones_recarga_recolector;
create trigger trg_peticion_recarga_recolector_gemas
  after update of estado on public.peticiones_recarga_recolector
  for each row execute function public.fn_peticion_recarga_recolector_gemas();

-- Aprobar (admin): empieza un periodo nuevo con el cupo completo.
create or replace function public.taxi_aprobar_peticion_recolector(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet public.peticiones_recarga_recolector;
  v_vence timestamptz;
begin
  if not public.taxi_es_admin() then
    raise exception 'Solo el admin aprueba recargas.' using errcode = '42501';
  end if;
  select * into v_pet from public.peticiones_recarga_recolector where id::text = p_id for update;
  if v_pet.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_pet.estado <> 'pendiente' then
    return jsonb_build_object('estado', 'ya_resuelta');
  end if;
  v_vence := now() + coalesce(v_pet.dias_membresia, 30) * interval '1 day';
  update public.usuarios
     set membresia_inicio = now(),
         membresia_vencimiento = v_vence,
         membresia_cupo = coalesce(v_pet.cupo_conductores, 0),
         membresia_paquete_id = v_pet.paquete_id::text
   where id = v_pet.recolector_id;
  update public.peticiones_recarga_recolector
     set estado = 'aprobado', resuelto_at = now()
   where id = v_pet.id;
  return jsonb_build_object('estado', 'ok', 'vence', v_vence, 'cupo', coalesce(v_pet.cupo_conductores, 0));
end;
$$;
revoke execute on function public.taxi_aprobar_peticion_recolector(text) from public, anon;
grant execute on function public.taxi_aprobar_peticion_recolector(text) to authenticated;

-- ---------- Venta de membresía al conductor ---------------------------------
-- Igual que 20261109100000, pero sin créditos: solo membresías, y el
-- recolector vende con su membresía vigente y cupo (ya no paga con
-- créditos).
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
  v_dias     integer;
  v_detalle  text;
  v_pet      public.peticiones_recarga_conductor;
  v_c        record;
  v_espacio  integer;
  v_gemas_n  integer := 0;
  v_gemas_m  numeric := 0;
  v_gemas_rec uuid := null;
  v_monto    numeric;
  v_usado    integer;
begin
  if v_rol is null or v_rol not in ('admin', 'recolector') then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;

  select * into v_paq from public.paquetes where id::text = p_paquete_id and tipo_item = 'membresia';
  if v_paq.id is null then
    return jsonb_build_object('estado', 'paquete_invalido');
  end if;
  v_dias := coalesce(v_paq.dias_membresia, 30);

  select * into v_cond from public.conductores where id = p_conductor_id for update;
  if v_cond.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_cond.aprobado is false then
    return jsonb_build_object('estado', 'no_aprobado');
  end if;
  if v_cond.vencimiento_suscripcion is not null and v_cond.vencimiento_suscripcion > now() then
    return jsonb_build_object('estado', 'membresia_activa', 'vence', v_cond.vencimiento_suscripcion);
  end if;

  -- Recolector: membresía vigente y cupo (un conductor ya atendido en el
  -- periodo no usa otro).
  if v_rol = 'recolector' then
    select * into v_rec from public.usuarios where id = v_uid for update;
    if v_rec.id is null then
      return jsonb_build_object('estado', 'sin_permiso');
    end if;
    if v_rec.membresia_vencimiento is null or v_rec.membresia_vencimiento <= now() then
      return jsonb_build_object('estado', 'recolector_sin_membresia');
    end if;
    if not exists (
      select 1 from public.ventas v
       where v.recolector_id = v_uid and v.conductor_id = v_cond.id and v.tipo_item = 'membresia'
         and not coalesce(v.anulado, false) and v.created_at >= v_rec.membresia_inicio
    ) then
      v_usado := public.taxi__cupo_usado_recolector(v_uid);
      if v_usado >= coalesce(v_rec.membresia_cupo, 0) then
        return jsonb_build_object('estado', 'recolector_sin_cupo', 'cupo', coalesce(v_rec.membresia_cupo, 0), 'usado', v_usado);
      end if;
    end if;
  end if;

  -- Gemas del conductor.
  if p_peticion_id is not null then
    select * into v_pet from public.peticiones_recarga_conductor
     where id = p_peticion_id and conductor_id = v_cond.id and estado = 'pendiente';
    v_gemas_n := coalesce(v_pet.gemas_usadas, 0);
    v_gemas_m := coalesce(v_pet.gemas_monto, 0);
  elsif coalesce(p_usar_gemas, false) then
    perform pg_advisory_xact_lock(hashtext('gema-conductor:' || v_cond.id::text));
    if v_rol = 'recolector' then
      v_espacio := public.taxi__tope_gemas_recolector(v_uid)
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
  v_monto := greatest(coalesce(v_paq.precio, 0) - v_gemas_m, 0);

  v_detalle := coalesce(nullif(trim(p_detalle), ''), 'Membresía · ' || v_dias || ' días');
  if v_gemas_n > 0 then
    v_detalle := v_detalle || ' · ' || v_gemas_n || ' gemas (−S/ ' || to_char(v_gemas_m, 'FM999990.00') || ')';
  end if;

  insert into public.ventas (
    conductor_id, cliente_id, recolector_id, tipo_item, detalle, monto, metodo_pago, voucher_url,
    creditos_otorgados, dias_otorgados, creditos_descontados, gemas_usadas, gemas_monto, gemas_recolector
  )
  values (
    v_cond.id, null, case when v_rol = 'recolector' then v_uid else null end, 'membresia', v_detalle, v_monto, p_metodo_pago, p_voucher_url,
    null, v_dias, 0, v_gemas_n, v_gemas_m, v_gemas_rec
  )
  returning * into v_venta;

  update public.conductores
    set vencimiento_suscripcion = now() + v_dias * interval '1 day',
        membresia_paquete_id = v_paq.id
    where id = v_cond.id
    returning * into v_cond;

  if p_metodo_pago = 'fiado' then
    insert into public.fiados_conductores (conductor_id, venta_id, concepto, monto, fecha_fiado)
    values (v_cond.id, v_venta.id, v_detalle, v_monto, now());
  end if;

  return jsonb_build_object('estado', 'ok', 'venta', to_jsonb(v_venta), 'conductor', to_jsonb(v_cond));
end;
$$;
revoke execute on function public.taxi_registrar_recarga(uuid, text, text, text, text, boolean, bigint) from public, anon;
grant execute on function public.taxi_registrar_recarga(uuid, text, text, text, text, boolean, bigint) to authenticated;

-- La petición del conductor tampoco acepta créditos.
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
  select * into v_p from public.paquetes
   where id::text = new.paquete_id and coalesce(activo, true) and tipo_item = 'membresia';
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
  new.tipo_item           := 'membresia';
  new.creditos            := null;
  new.dias_membresia      := v_p.dias_membresia;
  new.monto               := v_p.precio;
  new.estado              := 'pendiente';
  new.venta_id            := null;
  new.resuelto_at         := null;
  new.created_at          := now();
  new.gemas_usadas        := 0;
  new.gemas_monto         := 0;

  if coalesce(new.usar_gemas, false) then
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

-- Realtime: la pantalla del recolector ve su cupo al instante.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peticiones_recarga_recolector'
  ) then
    execute 'alter publication supabase_realtime add table public.peticiones_recarga_recolector';
  end if;
end $$;

notify pgrst, 'reload schema';
