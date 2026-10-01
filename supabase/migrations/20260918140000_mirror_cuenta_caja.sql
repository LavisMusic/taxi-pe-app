-- =========================================================================
-- Espejo de cuentas Caja Tonazo -> Taxi-PE (unificación pasajero/cliente).
--
-- Cuando un CLIENTE de Caja Tonazo registra o cambia su PIN (celular +
-- PIN), esa misma cuenta se replica acá en 'usuarios' (rol 'pasajero')
-- para que pueda entrar a Taxi-PE con las MISMAS credenciales — sin
-- tocar el esquema de auth de pasajero existente (tabla propia
-- 'usuarios', pin hasheado con pgcrypto vía hash_pin/verify_pin, sin
-- Supabase Auth de por medio).
--
-- Reusa la infraestructura HMAC de WEBHOOKS.md — mismo secreto
-- WEBHOOK_SECRET_CAJA_TO_TAXI ya configurado para esa dirección, sin
-- vault ni secretos nuevos. El emisor (Caja) llama synchronously vía
-- fetch() (mismo patrón que entrega-iniciar/entrega-crear), no por el
-- outbox/pg_cron — no hace falta reintento automático para un espejo
-- best-effort.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_webhook_caja_mirror_cliente(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
-- 'extensions' hace falta acá: hash_pin() usa gen_salt()/crypt() de
-- pgcrypto, que en Supabase vive en el schema 'extensions' (ver
-- fn_webhook_firmar más arriba en este mismo repo) — sin incluirlo acá,
-- el search_path de ESTA función pisa el que hash_pin() necesita
-- (Postgres solo aplica el SET search_path del nivel más externo de la
-- cadena de llamadas) y revienta con "function gen_salt(unknown) does
-- not exist".
set search_path = public, extensions
as $$
declare
  v_nuevo    integer;
  v_data     jsonb := p_payload -> 'data';
  v_telefono text  := v_data ->> 'telefono';
  v_pin      text  := v_data ->> 'pin';
  v_nombre   text  := v_data ->> 'nombre';
  v_hash     text;
  v_id       uuid;
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

  v_hash := public.hash_pin(v_pin);

  select id into v_id from public.usuarios where telefono = v_telefono and rol = 'pasajero';

  if v_id is null then
    -- nombre_usuario es requerido/único en el registro exprés normal,
    -- pero el login de pasajero (PasajeroAuthForm/usePasajeroAuth) solo
    -- busca por teléfono — el propio teléfono alcanza como valor único
    -- de relleno, el pasajero puede cambiarlo después si quiere.
    insert into public.usuarios (nombre_usuario, telefono, pin, nombre, rol, estado_verificacion)
    values (v_telefono, v_telefono, v_hash, coalesce(v_nombre, 'Pasajero'), 'pasajero', 'permanente');
  else
    update public.usuarios
      set pin = v_hash,
          nombre = coalesce(v_nombre, nombre)
      where id = v_id;
  end if;

  update public.webhook_inbox
    set estado = 'procesado', procesado_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', 'ok');
end;
$$;
