-- =========================================================================
-- RUC opcional del recolector.
--
-- El recolector se registra con su propio formulario (nombre, teléfono,
-- DNI, foto y RUC opcional; sin placa). taxi_registrar_recolector guarda
-- el RUC (11 dígitos o nada).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
alter table public.usuarios add column if not exists ruc text;

drop function if exists public.taxi_registrar_recolector(text, text, text, text);
create or replace function public.taxi_registrar_recolector(
  p_nombre text,
  p_telefono text,
  p_dni text,
  p_ruc text default null,
  p_foto_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u   public.usuarios;
  v_ruc text := nullif(trim(coalesce(p_ruc, '')), '');
begin
  if v_ruc is not null and v_ruc !~ '^\d{11}$' then
    return jsonb_build_object('estado', 'ruc_invalido');
  end if;
  if public.taxi_existe_cuenta(p_dni, p_telefono) then
    return jsonb_build_object('estado', 'duplicado');
  end if;
  insert into public.usuarios (dni, telefono, pin, nombre, rol, estado_cuenta, foto_url, ruc)
  values (trim(p_dni), trim(p_telefono), null, p_nombre, 'recolector', 'pendiente', p_foto_url, v_ruc)
  returning * into v_u;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u));
end;
$$;
grant execute on function public.taxi_registrar_recolector(text, text, text, text, text) to anon, authenticated;
