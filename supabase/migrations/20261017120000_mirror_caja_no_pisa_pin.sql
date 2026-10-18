-- =========================================================================
-- Espejo Caja -> Taxi-PE (caja.mirror_cliente): ya no pisa el PIN de un
-- pasajero que YA tiene uno.
--
-- Antes, registrarse en Caja Tonazo con el número de alguien que solo
-- tenía cuenta en Taxi-PE le cambiaba el PIN de Taxi-PE y se quedaba con
-- su cuenta. Ahora el espejo solo:
--   * crea la cuenta de pasajero si no existe;
--   * pone el PIN si la cuenta existe pero todavía no tiene uno;
--   * con PIN ya puesto, no cambia nada salvo que el aviso traiga
--     sobrescribir_pin = true (hoy Caja no lo manda nunca: el cambio de
--     PIN de verdad se hace en Taxi-PE con el código y se copia a Caja).
-- Mismo criterio que webhook-taxi-mirror-cuenta en Caja (sentido
-- contrario).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_webhook_caja_mirror_cliente(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_nuevo    integer;
  v_data     jsonb := p_payload -> 'data';
  v_telefono text  := v_data ->> 'telefono';
  v_pin      text  := v_data ->> 'pin';
  v_nombre   text  := v_data ->> 'nombre';
  v_pisar    boolean := coalesce((v_data ->> 'sobrescribir_pin')::boolean, false);
  v_hash     text;
  v_id       uuid;
  v_tiene    boolean;
begin
  insert into public.webhook_inbox (event_id, event_type, payload)
  values (p_event_id, p_payload ->> 'event_type', p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  if v_telefono is null or v_pin is null then
    update public.webhook_inbox
      set estado = 'error', nota = 'faltan telefono/pin', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'payload_invalido');
  end if;

  select id into v_id from public.usuarios where telefono = v_telefono and rol = 'pasajero';

  if v_id is null then
    v_hash := public.hash_pin(v_pin);
    -- El teléfono hace de nombre de usuario (único) en las cuentas que
    -- llegan desde Caja.
    insert into public.usuarios (nombre_usuario, telefono, pin, nombre, rol, estado_verificacion)
    values (v_telefono, v_telefono, v_hash, coalesce(v_nombre, 'Pasajero'), 'pasajero', 'permanente');
  else
    select exists (select 1 from public.usuarios_credenciales where usuario_id = v_id) into v_tiene;
    if v_tiene and not v_pisar then
      update public.webhook_inbox
        set estado = 'procesado', nota = 'ya tenía PIN: no se cambia', procesado_at = now()
        where event_id = p_event_id;
      return jsonb_build_object('status', 'ok', 'accion', 'ya_existe');
    end if;
    v_hash := public.hash_pin(v_pin);
    update public.usuarios
      set pin = v_hash,
          nombre = coalesce(nombre, v_nombre)
      where id = v_id;
  end if;

  update public.webhook_inbox
    set estado = 'procesado', procesado_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

notify pgrst, 'reload schema';
