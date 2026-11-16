-- =========================================================================
-- Gemas verdes visibles = saldo + apartadas (Taxi-PE).
--
-- Bug: al cancelar un viaje en el que el pasajero usó su gema, la gema
-- vuelve a su saldo (bien), pero su contador subía y la app festejaba "¡Ganaste
-- una gema!" como si la hubiera ganado. Ahora el número que ve el pasajero
-- (usuarios.gemas_verdes) y el que se copia a Caja (taxi.gemas_verdes) es
-- su saldo MÁS las gemas apartadas en un viaje en curso:
--   * al usarla (aceptar la tarifa): el número no cambia;
--   * al terminar el viaje (la gema se cobra): baja en 1;
--   * al cancelar o rechazar (se devuelve): no cambia, no hay festejo.
--
--   * taxi__gemas_verdes_visibles(tel) y taxi__espejar_gemas(tel): calculan y
--     copian el número (a usuarios y a Caja).
--   * fn_chat_oferta_gema_verde marca la transacción (taxi.gemas_en_oferta)
--     para que el espejo del saldo no copie un número a medio camino; lo
--     copia una sola vez el trigger nuevo de chat_mensajes, ya con el estado
--     final de la gema.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi__gemas_verdes_visibles(p_tel text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.verdes from public.taxi_gemas_saldos s where s.telefono = p_tel), 0)
       + (select count(*)::integer
            from public.chat_mensajes m
            join public.usuarios u on u.id = m.pasajero_id
           where u.telefono = p_tel and u.rol = 'pasajero' and m.gema_estado = 'apartada');
$$;
revoke execute on function public.taxi__gemas_verdes_visibles(text) from public, anon, authenticated;

create or replace function public.taxi__espejar_gemas(p_tel text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vis integer := public.taxi__gemas_verdes_visibles(p_tel);
  v_cel integer;
begin
  select coalesce(celestes, 0) into v_cel from public.taxi_gemas_saldos where telefono = p_tel;
  update public.usuarios
     set gemas_verdes = v_vis, gemas_celestes = coalesce(v_cel, gemas_celestes)
   where telefono = p_tel and rol = 'pasajero'
     and (gemas_verdes is distinct from v_vis or gemas_celestes is distinct from coalesce(v_cel, gemas_celestes));
  begin
    perform public.fn_webhook_emitir('taxi.gemas_verdes', 'caja', jsonb_build_object(
      'telefono', p_tel, 'verdes', v_vis,
      'version', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ));
  exception when others then
    raise warning 'taxi__espejar_gemas: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public.taxi__espejar_gemas(text) from public, anon, authenticated;

-- Saldo -> copia (salvo a mitad de un uso/devolución en un viaje).
create or replace function public.fn_taxi_gemas_saldos_espejar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('taxi.gemas_en_oferta', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' or new.verdes is distinct from old.verdes or new.celestes is distinct from old.celestes then
    perform public.taxi__espejar_gemas(new.telefono);
  end if;
  return new;
end;
$$;

-- Uso y devolución de la gema en el viaje (igual que 20261108100000, con la
-- marca de la transacción).
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
    perform set_config('taxi.gemas_en_oferta', '1', true);
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
        perform set_config('taxi.gemas_en_oferta', '1', true);
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

-- Ya con el estado final de la gema guardado: copia el número una sola vez.
create or replace function public.fn_chat_gema_espejar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
begin
  if new.gema_estado is not distinct from old.gema_estado then
    return null;
  end if;
  select telefono into v_tel from public.usuarios where id = new.pasajero_id and rol = 'pasajero';
  if v_tel is not null then
    perform public.taxi__espejar_gemas(v_tel);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_chat_gema_espejar on public.chat_mensajes;
create trigger trg_chat_gema_espejar
  after update on public.chat_mensajes
  for each row when (new.tipo = 'oferta')
  execute function public.fn_chat_gema_espejar();

-- Poner al día a quienes tienen una gema apartada ahora.
do $$
declare
  r record;
begin
  for r in
    select distinct u.telefono
      from public.chat_mensajes m
      join public.usuarios u on u.id = m.pasajero_id and u.rol = 'pasajero'
     where m.gema_estado = 'apartada' and u.telefono is not null
  loop
    perform public.taxi__espejar_gemas(r.telefono);
  end loop;
end;
$$;
