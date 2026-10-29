-- =========================================================================
-- Sistema antirrobo: bloqueo de emergencia y recuperación de cuenta.
--
-- 1. Bloqueo de emergencia (Soporte -> "Bloquear mi cuenta"): con su
--    celular y su PIN actual — o el anterior, hasta 72 horas después de
--    un cambio (si le robaron el celular y el ladrón ya cambió el PIN con
--    el WhatsApp robado, el dueño solo conoce el viejo) — la cuenta queda
--    bloqueada: no puede entrar (taxi_login -> 'bloqueada'), se cierran
--    sus sesiones, se anulan los códigos de cambio de PIN en curso y no
--    se pueden pedir nuevos. Si es pasajero, su cuenta de Caja Tonazo
--    también se bloquea (aviso taxi.cuenta_bloqueo). El propio usuario no
--    puede quitarlo: solo se quita al recuperar la cuenta.
--    5 intentos fallidos por número -> 15 minutos de espera.
--
-- 2. Recuperar cuenta (Soporte -> "Recuperar cuenta"): número de la
--    cuenta, nombre completo, DNI, foto sosteniendo el DNI, comentario y
--    número de recuperación (adonde se manda el código). Crea una petición
--    para el Admin de Taxi-PE (Centro de Peticiones -> "Recuperar
--    cuenta"); enviarla no bloquea ni desbloquea nada. Aceptar genera un
--    código (30 min, un solo uso) que el Admin manda por WhatsApp al
--    número de recuperación con el enlace a /restablecer-pin; al elegir
--    el PIN nuevo se quita el bloqueo (también en Caja). Rechazar la
--    descarta. La foto vive en el bucket privado 'verificaciones'
--    (carpeta recuperaciones/) y el Admin la borra al resolver.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Bloqueos ----------------------------------------------------------
create table if not exists public.taxi_bloqueos (
  usuario_id   uuid primary key references public.usuarios(id) on delete cascade,
  bloqueado_en timestamptz not null default now()
);
alter table public.taxi_bloqueos enable row level security;
revoke all on public.taxi_bloqueos from anon, authenticated;

-- ¿Esta cuenta está bloqueada? (la app la saca si lo está; solo un sí/no).
create or replace function public.taxi_cuenta_bloqueada(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.taxi_bloqueos where usuario_id = p_usuario_id);
$$;
grant execute on function public.taxi_cuenta_bloqueada(uuid) to anon, authenticated;

-- ---------- PIN anterior (72 horas) ------------------------------------------
alter table public.usuarios_credenciales
  add column if not exists pin_hash_anterior text,
  add column if not exists anterior_vence    timestamptz;

-- Mismo trigger de 20261009100000; al cambiar un PIN que ya existía,
-- guarda el anterior por 72 horas (solo sirve para el bloqueo).
create or replace function public.fn_usuarios_pin_privado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.pin is not null)
       or (tg_op = 'UPDATE' and new.pin is distinct from old.pin) then
      raise exception 'El PIN solo se cambia con las funciones de la app (taxi_crear_pin, taxi_admin_fijar_pin…).'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.pin is null then
    if tg_op = 'UPDATE' and old.pin is not null then
      delete from public.usuarios_credenciales where usuario_id = new.id;
    end if;
  elsif new.pin <> 'protegido' then
    insert into public.usuarios_credenciales as c (usuario_id, pin_hash, actualizado_en)
    values (new.id, new.pin, now())
    on conflict (usuario_id) do update
      set pin_hash_anterior = c.pin_hash,
          anterior_vence = now() + interval '72 hours',
          pin_hash = excluded.pin_hash,
          actualizado_en = now();
    new.pin := 'protegido';
  end if;
  return new;
end;
$$;

-- ---------- Avisos a Caja: bloqueo/desbloqueo del pasajero -------------------
create or replace function public.fn_webhook_emitir(p_event_type text, p_destino text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_url      text;
  v_sobre    jsonb;
begin
  v_url := case p_event_type
    when 'taxi.pago_fiado_conductor'      then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    when 'taxi.entrega_estado'            then public.fn_webhook_secret('webhook_url_caja_entrega_estado')
    when 'taxi.mirror_pasajero_eliminado' then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    -- Mismo receptor de Caja (webhook-taxi-mirror-cuenta).
    when 'taxi.cuenta_bloqueo'            then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    when 'taxi.saldo_pasajero'            then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    else null
  end;
  if v_url is null then
    raise exception 'fn_webhook_emitir: sin URL para event_type %', p_event_type;
  end if;

  v_sobre := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', p_event_type,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', 'taxi',
    'data', p_data
  );

  insert into public.webhook_outbox (event_id, event_type, destino, url, payload)
  values (v_event_id, p_event_type, p_destino, v_url, v_sobre);

  perform public.fn_webhook_despachar(
    (select id from public.webhook_outbox where event_id = v_event_id)
  );
  return v_event_id;
