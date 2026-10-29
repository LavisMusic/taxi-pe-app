-- =========================================================================
-- Nombre de usuario automático y cambios de perfil una vez por semana.
--
--   * Toda cuenta nueva recibe un nombre de usuario libre sacado de su
--     nombre ("kevin.rivera", o con números si está tomado) si no trae uno
--     elegido (las que llegan de Caja traían el teléfono). Una sola vez,
--     también las cuentas que hoy no tienen uno.
--   * El nombre de usuario y la foto de perfil (pasajero y conductor; la
--     del conductor vive en conductores) se cambian una vez por semana.
--     Pasar del nombre provisional (teléfono o vacío) al primero elegido sí
--     cuenta. El Admin no tiene límite.
--   * rpc_webhook_caja_perfil_cliente (lo que el cliente cambia en Caja)
--     aplica la misma regla y devuelve hasta cuándo esperar.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.usuarios add column if not exists nombre_usuario_cambiado_at timestamptz;
alter table public.usuarios add column if not exists foto_cambiada_at timestamptz;
alter table public.conductores add column if not exists foto_cambiada_at timestamptz;
-- conductores se lee por columnas (permisos tanda 3b): la nueva también.
grant select (foto_cambiada_at) on public.conductores to authenticated;

create or replace function public.taxi_usuario_provisional(p_usuario text, p_telefono text)
returns boolean
language sql
immutable
as $$
  select p_usuario is null or p_usuario ~ '^\d{6,}$' or p_usuario = p_telefono;
$$;

-- Un nombre de usuario libre a partir de un nombre.
create or replace function public.taxi_generar_nombre_usuario(p_nombre text, p_excluir uuid default null)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_base text;
  v_cand text;
