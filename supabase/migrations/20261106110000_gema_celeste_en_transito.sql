-- =========================================================================
-- Gemas cruzadas: la celeste no se daba nunca.
--
-- Causa: el trigger exigía que la oferta pasara de 'aceptada' a
-- 'finalizado', pero un viaje normal pasa por 'en_transito' en el medio
-- (el conductor toca "Pasajero recogido"): aceptada -> en_transito ->
-- finalizado.
--
-- Arreglo: se da al finalizar viniendo de 'aceptada' o de 'en_transito'.
-- La lógica pasa a taxi__dar_gema_celeste (mismos límites: 5 por día y 2
-- con el mismo conductor) y se usa también para darle su gema a los
-- viajes que terminaron desde que se activaron las gemas
-- (20261106100000_gemas.sql) y se quedaron sin ella.
--
-- Proyecto: Taxi-PE. Idempotente (una gema por oferta, por su ref).
-- =========================================================================

create or replace function public.taxi__dar_gema_celeste(
  p_oferta_id text, p_pasajero uuid, p_conductor uuid, p_cuando timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel text;
  v_cfg public.taxi_gemas_config;
  v_hoy integer;
  v_con_el integer;
  v_desde timestamptz := (date_trunc('day', p_cuando at time zone 'America/Lima') at time zone 'America/Lima');
  v_ref text := 'celeste:oferta:' || p_oferta_id;
  v_id uuid;
begin
  if p_pasajero is null then
    return false;
  end if;
  select * into v_cfg from public.taxi_gemas_config where id;
  if not coalesce(v_cfg.activo, false) then
    return false;
  end if;
  select telefono into v_tel from public.usuarios where id = p_pasajero and rol = 'pasajero';
  if v_tel is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('gema-celeste:' || v_tel));
  select coalesce(sum(delta), 0),
         coalesce(sum(delta) filter (where conductor_id = p_conductor), 0)
    into v_hoy, v_con_el
    from public.taxi_gemas_movimientos
   where telefono = v_tel and color = 'celeste' and motivo = 'viaje'
     and created_at >= v_desde and created_at < v_desde + interval '1 day';
  if v_hoy >= 5 or v_con_el >= 2 then
    return false;
  end if;

  insert into public.taxi_gemas_movimientos (telefono, color, delta, motivo, ref, conductor_id, created_at)
  values (v_tel, 'celeste', 1, 'viaje', v_ref, p_conductor, p_cuando)
  on conflict (ref) do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;

  begin
    perform public.fn_webhook_emitir('taxi.gema_celeste', 'caja', jsonb_build_object(
      'ref', v_ref, 'telefono', v_tel, 'delta', 1, 'motivo', 'viaje'
    ));
  exception when others then
    raise warning 'taxi__dar_gema_celeste: %', sqlerrm;
  end;
  return true;
end;
$$;
revoke execute on function public.taxi__dar_gema_celeste(text, uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.fn_chat_oferta_gema_celeste()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'oferta'
     and new.estado_oferta = 'finalizado'
     and old.estado_oferta in ('aceptada', 'en_transito') then
    perform public.taxi__dar_gema_celeste(new.id::text, new.pasajero_id, new.conductor_id);
  end if;
  return new;
end;
$$;

-- Viajes terminados desde que se activaron las gemas, sin su celeste.
do $$
declare
  v_activadas timestamptz;
  r record;
begin
  select min(created_at) into v_activadas from public.taxi_gemas_movimientos;
  v_activadas := least(coalesce(v_activadas, now()), '2026-11-06 22:00:00+00'::timestamptz);
  for r in
    select m.id, m.pasajero_id, m.conductor_id, m.finalizado_at
      from public.chat_mensajes m
     where m.tipo = 'oferta'
       and m.estado_oferta = 'finalizado'
       and m.finalizado_at >= v_activadas
     order by m.finalizado_at
  loop
    perform public.taxi__dar_gema_celeste(r.id::text, r.pasajero_id, r.conductor_id, r.finalizado_at);
  end loop;
end $$;
