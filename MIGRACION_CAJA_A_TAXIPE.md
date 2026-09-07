# Migrar los datos reales de caja-registradora-tonazo al proyecto de Taxi-PE

Este documento asume que ya corriste
`supabase/migrations/20260907220000_import_caja_schema.sql` en el proyecto
de Taxi-PE (`silfhbdmfdryjdzpwzvh`) y las tablas nuevas ya existen (vacías).
Ahora hay que traer los datos reales del proyecto viejo
(`xaerfywydzwifohjsvwa`) sin perder nada.

No tengo `service_role key` ni contraseña de base de datos de ninguno de los
dos proyectos (solo las `anon key`, que no alcanzan para leer todo sin RLS
ni para conectarse directo a Postgres) — por eso esto queda como una guía
para que la corras tú (o alguien con acceso al Dashboard de ambos
proyectos), no como algo que yo pueda ejecutar desde acá.

## Opción A — Export/Import CSV desde el Dashboard (recomendada, no requiere contraseñas)

Para cada tabla, en el proyecto **viejo**: `Table Editor → (tabla) → botón
"⋯" → Export data → CSV`. Luego en el proyecto **nuevo**: `Table Editor →
(la misma tabla, ya creada por el script) → Insert → Import data from CSV`.

**Orden exacto** (de padres a hijos — respeta las foreign keys; si importas
un hijo antes que su padre, el import falla o queda con esa FK en null):

1. `localidades`
2. `sucursales` (depende de `localidades`)
3. `cajas` (depende de `sucursales`)
4. `categorias`
5. `productos` (depende de `categorias` solo por el nombre de texto, no FK — se puede importar en cualquier orden respecto a `categorias`, pero mejor después por claridad)
6. `inventario_sucursales` (depende de `productos` + `sucursales`)
7. `stock`
8. `proveedores`
9. `gastos` (depende de `proveedores`)
10. `gasto_items` (depende de `gastos`)
11. `clientes_fiado` — **ver aviso especial abajo antes de importar esta**
12. `fiado_items` (depende de `clientes_fiado`)
13. `movimientos_fiado` (depende de `clientes_fiado`)
14. `historial`
15. `comprobantes`
16. `cierres_caja`
17. `pagos_pendientes` (depende de `clientes_fiado`)

`profiles` y `estado_caja` se manejan aparte (ver siguiente sección) — no
son un simple CSV por el tema de `auth.users`.

## Aviso especial: `clientes_fiado.auth_user_id` y `profiles`

`clientes_fiado.auth_user_id` apunta a `auth.users.id` **del proyecto
viejo** — esos UUIDs no existen en el proyecto nuevo (cada proyecto
Supabase tiene su propia tabla `auth.users`, independiente). Si importas el
CSV de `clientes_fiado` tal cual, esa columna va a intentar hacer FK a
usuarios que no existen ahí → falla el import o (si la dejas nullable un
momento) quedan huérfanas.

Dos caminos:

- **Recomendado — recrear las cuentas y remapear:** por cada cliente/cajero
  real (`profiles` del proyecto viejo), volver a crearlo en el proyecto
  nuevo con la Edge Function `create-cliente` ya redeployada ahí (ver
  `EDGE_FUNCTIONS.md` — sección de este mismo repo, o el archivo que
  entregué junto a este). Como no conoces el PIN real de cada cliente para
  volver a crearlo igual, la forma práctica es:
  1. Exportar `profiles` (nombre, role) + `clientes_fiado` (nombre,
     whatsapp, ruc, fecha) del proyecto viejo — SIN `auth_user_id` ni `id`
     de profiles.
  2. Por cada uno, llamar `create-cliente` en el proyecto nuevo (como
     admin, con la función ya redeployada ahí — ver `EDGE_FUNCTIONS_CAJA.md`)
     con `pin` vacío — igual que un alta nueva; el cliente real configurará
     su PIN la primera vez que entre (mismo flujo de "Crea tu PIN" que ya
     usa la app).
  3. Actualizar `clientes_fiado.id` en tus CSVs de `fiado_items` /
     `movimientos_fiado` / `pagos_pendientes` / `historial` (donde
     aplique) para que apunten al **nuevo** `clientes_fiado.id` generado,
     no al viejo — vas a necesitar una tabla de mapeo (viejo id → nuevo id)
     mientras haces esto, por ejemplo una hoja de cálculo.