end;
$$;
revoke execute on function public.fn_webhook_emitir(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_webhook_emitir(text, text, jsonb) to service_role;

create or replace function public.taxi_avisar_bloqueo_caja(p_u public.usuarios, p_bloqueada boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_u.rol <> 'pasajero' or p_u.telefono is null then
    return;
  end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.cuenta_bloqueo', 'caja',
      jsonb_build_object('telefono', p_u.telefono, 'bloqueada', p_bloqueada)
    );
  exception when others then
    raise warning 'taxi_avisar_bloqueo_caja: aviso no emitido: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public.taxi_avisar_bloqueo_caja(public.usuarios, boolean) from public, anon, authenticated;

-- ---------- Bloqueo de emergencia --------------------------------------------
-- Devuelve { estado: 'ok' | 'incorrecto' | 'bloqueado' (demasiados
-- intentos) | 'ya_bloqueada' }.
create or replace function public.taxi_bloquear_cuenta(p_telefono text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tel   text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_clave text := 'bloqueo:' || regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_u     public.usuarios;
  v_c     public.usuarios_credenciales;
  v_ok    integer := 0;
  v_ya    integer := 0;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  if v_tel ~ '^9\d{8}$' and coalesce(p_pin, '') ~ '^\d{6}$' then
    for v_u in
      select * from public.usuarios
      where telefono = v_tel and rol in ('pasajero', 'conductor', 'recolector')
    loop
      select * into v_c from public.usuarios_credenciales where usuario_id = v_u.id;
      if v_c.usuario_id is null then
        continue;
      end if;
      if crypt(p_pin, v_c.pin_hash) = v_c.pin_hash
         or (v_c.pin_hash_anterior is not null and v_c.anterior_vence > now()
             and crypt(p_pin, v_c.pin_hash_anterior) = v_c.pin_hash_anterior) then
        if exists (select 1 from public.taxi_bloqueos where usuario_id = v_u.id) then
          v_ya := v_ya + 1;
          continue;
        end if;
        insert into public.taxi_bloqueos (usuario_id) values (v_u.id) on conflict do nothing;
        -- Fuera de todos lados: tickets, sesiones y códigos en curso.
        delete from public.taxi_tickets where usuario_id = v_u.id;
        begin
          delete from auth.sessions where user_id = v_u.id;
        exception when others then
          raise warning 'taxi_bloquear_cuenta: no se cerraron las sesiones: %', sqlerrm;
        end;
        update public.peticiones_pin
          set estado = 'resuelto', codigo_hash = null, codigo_expira = null, reset_token = null, reset_expira = null
          where usuario_id = v_u.id and estado <> 'resuelto';
        perform public.taxi_avisar_bloqueo_caja(v_u, true);
        v_ok := v_ok + 1;
      end if;
    end loop;
  end if;

  if v_ok = 0 and v_ya = 0 then
    perform public.taxi_intento_registrar(v_clave, false, 5);
    if public.taxi_intento_bloqueado(v_clave) then
      return jsonb_build_object('estado', 'bloqueado');
    end if;
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  perform public.taxi_intento_registrar(v_clave, true);
  if v_ok = 0 then
    return jsonb_build_object('estado', 'ya_bloqueada');
  end if;
  return jsonb_build_object('estado', 'ok');
end;
$$;
grant execute on function public.taxi_bloquear_cuenta(text, text) to anon, authenticated;

-- ---------- Login: una cuenta bloqueada no entra ------------------------------
create or replace function public.taxi_login(p_telefono text, p_pin text, p_roles text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clave text := 'login:' || coalesce(trim(p_telefono), '');
  v_u     public.usuarios;
  v_hash  text;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  select * into v_u from public.usuarios
    where telefono = trim(p_telefono) and rol = any (p_roles)
    limit 1;
  if v_u.id is null then
    perform public.taxi_intento_registrar(v_clave, false);
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  select pin_hash into v_hash from public.usuarios_credenciales where usuario_id = v_u.id;
  if v_hash is null then
    return jsonb_build_object('estado', 'sin_pin', 'usuario', to_jsonb(v_u));
  end if;

  if coalesce(p_pin, '') !~ '^\d{6}$' or crypt(p_pin, v_hash) <> v_hash then
    perform public.taxi_intento_registrar(v_clave, false);
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  perform public.taxi_intento_registrar(v_clave, true);
  -- Solo se avisa del bloqueo a quien dio el PIN correcto.
  if exists (select 1 from public.taxi_bloqueos where usuario_id = v_u.id) then
    return jsonb_build_object('estado', 'bloqueada');
  end if;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

-- ---------- Peticiones de PIN: origen y vínculo a la recuperación ------------
alter table public.peticiones_pin
  add column if not exists origen text not null default 'pin',
  add column if not exists recuperacion_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peticiones_pin_origen_check') then
    alter table public.peticiones_pin add constraint peticiones_pin_origen_check
      check (origen in ('pin', 'recuperacion'));
  end if;
end $$;

-- Pedir el cambio de PIN (20261015100000) + cuenta bloqueada -> 'bloqueada'.
create or replace function public.taxi_pedir_cambio_pin(p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := public.taxi_clave_dispositivo('pedir-pin');
  v_tel   text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_u     public.usuarios;
  v_placa text;
  v_abierta public.peticiones_pin;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;
  if v_tel !~ '^9\d{8}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into v_u from public.usuarios
  where telefono = v_tel and rol in ('pasajero', 'conductor', 'recolector')
  order by created_at
  limit 1;
  if v_u.id is null then
    perform public.taxi_intento_registrar(v_clave, false, 5);
    if public.taxi_intento_bloqueado(v_clave) then
      return jsonb_build_object('estado', 'bloqueado');
    end if;
    return jsonb_build_object('estado', 'no_existe');
  end if;

  if exists (select 1 from public.taxi_bloqueos where usuario_id = v_u.id) then
    return jsonb_build_object('estado', 'bloqueada');
  end if;

  select * into v_abierta from public.peticiones_pin
  where usuario_id = v_u.id and estado <> 'resuelto' and origen = 'pin'
  order by created_at desc
  limit 1;
  if v_abierta.id is not null then
    if v_abierta.estado = 'codigo_enviado' and v_abierta.codigo_expira > now() then
      return jsonb_build_object('estado', 'codigo_enviado');
    end if;
    return jsonb_build_object('estado', 'pendiente');
  end if;

  if v_u.rol = 'conductor' then
    select placa into v_placa from public.conductores where telefono = v_tel limit 1;
  end if;

  insert into public.peticiones_pin (nombre, dni, placa, tipo_usuario, estado, telefono, usuario_id)
  values (
    coalesce(nullif(trim(concat_ws(' ', v_u.nombre, v_u.apellido)), ''), v_u.nombre_usuario, 'Sin nombre'),
    v_u.dni, v_placa, v_u.rol, 'pendiente', v_tel, v_u.id
  );
  return jsonb_build_object('estado', 'enviada');
end;
$$;
grant execute on function public.taxi_pedir_cambio_pin(text) to anon, authenticated;

-- El Admin no manda códigos de cambio de PIN a una cuenta bloqueada (solo
-- por la recuperación de cuenta).
create or replace function public.taxi_admin_codigo_pin(p_peticion_id text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p      public.peticiones_pin;
  v_codigo text;
  v_expira timestamptz := now() + interval '30 minutes';
  v_tel    text;
begin
  if not (public.taxi_es_admin() or (p_token is not null and public.taxi_admin_token_valido(p_token))) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  select * into v_p from public.peticiones_pin where id::text = p_peticion_id;
  if not found or v_p.estado = 'resuelto' then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_p.origen = 'pin' and exists (select 1 from public.taxi_bloqueos where usuario_id = v_p.usuario_id) then
    return jsonb_build_object('estado', 'bloqueada');
  end if;

  v_tel := coalesce(
    v_p.telefono,
    (select telefono from public.usuarios where id = v_p.usuario_id),
    (select telefono from public.usuarios where dni = v_p.dni limit 1)
  );
  if v_tel is null then
    return jsonb_build_object('estado', 'sin_telefono');
  end if;

  v_codigo := public.taxi_codigo_legible();
  update public.peticiones_pin
    set codigo_hash = crypt(v_codigo, gen_salt('bf')),
        codigo_expira = v_expira,
        reset_token = null,
        reset_expira = null,
        estado = 'codigo_enviado'
    where id = v_p.id;

  return jsonb_build_object(
    'estado', 'ok',
    'codigo', substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4),
    'expira', v_expira,
    'nombre', v_p.nombre,
    'telefono', v_tel
  );
end;
$$;
revoke execute on function public.taxi_admin_codigo_pin(text, uuid) from public, anon;
grant execute on function public.taxi_admin_codigo_pin(text, uuid) to authenticated;

-- ---------- Peticiones de recuperación de cuenta ------------------------------
create table if not exists public.peticiones_recuperacion (
  id                    uuid primary key default gen_random_uuid(),
  usuario_id            uuid not null references public.usuarios(id) on delete cascade,
  telefono              text not null,
  nombre_completo       text not null,
  dni                   text not null,
  telefono_recuperacion text not null,
  comentario            text not null,
  foto                  text,
  estado                text not null default 'pendiente'
                        check (estado in ('pendiente', 'aceptada', 'rechazada', 'resuelta')),
  dispositivo           text,
  created_at            timestamptz not null default now(),
  resuelta_en           timestamptz
);
create index if not exists peticiones_recuperacion_abiertas_idx
  on public.peticiones_recuperacion (created_at desc) where estado in ('pendiente', 'aceptada');

alter table public.peticiones_recuperacion enable row level security;
revoke all on public.peticiones_recuperacion from anon;
drop policy if exists peticiones_recuperacion_admin on public.peticiones_recuperacion;
create policy peticiones_recuperacion_admin on public.peticiones_recuperacion for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'peticiones_recuperacion'
  ) then
    alter publication supabase_realtime add table public.peticiones_recuperacion;
  end if;
end $$;

-- Público: enviar la petición. Devuelve { estado: 'enviada' | 'pendiente'
-- | 'no_existe' | 'invalido' | 'limite' | 'bloqueado' }.
create or replace function public.taxi_pedir_recuperacion(
  p_telefono text,
  p_nombre text,
  p_dni text,
  p_telefono_recuperacion text,
  p_comentario text,
  p_foto text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_disp  text := public.taxi_clave_dispositivo('pedir-recuperacion');
  v_tel   text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_rec   text := regexp_replace(coalesce(p_telefono_recuperacion, ''), '\D', '', 'g');
  v_dni   text := regexp_replace(coalesce(p_dni, ''), '\D', '', 'g');
  v_u     public.usuarios;
begin
  if public.taxi_intento_bloqueado(v_disp) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;
  if v_tel !~ '^9\d{8}$' or v_rec !~ '^9\d{8}$' or v_dni !~ '^\d{8}$'
     or nullif(trim(p_nombre), '') is null or nullif(trim(p_comentario), '') is null
     or length(p_comentario) > 1000
     or coalesce(p_foto, '') !~ '^privado:recuperaciones/' then
    return jsonb_build_object('estado', 'invalido');
  end if;
  -- Máximo 3 peticiones por dispositivo en una hora.
  if (select count(*) from public.peticiones_recuperacion
      where dispositivo = v_disp and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('estado', 'limite');
  end if;

  select * into v_u from public.usuarios
  where telefono = v_tel and rol in ('pasajero', 'conductor', 'recolector')
  order by created_at
  limit 1;
  if v_u.id is null then
    perform public.taxi_intento_registrar(v_disp, false, 5);
    if public.taxi_intento_bloqueado(v_disp) then
      return jsonb_build_object('estado', 'bloqueado');
    end if;
    return jsonb_build_object('estado', 'no_existe');
  end if;

  if exists (select 1 from public.peticiones_recuperacion
             where usuario_id = v_u.id and estado in ('pendiente', 'aceptada')) then
    return jsonb_build_object('estado', 'pendiente');
  end if;

  insert into public.peticiones_recuperacion
    (usuario_id, telefono, nombre_completo, dni, telefono_recuperacion, comentario, foto, dispositivo)
  values
    (v_u.id, v_tel, trim(p_nombre), v_dni, v_rec, trim(p_comentario), p_foto, v_disp);
  return jsonb_build_object('estado', 'enviada');
end;
$$;
revoke execute on function public.taxi_pedir_recuperacion(text, text, text, text, text, text) from public;
grant execute on function public.taxi_pedir_recuperacion(text, text, text, text, text, text) to anon, authenticated;

-- Admin: aceptar (o reenviar) -> código de 30 min al número de
-- recuperación. Devuelve { estado, codigo, telefono, nombre, expira, foto }.
create or replace function public.taxi_admin_aceptar_recuperacion(p_id text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_r      public.peticiones_recuperacion;
  v_u      public.usuarios;
  v_codigo text := public.taxi_codigo_legible();
  v_expira timestamptz := now() + interval '30 minutes';
  v_pin_id uuid;
begin
  if not (public.taxi_es_admin() or (p_token is not null and public.taxi_admin_token_valido(p_token))) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  select * into v_r from public.peticiones_recuperacion where id::text = p_id;
  if not found or v_r.estado not in ('pendiente', 'aceptada') then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  select * into v_u from public.usuarios where id = v_r.usuario_id;

  select id into v_pin_id from public.peticiones_pin where recuperacion_id = v_r.id limit 1;
  if v_pin_id is null then
    insert into public.peticiones_pin
      (nombre, dni, tipo_usuario, estado, telefono, usuario_id, origen, recuperacion_id,
       codigo_hash, codigo_expira)
    values
      (v_r.nombre_completo, v_r.dni, v_u.rol, 'codigo_enviado', v_r.telefono_recuperacion, v_u.id,
       'recuperacion', v_r.id, crypt(v_codigo, gen_salt('bf')), v_expira);
  else
    update public.peticiones_pin
      set estado = 'codigo_enviado', codigo_hash = crypt(v_codigo, gen_salt('bf')), codigo_expira = v_expira,
          reset_token = null, reset_expira = null
      where id = v_pin_id;
  end if;

  update public.peticiones_recuperacion set estado = 'aceptada', foto = null where id = v_r.id;
  return jsonb_build_object(
    'estado', 'ok',
    'codigo', substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4),
    'expira', v_expira,
    'nombre', v_r.nombre_completo,
    'telefono', v_r.telefono_recuperacion,
    'foto', v_r.foto
  );
end;
$$;
revoke execute on function public.taxi_admin_aceptar_recuperacion(text, uuid) from public, anon;
grant execute on function public.taxi_admin_aceptar_recuperacion(text, uuid) to authenticated;

-- Admin: rechazar. Devuelve { estado, foto } (la app borra la foto).
create or replace function public.taxi_admin_rechazar_recuperacion(p_id text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.peticiones_recuperacion;
begin
  if not (public.taxi_es_admin() or (p_token is not null and public.taxi_admin_token_valido(p_token))) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  select * into v_r from public.peticiones_recuperacion where id::text = p_id;
  if not found or v_r.estado not in ('pendiente', 'aceptada') then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  update public.peticiones_recuperacion
    set estado = 'rechazada', resuelta_en = now(), foto = null
    where id = v_r.id;
  update public.peticiones_pin
    set estado = 'resuelto', codigo_hash = null, codigo_expira = null, reset_token = null, reset_expira = null
    where recuperacion_id = v_r.id;
  return jsonb_build_object('estado', 'ok', 'foto', v_r.foto);
end;
$$;
revoke execute on function public.taxi_admin_rechazar_recuperacion(text, uuid) from public, anon;
grant execute on function public.taxi_admin_rechazar_recuperacion(text, uuid) to authenticated;

-- ---------- Elegir el PIN nuevo: la recuperación quita el bloqueo ------------
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
  -- Una cuenta bloqueada solo cambia el PIN por la recuperación.
  if v_p.origen <> 'recuperacion' and exists (select 1 from public.taxi_bloqueos where usuario_id = v_id) then
    return jsonb_build_object('estado', 'bloqueada');
  end if;

  perform public.taxi_guardar_pin(v_id, p_pin);
  update public.peticiones_pin
    set reset_token = null, reset_expira = null, restablecido_en = now(), usuario_id = v_id
    where id = v_p.id;

  select * into v_u from public.usuarios where id = v_id;
  if v_p.origen = 'recuperacion' then
    if exists (select 1 from public.taxi_bloqueos where usuario_id = v_id) then
      delete from public.taxi_bloqueos where usuario_id = v_id;
      perform public.taxi_avisar_bloqueo_caja(v_u, false);
    end if;
    update public.peticiones_recuperacion
      set estado = 'resuelta', resuelta_en = now()
      where id = v_p.recuperacion_id;
  end if;

  -- Sin bloqueo de intentos: puede entrar ya mismo con el PIN nuevo.
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

-- ---------- Foto de la recuperación (bucket privado 'verificaciones') --------
-- Quien no puede entrar no tiene sesión: puede SUBIR (no ver ni pisar)
-- a la carpeta recuperaciones/. Solo el Admin la ve (política existente
-- archivos_ver_verificaciones) y la borra al resolver.
drop policy if exists archivos_subir_recuperacion on storage.objects;
create policy archivos_subir_recuperacion on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'verificaciones' and name like 'recuperaciones/%');

drop policy if exists archivos_borrar_recuperacion on storage.objects;
create policy archivos_borrar_recuperacion on storage.objects for delete to authenticated
  using (bucket_id = 'verificaciones' and name like 'recuperaciones/%' and public.taxi_es_admin());

notify pgrst, 'reload schema';
