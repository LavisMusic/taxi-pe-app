-- Cuentas temporales (Pasajero y Conductor): registro exprés con solo
-- nombre/usuario + teléfono, que arranca a usar la app de una y tiene
-- 7 días para completar su verificación (PIN + datos) antes de borrarse
-- sola. Ver src/lib/taxiEnums.js (ESTADO_VERIFICACION_*) y los hooks
-- usePasajeroAuth.js / useConductorTemporal.js para la lógica que usa
-- estas columnas.
--
-- CÓMO APLICAR ESTE ARCHIVO:
--   1) Supabase Dashboard → SQL Editor → pega todo este archivo → Run.
--      (o `supabase db push` si tienes el proyecto linkeado por CLI)
--   2) La parte de pg_cron (al final) necesita la extensión "pg_cron"
--      habilitada primero: Dashboard → Database → Extensions → busca
--      "pg_cron" → Enable. Si corres este script ANTES de habilitarla,
--      todo lo de arriba se aplica igual; solo el `select cron.schedule`
--      del final falla — vuelve a correr nada más esa última línea
--      después de habilitar la extensión.

alter table usuarios
  add column if not exists nombre_usuario text,
  add column if not exists apellido text,
  add column if not exists edad int,
  add column if not exists sexo text,
  add column if not exists estado_verificacion text not null default 'permanente',
  add column if not exists expira_en timestamptz;

-- Cuentas que ya existían antes de esta migración quedan 'permanente'
-- por el DEFAULT de arriba (no son cuentas temporales a medio llenar,
-- no tiene sentido que un borrado por vencimiento las alcance).

alter table usuarios drop constraint if exists usuarios_estado_verificacion_check;
alter table usuarios
  add constraint usuarios_estado_verificacion_check
  check (estado_verificacion in ('temporal', 'en_revision', 'permanente'));

alter table usuarios drop constraint if exists usuarios_sexo_check;
alter table usuarios
  add constraint usuarios_sexo_check
  check (sexo is null or sexo in ('M', 'F'));

-- DNI y PIN ya nacen en NULL para el alta manual del Admin (ver
-- pinAuth.js) — acá se confirma explícito por si la columna real
-- todavía tuviera NOT NULL de una migración vieja; un ALTER ... DROP
-- NOT NULL sobre una columna que ya admite NULL no falla, es un no-op.
alter table usuarios alter column dni drop not null;
alter table usuarios alter column pin drop not null;

-- Borrado de cuentas temporales vencidas (7 días sin completar
-- verificación). Ojo: solo toca estado_verificacion = 'temporal' — una
-- cuenta 'en_revision' (ya mandó su verificación, espera al Admin)
-- nunca entra acá sin importar `expira_en`, así no hace falta ir
-- extendiendo el plazo a mano mientras el Admin se demora en revisar.
create or replace function borrar_cuentas_temporales_vencidas()
returns void
language sql
as $$
  delete from usuarios
  where estado_verificacion = 'temporal'
    and expira_en is not null
    and expira_en < now();
$$;

-- Requiere la extensión pg_cron habilitada (ver instrucciones arriba).
-- `cron.schedule` es idempotente por nombre de job: si ya existe un job
-- "borrar-cuentas-temporales", esto lo reemplaza en vez de duplicarlo.
select cron.schedule(
  'borrar-cuentas-temporales',
  '0 * * * *', -- cada hora, en punto
  $$select borrar_cuentas_temporales_vencidas()$$
);
