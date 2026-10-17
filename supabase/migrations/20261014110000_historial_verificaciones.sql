-- =========================================================================
-- Historial de verificaciones (para investigaciones).
--
-- Cada envío de verificación queda guardado aquí con sus fotos, aunque la
-- cuenta se borre después (temporal vencida, eliminada por el Admin) o la
-- persona reenvíe tras un rechazo. Las fotos viven en el bucket privado
-- 'verificaciones' (nadie las borra salvo el Admin). Solo el Admin lee
-- esta tabla; la llenan los triggers, nunca la app.
--
--   * Conductor: al cargarse o cambiar sus fotos de verificación.
--   * Recolector: al cargarse o cambiar su foto con el DNI.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_verificaciones_historial (
  id           bigserial primary key,
  rol          text not null,
  usuario_id   uuid,
  conductor_id uuid,
  nombre       text,
  telefono     text,
  dni          text,
  ruc          text,
  placa        text,
  fotos        jsonb not null default '{}'::jsonb,
  enviado_at   timestamptz not null default now()
);
create index if not exists taxi_verif_hist_dni on public.taxi_verificaciones_historial (dni);
create index if not exists taxi_verif_hist_telefono on public.taxi_verificaciones_historial (telefono);
create index if not exists taxi_verif_hist_enviado on public.taxi_verificaciones_historial (enviado_at desc);

alter table public.taxi_verificaciones_historial enable row level security;
revoke all on public.taxi_verificaciones_historial from anon, authenticated;
grant select on public.taxi_verificaciones_historial to authenticated;
drop policy if exists verif_hist_admin on public.taxi_verificaciones_historial;
create policy verif_hist_admin on public.taxi_verificaciones_historial for select to authenticated
  using (public.taxi_es_admin());

-- ---------- Conductor --------------------------------------------------------
create or replace function public.fn_historial_verificacion_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.foto_general_url, new.foto_interior_url, new.foto_conductor_dni_url) is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.foto_general_url is not distinct from old.foto_general_url
     and new.foto_interior_url is not distinct from old.foto_interior_url
     and new.foto_conductor_dni_url is not distinct from old.foto_conductor_dni_url then
    return null;
  end if;
  insert into public.taxi_verificaciones_historial (rol, usuario_id, conductor_id, nombre, telefono, dni, placa, fotos)
  values (
    'conductor',
    (select id from public.usuarios where telefono = new.telefono and rol = 'conductor' limit 1),
    new.id, new.nombre, new.telefono, new.dni, new.placa,
    jsonb_strip_nulls(jsonb_build_object(
      'general', new.foto_general_url,
      'interior', new.foto_interior_url,
      'conductor_dni', new.foto_conductor_dni_url,
      'perfil', new.foto_url
    ))
  );
  return null;
end;
$$;

drop trigger if exists trg_historial_verificacion_conductor on public.conductores;
create trigger trg_historial_verificacion_conductor
  after insert or update on public.conductores
  for each row execute function public.fn_historial_verificacion_conductor();

-- ---------- Recolector -------------------------------------------------------
create or replace function public.fn_historial_verificacion_recolector()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol <> 'recolector' or new.foto_dni_url is null
     or (tg_op = 'UPDATE' and new.foto_dni_url is not distinct from old.foto_dni_url) then
    return null;
  end if;
  insert into public.taxi_verificaciones_historial (rol, usuario_id, nombre, telefono, dni, ruc, fotos)
  values (
    'recolector', new.id, trim(coalesce(new.nombre, '') || ' ' || coalesce(new.apellido, '')),
    new.telefono, new.dni, new.ruc,
    jsonb_strip_nulls(jsonb_build_object('dni', new.foto_dni_url, 'perfil', new.foto_url))
  );
  return null;
end;
$$;

drop trigger if exists trg_historial_verificacion_recolector on public.usuarios;
create trigger trg_historial_verificacion_recolector
  after insert or update of foto_dni_url on public.usuarios
  for each row execute function public.fn_historial_verificacion_recolector();

-- ---------- Lo que ya existe (una sola vez) ------------------------------------
insert into public.taxi_verificaciones_historial (rol, usuario_id, conductor_id, nombre, telefono, dni, placa, fotos, enviado_at)
select 'conductor',
       (select u.id from public.usuarios u where u.telefono = c.telefono and u.rol = 'conductor' limit 1),
       c.id, c.nombre, c.telefono, c.dni, c.placa,
       jsonb_strip_nulls(jsonb_build_object(
         'general', c.foto_general_url, 'interior', c.foto_interior_url,
         'conductor_dni', c.foto_conductor_dni_url, 'perfil', c.foto_url
       )),
       c.created_at
from public.conductores c
where coalesce(c.foto_general_url, c.foto_interior_url, c.foto_conductor_dni_url) is not null
  and not exists (select 1 from public.taxi_verificaciones_historial h where h.conductor_id = c.id);

-- Recolectores de antes de la tanda 3d: su foto de verificación quedó como
-- foto de perfil.
insert into public.taxi_verificaciones_historial (rol, usuario_id, nombre, telefono, dni, ruc, fotos, enviado_at)
select 'recolector', u.id, trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')), u.telefono, u.dni, u.ruc,
       jsonb_strip_nulls(jsonb_build_object('dni', u.foto_dni_url, 'perfil', u.foto_url)),
       u.created_at
from public.usuarios u
where u.rol = 'recolector' and coalesce(u.foto_dni_url, u.foto_url) is not null
  and not exists (select 1 from public.taxi_verificaciones_historial h where h.usuario_id = u.id and h.rol = 'recolector');
