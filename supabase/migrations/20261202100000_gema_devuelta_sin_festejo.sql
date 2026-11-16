-- =========================================================================
-- Gema devuelta sin festejo (Taxi-PE). Reemplaza a 20261201100000 (gemas
-- visibles = saldo + apartadas), que se descarta.
--
-- Lo que pidió el negocio:
--   * al usar la gema (aceptar la tarifa) el contador baja en 1, como antes;
--   * si el viaje se cancela, la gema vuelve al saldo y, al cerrar los
--     modales y volver a la interfaz principal, el contador sube con el
--     giro de casino... y NADA más: sin "¡Ganaste una gema!".
--
-- Para eso la app necesita saber que esa subida fue una devolución:
-- usuarios.gemas_verdes_devueltas cuenta (acumulado) las gemas devueltas al
-- pasajero. Sube en la misma transacción que la devolución, ANTES de que el
-- saldo se copie a usuarios.gemas_verdes. La app (SaldoGemas.jsx) resta esas
-- devoluciones de lo que subió el contador y solo festeja lo ganado.
--
-- Funciona tanto si 20261201100000 ya se corrió como si no.
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- 1) Deshacer 20261201100000 (si se corrió).
drop trigger if exists trg_chat_gema_espejar on public.chat_mensajes;
drop function if exists public.fn_chat_gema_espejar();

-- 2) El espejo del saldo vuelve a ser el de 20261106100000.
create or replace function public.fn_taxi_gemas_saldos_espejar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios
     set gemas_verdes = new.verdes, gemas_celestes = new.celestes
   where telefono = new.telefono and rol = 'pasajero'
     and (gemas_verdes is distinct from new.verdes or gemas_celestes is distinct from new.celestes);

  if tg_op = 'INSERT' or new.verdes is distinct from old.verdes then
    begin
      perform public.fn_webhook_emitir('taxi.gemas_verdes', 'caja', jsonb_build_object(
        'telefono', new.telefono, 'verdes', new.verdes,
        'version', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ));
    exception when others then
      raise warning 'fn_taxi_gemas_saldos_espejar: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop function if exists public.taxi__espejar_gemas(text);
drop function if exists public.taxi__gemas_verdes_visibles(text);

-- 3) Contador de gemas devueltas.
alter table public.usuarios
  add column if not exists gemas_verdes_devueltas integer not null default 0;
-- La app la lee (por si la tabla tiene permisos por columna).
grant select (gemas_verdes_devueltas) on public.usuarios to authenticated;

-- Nadie la cambia desde la app (igual que las gemas, 20261106100000).
create or replace function public.fn_usuarios_gemas_protegidas()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_s record;
begin
  if tg_op = 'INSERT' then
    if new.rol = 'pasajero' and new.telefono is not null then
      select * into v_s from public.taxi__gemas_de(new.telefono);
      new.gemas_verdes := coalesce(v_s.verdes, 0);
      new.gemas_celestes := coalesce(v_s.celestes, 0);
    else
      new.gemas_verdes := 0;
      new.gemas_celestes := 0;
    end if;
    new.gemas_verdes_devueltas := 0;
    return new;
  end if;
  if current_user in ('anon', 'authenticated') then
    new.gemas_verdes := old.gemas_verdes;
    new.gemas_celestes := old.gemas_celestes;
    new.gemas_verdes_devueltas := old.gemas_verdes_devueltas;
  end if;
  return new;
end;
$$;

-- 4) Uso y devolución de la gema (igual que 20261108100000 + el contador).
create or replace function public.fn_chat_oferta_gema_verde()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.taxi_gemas_config;
  v_tel text;
  v_saldo integer;
  v_tarifa numeric;
