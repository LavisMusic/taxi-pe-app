-- =========================================================================
-- Avisos al celular del ADMIN aunque tenga el panel cerrado (Web Push), y
-- umbral de reportes.
--
--   * push_suscripciones_admin: dispositivos del admin (el admin maestro no
--     tiene fila en usuarios, por eso va aparte). Se guardan con
--     taxi_push_suscribir_admin() al prender "Con notificación" en Ajustes.
--   * push_admin_pendientes: cola de avisos para el admin. La llenan los
--     triggers de abajo y la vacía push-enviar (la base la llama al toque).
--     push-enviar solo manda si el admin tiene "Con notificación" encendido
--     (guia_don_peje / taxi_guia_extra → ajustes.avisoNotificacion).
--   * Avisa: petición de PIN, recuperación de cuenta, recarga de conductor
--     o de recolector, conductor o recolector nuevo por revisar, y reporte
--     nuevo. Con umbral (taxi_plataforma_ajustes.umbral_reportes > 0), al
--     llegar alguien EXACTAMENTE a ese número de reportes, otro aviso.
--   * taxi_reportados_sobre_umbral(): quiénes están en el umbral o más (la
--     marca en el panel del admin).
--
-- Ningún aviso puede frenar el registro que lo dispara (todo con
-- exception). Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.push_suscripciones_admin (
  id         uuid primary key default gen_random_uuid(),
  uid        uuid not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_suscripciones_admin enable row level security;
revoke all on public.push_suscripciones_admin from anon, authenticated;

create or replace function public.taxi_push_suscribir_admin(p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi_es_admin() then
    return false;
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return false;
  end if;
  insert into public.push_suscripciones_admin (uid, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth;
  return true;
end;
$$;
revoke execute on function public.taxi_push_suscribir_admin(text, text, text) from public, anon;
grant execute on function public.taxi_push_suscribir_admin(text, text, text) to authenticated;

create table if not exists public.push_admin_pendientes (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  cuerpo     text not null,
  ruta       text not null default '/admin',
  tag        text,
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);
create index if not exists push_admin_pendientes_cola_idx on public.push_admin_pendientes (created_at) where enviado_at is null;
alter table public.push_admin_pendientes enable row level security;
revoke all on public.push_admin_pendientes from anon, authenticated;

create or replace function public.taxi__aviso_admin(p_titulo text, p_cuerpo text, p_tag text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_admin_pendientes (titulo, cuerpo, tag)
  values (left(p_titulo, 120), left(p_cuerpo, 200), p_tag);
  perform public.taxi_push_disparar();
exception when others then
  raise warning 'taxi__aviso_admin: %', sqlerrm;
end;
$$;
revoke execute on function public.taxi__aviso_admin(text, text, text) from public, anon, authenticated;

-- ---------- Peticiones ------------------------------------------------------
create or replace function public.fn_aviso_admin_peticion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titulo text;
  v_cuerpo text;
begin
  begin
    if TG_TABLE_NAME = 'peticiones_pin' then
      v_titulo := 'Petición de PIN';
      v_cuerpo := coalesce(NEW.nombre, 'Alguien') || ' pide un código para su PIN.';
    elsif TG_TABLE_NAME = 'peticiones_recuperacion' then
      v_titulo := 'Recuperación de cuenta';
      v_cuerpo := coalesce(NEW.nombre_completo, 'Alguien') || ' pide recuperar su cuenta.';
    elsif TG_TABLE_NAME = 'peticiones_recarga_conductor' then
      v_titulo := 'Pago de conductor por revisar';
      v_cuerpo := coalesce(NEW.paquete_nombre, 'Recarga') || ' · S/ ' || coalesce(NEW.monto::text, '0') || ' por ' || coalesce(NEW.metodo_pago, 'pago') || '.';
    elsif TG_TABLE_NAME = 'peticiones_recarga_recolector' then
      v_titulo := 'Pago de recolector por revisar';
      v_cuerpo := coalesce(NEW.paquete_nombre, 'Recarga') || ' · S/ ' || coalesce(NEW.monto::text, '0') || ' por ' || coalesce(NEW.metodo_pago, 'pago') || '.';
    elsif TG_TABLE_NAME = 'conductores' then
      if coalesce(NEW.aprobado, false) then return NEW; end if;
      v_titulo := 'Conductor nuevo por revisar';
      v_cuerpo := coalesce(NEW.nombre, 'Un conductor') || ' se registró y espera tu aprobación.';
    elsif TG_TABLE_NAME = 'usuarios' then
      if NEW.rol is distinct from 'recolector' or coalesce(NEW.estado_cuenta, '') <> 'pendiente' then return NEW; end if;
      v_titulo := 'Recolector nuevo por revisar';
      v_cuerpo := coalesce(NEW.nombre, 'Un recolector') || ' se registró y espera tu aprobación.';
    else
      return NEW;
    end if;
    perform public.taxi__aviso_admin(v_titulo, v_cuerpo || ' Revísalo en Peticiones.', 'peticion-' || TG_TABLE_NAME || '-' || NEW.id::text);
  exception when others then
    raise warning 'fn_aviso_admin_peticion: %', sqlerrm;
  end;
  return NEW;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['peticiones_pin', 'peticiones_recuperacion', 'peticiones_recarga_conductor',
                           'peticiones_recarga_recolector', 'conductores', 'usuarios'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_aviso_admin_peticion on public.%I', t);
      execute format('create trigger trg_aviso_admin_peticion after insert on public.%I
                        for each row execute function public.fn_aviso_admin_peticion()', t);
    end if;
  end loop;
end $$;

-- ---------- Reportes y umbral ---------------------------------------------
create or replace function public.fn_aviso_admin_reporte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_umbral int;
  v_total int;
  v_nombre text;
begin
  begin
    perform public.taxi__aviso_admin(
      'Nuevo reporte',
      coalesce(NEW.autor_nombre, 'Alguien') || ' reportó a un ' || NEW.reportado_tipo || ': ' || NEW.motivo || '.',
      'reporte-' || NEW.id::text
    );
    select umbral_reportes into v_umbral from public.taxi_plataforma_ajustes where id = 1;
    if coalesce(v_umbral, 0) > 0 then
      select count(*) into v_total from public.taxi_reportes
       where reportado_tipo = NEW.reportado_tipo and reportado_id = NEW.reportado_id and estado <> 'descartado';
      if v_total = v_umbral then
        if NEW.reportado_tipo = 'conductor' then
          select nombre into v_nombre from public.conductores where id = NEW.reportado_id;
        else
          select nombre into v_nombre from public.usuarios where id = NEW.reportado_id;
        end if;
        perform public.taxi__aviso_admin(
          '⚠️ Llegó al límite de reportes',
          coalesce(v_nombre, 'Un ' || NEW.reportado_tipo) || ' (' || NEW.reportado_tipo || ') ya tiene ' || v_total || ' reportes.',
          'umbral-' || NEW.reportado_tipo || '-' || NEW.reportado_id::text
        );
      end if;
    end if;
  exception when others then
    raise warning 'fn_aviso_admin_reporte: %', sqlerrm;
  end;
  return NEW;
end;
$$;
drop trigger if exists trg_aviso_admin_reporte on public.taxi_reportes;
create trigger trg_aviso_admin_reporte after insert on public.taxi_reportes
  for each row execute function public.fn_aviso_admin_reporte();

-- Quiénes están en el umbral o más (marca en el panel). Vacío si no hay umbral.
create or replace function public.taxi_reportados_sobre_umbral()
returns table (reportado_tipo text, reportado_id uuid, total int)
language sql
stable
security definer
set search_path = public
as $$
  select r.reportado_tipo, r.reportado_id, count(*)::int as total
    from public.taxi_reportes r
   where public.taxi__admin_o_puente()
     and r.estado <> 'descartado'
   group by r.reportado_tipo, r.reportado_id
  having count(*) >= (select nullif(umbral_reportes, 0) from public.taxi_plataforma_ajustes where id = 1);
$$;
revoke execute on function public.taxi_reportados_sobre_umbral() from public, anon;
grant execute on function public.taxi_reportados_sobre_umbral() to authenticated, service_role;

notify pgrst, 'reload schema';
