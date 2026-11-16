-- =========================================================================
-- Chat del viaje: una sola encuesta de tarifa a la vez (Taxi-PE).
--
-- El conductor no puede mandar otra oferta mientras haya una esperando la
-- respuesta del pasajero en esa conversación (si la rechaza, puede volver a
-- proponer). La pantalla ya apaga los botones; esto lo asegura en la base.
-- Misma función de 20261122100000 (avisos del sistema y quién escribe) con
-- esta regla agregada.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_chat_mensajes_remitente()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tipo text := coalesce(new.tipo, 'texto');
  v_conductor uuid;
  v_es_pasajero boolean;
  v_es_conductor boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;

  v_conductor := public.taxi_mi_conductor_id();
  v_es_pasajero := new.pasajero_id = auth.uid();
  v_es_conductor := v_conductor is not null and new.conductor_id = v_conductor;

  if v_tipo not in ('texto', 'oferta', 'senas', 'sistema', 'sistema_viaje') then
    raise exception 'Tipo de mensaje no permitido.' using errcode = '42501';
  end if;

  -- Avisos del sistema: solo los fijos de la app, cada lado los suyos.
  if new.remitente = 'sistema' or v_tipo in ('sistema', 'sistema_viaje') then
    if not (
      new.remitente = 'sistema'
      and (
        (v_es_pasajero and v_tipo = 'sistema'
          and new.mensaje ~ '^\S{1,3} El pasajero (rechazó la oferta|ha cancelado el viaje)$')
        or (v_es_conductor and v_tipo = 'sistema'
          and new.mensaje ~ '^\S{1,3} (El conductor ha cancelado el viaje|Estás cerca de tu destino)$')
        or (v_es_conductor and v_tipo = 'sistema_viaje'
          and new.mensaje ~ '^\S{1,3} Viaje Iniciado$')
      )
    ) then
      raise exception 'Aviso del sistema no permitido.' using errcode = '42501';
    end if;
  end if;

  -- El conductor no abre conversaciones: el pasajero tiene que haber escrito.
  if v_es_conductor and not v_es_pasajero and not exists (
    select 1 from public.chat_mensajes c
    where c.conductor_id = new.conductor_id
      and c.pasajero_id = new.pasajero_id
      and c.remitente = 'pasajero'
  ) then
    raise exception 'El pasajero todavía no te ha escrito.' using errcode = '42501';
  end if;

  -- Una sola encuesta de tarifa esperando respuesta por conversación.
  if v_tipo = 'oferta' and exists (
    select 1 from public.chat_mensajes c
    where c.conductor_id = new.conductor_id
      and c.pasajero_id = new.pasajero_id
      and c.tipo = 'oferta'
      and c.estado_oferta = 'pendiente'
  ) then
    raise exception 'Ya enviaste una tarifa: espera la respuesta del pasajero.' using errcode = '23505';
  end if;

  return new;
end;
$$;
