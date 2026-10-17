-- =========================================================================
-- /restablecer-pin: al guardar el PIN nuevo, la respuesta trae también el
-- teléfono, el rol y el nombre de la cuenta. La página los usa para
-- copiar el PIN nuevo de un pasajero a su cuenta de Caja Tonazo
-- (mirror-a-caja, que vuelve a comprobar el PIN contra el hash antes de
-- reenviarlo). Quien recibe esto ya demostró ser el dueño con el código.
-- Mantiene el desbloqueo del login de 20261015110000.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_restablecer_pin_guardar(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p  public.peticiones_pin;
  v_id uuid;
  v_u  public.usuarios;
begin
  select * into v_p from public.peticiones_pin
  where reset_token = p_token and reset_expira > now();
  if not found then
    return jsonb_build_object('estado', 'vencido');
  end if;
  v_id := coalesce(
    v_p.usuario_id,
    (select id from public.usuarios where dni = v_p.dni limit 1)
  );
  if v_id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  perform public.taxi_guardar_pin(v_id, p_pin);
  update public.peticiones_pin set reset_token = null, reset_expira = null where id = v_p.id;

  -- Sin bloqueo: puede entrar ya mismo con el PIN nuevo.
  select * into v_u from public.usuarios where id = v_id;
  if v_u.telefono is not null then
    delete from public.taxi_intentos where clave = 'login:' || v_u.telefono;
  end if;
  return jsonb_build_object(
    'estado', 'ok',
    'telefono', v_u.telefono,
    'rol', v_u.rol,
    'nombre', v_u.nombre
  );
end;
$$;
grant execute on function public.taxi_restablecer_pin_guardar(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