- **Más simple pero con costo real:** importar `clientes_fiado` con
  `auth_user_id = NULL` para todas las filas (perdiendo el login de esos
  clientes) y dejar que cada cliente vuelva a registrarse desde cero en la
  tienda nueva — su historial de fiado queda igual visible para el
  admin/cajero (por nombre), pero el cliente no podrá loguearse con su
  cuenta vieja hasta que se le cree una nueva y alguien re-vincule
  `auth_user_id` a mano.

Cualquiera de los dos caminos es manual — avísame cuál prefieres y te
detallo los pasos exactos (o te preparo la Edge Function/script concreto)
una vez que confirmes.

## Verificación después de cada tabla

Corre esto en el SQL Editor de **ambos** proyectos y compara los conteos
(deben coincidir, salvo `clientes_fiado`/`profiles` si tomaste el camino
"más simple" de arriba):

```sql
select 'localidades' as tabla, count(*) from public.localidades
union all select 'sucursales', count(*) from public.sucursales
union all select 'cajas', count(*) from public.cajas
union all select 'categorias', count(*) from public.categorias
union all select 'productos', count(*) from public.productos
union all select 'inventario_sucursales', count(*) from public.inventario_sucursales
union all select 'stock', count(*) from public.stock
union all select 'proveedores', count(*) from public.proveedores
union all select 'gastos', count(*) from public.gastos
union all select 'gasto_items', count(*) from public.gasto_items
union all select 'clientes_fiado', count(*) from public.clientes_fiado
union all select 'fiado_items', count(*) from public.fiado_items
union all select 'movimientos_fiado', count(*) from public.movimientos_fiado
union all select 'historial', count(*) from public.historial
union all select 'comprobantes', count(*) from public.comprobantes
union all select 'cierres_caja', count(*) from public.cierres_caja
union all select 'pagos_pendientes', count(*) from public.pagos_pendientes;
```

## Opción B — pg_dump/psql (más rápida, requiere las contraseñas de ambos proyectos)

Si tienes las contraseñas de base de datos de ambos proyectos (Dashboard →
Project Settings → Database → Connection string), desde tu propia máquina
(yo no tengo estas contraseñas y no debo pedírtelas):

```bash
# 1) Dump solo de los DATOS (no del schema, que ya lo creó el .sql) de las
#    tablas de caja-registradora, en orden de dependencia:
pg_dump "postgresql://postgres:CONTRASEÑA_VIEJA@db.xaerfywydzwifohjsvwa.supabase.co:5432/postgres" \
  --data-only --disable-triggers \
  -t public.localidades -t public.sucursales -t public.cajas \
  -t public.categorias -t public.productos -t public.inventario_sucursales -t public.stock \
  -t public.proveedores -t public.gastos -t public.gasto_items \
  -t public.clientes_fiado -t public.fiado_items -t public.movimientos_fiado \
  -t public.historial -t public.comprobantes -t public.cierres_caja -t public.pagos_pendientes \
  > caja_data.sql

# 2) Restaurar en el proyecto nuevo:
psql "postgresql://postgres:CONTRASEÑA_NUEVA@db.silfhbdmfdryjdzpwzvh.supabase.co:5432/postgres" \
  -f caja_data.sql
```

`--disable-triggers` evita que los triggers (como `on_profile_deleted`) se
disparen durante la carga masiva. El problema de `clientes_fiado.auth_user_id`
de la sección anterior sigue existiendo igual con este método — hay que
resolverlo antes de correr el dump de esa tabla puntual (o excluirla del
dump y hacerla aparte con el camino manual).

## Después de migrar los datos

1. Confirma los conteos de la sección "Verificación" arriba.
2. Prueba login de un cliente/cajero real contra el proyecto nuevo (con las
   Edge Functions ya redeployadas, ver el otro archivo que te entregué).
3. Abre `caja-app` en local (`npm run dev` dentro de `caja-app/`, ya
   apuntando al proyecto nuevo vía `.env`) y confirma que el catálogo
   público carga productos reales, no una lista vacía.
4. Recién ahí seguimos con la Fase 1 (carrito + Gestor de Pedidos + chat).