begin
  if new.tipo is distinct from 'oferta' then
    return new;
  end if;
  -- Estas columnas solo las mueve esta función.
  new.gema_estado := old.gema_estado;
  new.gema_valor := old.gema_valor;

  -- Aceptar: el pasajero pidió usar su gema.
  if old.estado_oferta = 'pendiente' and new.estado_oferta = 'aceptada' then
    if not coalesce(new.gema_usada, false) then
      new.gema_usada := false;
      return new;
    end if;
    new.gema_usada := false;
    select * into v_cfg from public.taxi_gemas_config where id;
    v_tarifa := public.taxi__tarifa_oferta(new.mensaje);
    if not coalesce(v_cfg.activo, false) or coalesce(v_tarifa, 0) < 1 then
      return new;
    end if;
    select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
    if v_tel is null then
      return new;
    end if;
    perform pg_advisory_xact_lock(hashtext('gema-conductor:' || new.conductor_id::text));
    if public.taxi__gemas_conductor_ocupadas(new.conductor_id) >= public.taxi__tope_gemas_conductor() then
      return new;
    end if;
    select verdes into v_saldo from public.taxi_gemas_saldos where telefono = v_tel for update;
    if coalesce(v_saldo, 0) < 1 then
      return new;
    end if;
    insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
    values (v_tel, 'verde', -1, 'viaje', 'uso:oferta:' || new.id::text, new.conductor_id)
    on conflict (ref) do nothing;
    if not found then
      return new;
    end if;
    update public.taxi_gemas_saldos set verdes = verdes - 1, actualizado = now() where telefono = v_tel;
    new.gema_usada := true;
    new.gema_estado := 'apartada';
    new.gema_valor := v_cfg.valor;
    return new;
  end if;

  -- Fuera de la aceptación nadie cambia si se usó la gema.
  new.gema_usada := old.gema_usada;

  if old.gema_estado = 'apartada' and new.estado_oferta in ('cancelada', 'rechazada') then
    select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
    if v_tel is not null then
      insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id)
      values (v_tel, 'verde', 1, 'viaje', 'devolucion:oferta:' || new.id::text, new.conductor_id)
      on conflict (ref) do nothing;
      if found then
        -- Primero la marca de devolución, después el saldo (que se copia a
        -- usuarios.gemas_verdes): la app ya sabe que es una devolución.
        update public.usuarios
           set gemas_verdes_devueltas = gemas_verdes_devueltas + 1
         where telefono = v_tel and rol = 'pasajero';
        insert into public.taxi_gemas_saldos (telefono, verdes) values (v_tel, 1)
        on conflict (telefono) do update
          set verdes = public.taxi_gemas_saldos.verdes + 1, actualizado = now();
      end if;
    end if;
    new.gema_estado := 'devuelta';
  elsif old.gema_estado = 'apartada' and new.estado_oferta = 'finalizado' then
    insert into public.taxi_gemas_conductores (conductor_id, recolectadas) values (new.conductor_id, 1)
    on conflict (conductor_id) do update
      set recolectadas = public.taxi_gemas_conductores.recolectadas + 1, actualizado = now();
    new.gema_estado := 'cobrada';
  end if;
  return new;
end;
$$;

-- 5) Si 20261201100000 se corrió, la copia quedó en saldo + apartadas:
--    volver a copiar el saldo (a usuarios y a Caja) donde no coincida.
do $$
declare
  r record;
begin
  for r in
    select s.telefono, s.verdes
      from public.taxi_gemas_saldos s
      join public.usuarios u on u.telefono = s.telefono and u.rol = 'pasajero'
     where u.gemas_verdes is distinct from s.verdes
  loop
    update public.usuarios set gemas_verdes = r.verdes
     where telefono = r.telefono and rol = 'pasajero';
    begin
      perform public.fn_webhook_emitir('taxi.gemas_verdes', 'caja', jsonb_build_object(
        'telefono', r.telefono, 'verdes', r.verdes,
        'version', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ));
    exception when others then
      raise warning 'gema_devuelta_sin_festejo: %', sqlerrm;
    end;
  end loop;
end;
$$;
