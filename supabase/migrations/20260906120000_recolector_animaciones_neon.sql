-- Bienvenida en 3 partes para Recolector (pedido: "la misma lógica que
-- tiene conductor") — hasta ahora Recolector solo tenía la bienvenida
-- vieja de "paquete destacado", sin "Membresía Activada" ni "Compra
-- Confirmada" reales (ver RecolectorPage.jsx / useRecargasRecolector.js).
-- Estas columnas son el equivalente exacto de las que ya tiene
-- `conductores` (ver migración de compra de créditos anterior) pero
-- del lado de `usuarios`, porque Recolector no tiene una tabla
-- operativa aparte — su saldo (creditos_disponibles/membresia_vencimiento)
-- ya vive directo en `usuarios`.
-- Error real visto al correr esto: "foreign key constraint ...
-- cannot be implemented ... incompatible types: bigint and uuid" —
-- `paquetes_recolectores.id` es UUID, no bigint. Dos ajustes:
--   1) `membresia_paquete_id` en `uuid` (no `bigint`), para que de
--      verdad pueda guardar un `paquetes_recolectores.id` real.
--   2) Sin "references paquetes_recolectores(id)" — el resto de esta
--      app ya vincula tablas por campos sueltos (teléfono, no FKs
--      reales), no hace falta forzar la referencia acá tampoco. Bug
--      real de la vuelta anterior: al fallar este ALTER, el SQL
--      Editor corre el script pegado como una sola transacción, así
--      que NINGUNA columna llegó a crearse — pero el frontend ya
--      esperaba estas columnas igual, así que el SELECT de
--      useUsuarios.js se rompía ENTERO y vaciaba `usuarios` de raíz:
--      eso fue lo que hizo "desaparecer" créditos Y recolectores
--      enteros del Directorio del Admin, ambos alimentados por ese
--      mismo hook.
alter table usuarios
  add column if not exists membresia_paquete_id uuid,
  add column if not exists ultimo_paquete_creditos_nombre text,
  add column if not exists ultimo_paquete_creditos_descripcion text,
  add column if not exists ultima_compra_creditos_at timestamptz;

-- La petición de recarga ya guardaba `paquete_nombre` (copiado del
-- paquete al crearla, para que un paquete editado/borrado después no
-- cambie lo que ya se vendió) — le falta `paquete_descripcion` para
-- poder mostrar la animación "Membresía Activada"/"Compra Confirmada"
-- con el mismo texto real del paquete en el momento de la venta.
alter table peticiones_recarga_recolector
  add column if not exists paquete_descripcion text;