begin
  v_base := translate(lower(coalesce(p_nombre, '')), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc');
  v_base := regexp_replace(trim(v_base), '\s+', '.', 'g');
  v_base := regexp_replace(v_base, '[^a-z0-9._]', '', 'g');
  v_base := left(regexp_replace(v_base, '^[._]+|[._]+$', '', 'g'), 14);
  if length(v_base) < 3 then
    v_base := 'usuario';
  end if;
  v_cand := v_base;
  for i in 1..40 loop
    if not exists (
      select 1 from public.usuarios
      where lower(nombre_usuario) = v_cand and (p_excluir is null or id <> p_excluir)
    ) then
      return v_cand;
    end if;
    v_cand := v_base || (10 + floor(random() * (case when i < 20 then 990 else 99990 end)))::int;
  end loop;
  return v_base || replace(gen_random_uuid()::text, '-', '');
end;
$$;

-- ---------- Cuenta nueva: nombre de usuario automático ---------------------
create or replace function public.fn_usuarios_nombre_automatico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.taxi_usuario_provisional(new.nombre_usuario, new.telefono) then
    new.nombre_usuario := public.taxi_generar_nombre_usuario(coalesce(new.nombre, new.nombre_usuario), new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuarios_nombre_automatico on public.usuarios;
create trigger trg_usuarios_nombre_automatico
  before insert on public.usuarios
  for each row execute function public.fn_usuarios_nombre_automatico();

-- ---------- Una vez por semana -------------------------------------------
-- Sin security definer: current_user tiene que ser el de la sesión
-- (authenticated) para saber si el cambio lo hace la persona.
create or replace function public.fn_usuarios_perfil_semana()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sistema boolean := current_user not in ('anon', 'authenticated') or public.taxi_es_admin();
begin
  if new.nombre_usuario is distinct from old.nombre_usuario then
    if not v_sistema and old.nombre_usuario_cambiado_at > now() - interval '7 days' then
      raise exception 'Solo puedes cambiar tu nombre de usuario una vez por semana (de nuevo el %).',
        to_char((old.nombre_usuario_cambiado_at + interval '7 days') at time zone 'America/Lima', 'DD/MM HH24:MI')
        using errcode = '42501';
    end if;
    -- El nombre automático (sin elegir) no cuenta como cambio.
    if not v_sistema then
      new.nombre_usuario_cambiado_at := now();
    end if;
  end if;
  if new.foto_url is distinct from old.foto_url then
    if not v_sistema and old.foto_cambiada_at > now() - interval '7 days' then
      raise exception 'Solo puedes cambiar tu foto de perfil una vez por semana (de nuevo el %).',
        to_char((old.foto_cambiada_at + interval '7 days') at time zone 'America/Lima', 'DD/MM HH24:MI')
        using errcode = '42501';
    end if;
    if not v_sistema then
      new.foto_cambiada_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuarios_perfil_semana on public.usuarios;
create trigger trg_usuarios_perfil_semana
  before update of nombre_usuario, foto_url on public.usuarios
  for each row execute function public.fn_usuarios_perfil_semana();

-- Sin security definer: current_user tiene que ser el de la sesión
-- (authenticated) para saber si el cambio lo hace la persona.
create or replace function public.fn_conductores_foto_semana()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.foto_url is not distinct from old.foto_url then
    return new;
  end if;
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;
  if old.foto_cambiada_at > now() - interval '7 days' then
    raise exception 'Solo puedes cambiar tu foto de perfil una vez por semana (de nuevo el %).',
      to_char((old.foto_cambiada_at + interval '7 days') at time zone 'America/Lima', 'DD/MM HH24:MI')
      using errcode = '42501';
  end if;
  new.foto_cambiada_at := now();
  return new;
end;
$$;
drop trigger if exists trg_b_conductores_foto_semana on public.conductores;
create trigger trg_b_conductores_foto_semana
  before update of foto_url on public.conductores
  for each row execute function public.fn_conductores_foto_semana();

-- ---------- Caja -> Taxi: misma regla para el cliente ----------------------
create or replace function public.rpc_webhook_caja_perfil_cliente(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data     jsonb := p_payload -> 'data';
  v_telefono text  := trim(coalesce(v_data ->> 'telefono', ''));
  v_usuario  text  := lower(trim(coalesce(v_data ->> 'nombre_usuario', '')));
  v_u        public.usuarios;
begin
  if v_telefono = '' then
    return jsonb_build_object('status', 'payload_invalido');
  end if;
  select * into v_u from public.usuarios where telefono = v_telefono and rol = 'pasajero' limit 1;
  if v_u.id is null then
    return jsonb_build_object('status', 'sin_cuenta');
  end if;

  if v_data ? 'nombre_usuario' and v_usuario <> coalesce(lower(v_u.nombre_usuario), '') then
    if v_usuario !~ '^[a-z0-9._]{3,20}$' then
      return jsonb_build_object('status', 'usuario_invalido');
    end if;
    if v_u.nombre_usuario_cambiado_at > now() - interval '7 days' then
      return jsonb_build_object('status', 'espera_usuario', 'hasta', v_u.nombre_usuario_cambiado_at + interval '7 days');
    end if;
    if exists (select 1 from public.usuarios where lower(nombre_usuario) = v_usuario and id <> v_u.id) then
      return jsonb_build_object('status', 'usuario_tomado');
    end if;
    update public.usuarios set nombre_usuario = v_usuario, nombre_usuario_cambiado_at = now() where id = v_u.id;
  end if;

  if v_data ? 'foto_url' and nullif(v_data ->> 'foto_url', '') is not null
     and (v_data ->> 'foto_url') is distinct from v_u.foto_url then
    if v_u.foto_cambiada_at > now() - interval '7 days' then
      return jsonb_build_object('status', 'espera_foto', 'hasta', v_u.foto_cambiada_at + interval '7 days');
    end if;
    update public.usuarios set foto_url = v_data ->> 'foto_url', foto_cambiada_at = now() where id = v_u.id;
  end if;

  select * into v_u from public.usuarios where id = v_u.id;
  return jsonb_build_object(
    'status', 'ok',
    'nombre', v_u.nombre,
    'nombre_usuario', v_u.nombre_usuario,
    'foto_url', v_u.foto_url,
    'usuario_hasta', v_u.nombre_usuario_cambiado_at + interval '7 days',
    'foto_hasta', v_u.foto_cambiada_at + interval '7 days'
  );
end;
$$;
revoke execute on function public.rpc_webhook_caja_perfil_cliente(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_perfil_cliente(uuid, jsonb) to service_role;

-- ---------- Una sola vez: las cuentas que hoy no tienen uno ----------------
-- Fila por fila (cada una ve los nombres que ya se asignaron antes).
do $$
declare
  r record;
begin
  for r in select id, nombre, nombre_usuario, telefono from public.usuarios
           where public.taxi_usuario_provisional(nombre_usuario, telefono)
  loop
    update public.usuarios
      set nombre_usuario = public.taxi_generar_nombre_usuario(coalesce(r.nombre, r.nombre_usuario), r.id)
      where id = r.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
