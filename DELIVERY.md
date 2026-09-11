# Delivery Caja Tonazo ↔ Taxi-PE (repartidores)

Servicio de reparto: un pedido de la tienda virtual de **Caja Tonazo** lo entrega
un **conductor verificado de Taxi-PE** actuando como repartidor. Sesión en vivo
(mapa + chat + GPS) compartida entre 3 actores, con confirmación por QR/PIN.

> Reemplaza al evento webhook 3.2 (`caja.pedido_delivery`) de [WEBHOOKS.md](WEBHOOKS.md).
> Los eventos 3.1 (cargo de fiado) y 3.3 (pago de fiado) siguen igual.

---

## 1. Actores

| Actor | App que usa | Rol |
| ----- | ----------- | --- |
| **Cliente final** | Caja Tonazo (usuario registrado) | Pide, sigue el mapa, chatea, confirma con su QR/PIN |
| **Admin / Cajero** | Caja Tonazo | Asigna repartidor, chatea, cancela, cobra el retiro |
| **Repartidor** | Taxi-PE (conductor **verificado**) | Acepta/rechaza, retira y paga en la Caja, entrega, finaliza con QR/PIN |

Solo conductores con `estado_verificacion = 'permanente'` pueden aparecer en el
radar del cajero. Se excluyen `temporal` y `en_revision`.

---

## 2. Arquitectura

Supabase Realtime no cruza proyectos → **toda la sesión de entrega vive en el
proyecto Supabase de Taxi-PE** (`silfhbdmfdryjdzpwzvh`), reutilizando su
infraestructura: radar (`RadarGlobal`), mapa (`MapaViaje`), chat
(`useChatMensajes`), GPS (`useGpsBroadcaster`), tabla `conductores`.

La app de **Caja Tonazo abre un segundo cliente Supabase apuntando a Taxi-PE**
(URL + anon key de Taxi-PE). El acceso a los datos de la entrega **no usa RLS por
usuario ni JWT** (el proyecto migró a llaves de firma asimétricas y no se puede
autofirmar un token confiable): las tablas `entrega*` quedan **cerradas** (RLS
ON, sin políticas) y todo pasa por **RPCs `security definer`** que reciben el
`session_token` de la entrega (cajero/cliente) o el `conductor_id` (repartidor)
como parámetro y validan contra la fila. El chat y el estado en vivo van por
**Realtime Broadcast** en el canal `entrega-<id>` (igual que los viajes:
`useChatMensajes` / `useGpsBroadcaster`), con la tabla como persistencia/historial.

```
Caja Tonazo (app)                         Taxi-PE (Supabase silfhbdmfdryjdzpwzvh)
─────────────────                         ──────────────────────────────────────
  "Asignar repartidor"
        │  POST /functions/v1/entrega-crear  (firma HMAC, ver WEBHOOKS.md §2)
        ├────────────────────────────────►  crea fila en `entregas`
        │                                   genera PIN + session_token
        │  ◄── { entrega_id, session_token, pin, qr_payload }
        │
  cliente Supabase #2 → Taxi-PE (URL + anon key de Taxi-PE)
        │
        ├─ radar de conductores en línea + verificados (broadcast público, ya existe)
        ├─ subscribe Broadcast canal `entrega-<id>`  (chat + estado en vivo)
        └─ RPCs: rpc_entrega_estado / _ofertar / _cancelar / _mensaje_nuevo
                 (pasando session_token)
```

El repartidor opera desde la app Taxi-PE (anon key) llamando a los RPCs
`rpc_entrega_*` con su `conductor_id`.

### Handshake — `entrega-crear` (Edge Function en Taxi-PE)

- Auth: **HMAC** (misma que los webhooks, `WEBHOOK_SECRET_CAJA_TO_TAXI`).
- Sobre: `event_type = "caja.entrega_crear"`, `data.pedido = { caja_pedido_ref,
  sucursal, cliente_nombre, cliente_telefono, direccion_entrega, entrega_lat,
  entrega_lng, items, total }`.
- Hace: `insert into entregas (...)` con `estado='buscando'`, PIN aleatorio de
  6 dígitos, `session_token`.
- Devuelve: `{ entrega_id, session_token, pin, qr_payload }`.
  - `session_token` (uuid): la app de Caja lo guarda y lo pasa como parámetro a
    los RPCs `rpc_entrega_*`. Es el "secreto" que autoriza a cajero + cliente
    sobre esa entrega.
  - `qr_payload` = el PIN tal cual (el QR codifica el PIN, ver §6).

**Secrets que necesita la function**: solo `WEBHOOK_SECRET_CAJA_TO_TAXI` (ya está
de los webhooks). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` son automáticos.
**No hace falta JWT secret.**

---

## 3. Modelo de datos (Taxi-PE)

```sql
create table public.entregas (
  id                uuid primary key default gen_random_uuid(),
  session_token     uuid not null unique default gen_random_uuid(),

  -- origen (Caja Tonazo)
  caja_sucursal     text,
  caja_pedido_ref   text,                 -- id del pedido en la Caja

  -- cliente final
  cliente_nombre    text,
  cliente_telefono  text,
  direccion_entrega text,
  entrega_lat       numeric,
  entrega_lng       numeric,

  -- pedido (referencia visual, la plata la maneja la Caja)
  items             jsonb not null default '[]'::jsonb,
  total             numeric,

  -- asignación (oferta a VARIOS conductores a la vez; toma el primero que acepta)
  conductor_id      uuid references public.conductores(id),   -- se setea al aceptar

  -- confirmación
  pin               text not null,

  estado text not null default 'buscando' check (estado in (
    'buscando',      -- radar abierto; puede haber ofertas pendientes en entrega_ofertas
    'aceptado',      -- un conductor aceptó, va a la Caja a retirar
    'retirado',      -- pagó y retiró en la Caja (cuenta como venta del día)
    'en_ruta',       -- rumbo al cliente
    'entregado',     -- QR/PIN validado por el repartidor
    'cancelado',     -- por cajero o cliente (antes de retirar)
    'no_entregado'   -- cliente no apareció; devolución la cierra el admin
  )),

  creado_at         timestamptz not null default now(),
  actualizado_at    timestamptz not null default now(),
  aceptado_at       timestamptz,
  retirado_at       timestamptz,
  entregado_at      timestamptz,
  cerrado_at        timestamptz
);

-- Oferta a varios conductores a la vez. El cajero toca conductores en el radar
-- → una fila 'pendiente' por cada uno. El primero que acepta gana (transacción:
-- sólo si entregas.conductor_id sigue null); al resto su oferta pasa a 'cerrada'.
-- No hay timeout: la oferta queda viva hasta que el conductor la rechaza o el
-- admin cancela el pedido.
create table public.entrega_ofertas (
  id           uuid primary key default gen_random_uuid(),
  entrega_id   uuid not null references public.entregas(id) on delete cascade,
  conductor_id uuid not null references public.conductores(id),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','aceptada','rechazada','cerrada')),
  created_at   timestamptz not null default now(),
  resuelta_at  timestamptz,
  unique (entrega_id, conductor_id)
);

-- Chat: hilos independientes por par de actores (el cliente habla con cada uno
-- por separado; cajero y repartidor tienen su propio hilo — confirmado).
create table public.entrega_mensajes (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references public.entregas(id) on delete cascade,
  hilo        text not null check (hilo in ('cliente_cajero','cliente_conductor','cajero_conductor')),
  emisor_rol  text not null check (emisor_rol in ('cliente','cajero','conductor','sistema')),
  mensaje     text not null,
  leido       boolean not null default false,
  created_at  timestamptz not null default now()
);
```

RLS: las 3 tablas con **RLS ON y sin políticas** — nadie las toca con la anon
key. Todo el acceso pasa por RPCs `security definer`:
- cajero/cliente: `rpc_entrega_estado / _ofertar / _cancelar / _mensajes /
  _mensaje_nuevo`, pasando `session_token`.
- repartidor: `rpc_entrega_ofertas_conductor / _aceptar / _rechazar / _avanzar /
  _finalizar / _activa_conductor`, pasando `conductor_id`.
- admin: `rpc_entrega_no_entregado`.

Chat + estado en vivo: **Realtime Broadcast** en el canal `entrega-<id>` (los
RPCs son persistencia/historial). GPS del repartidor: se reusa el broadcast de
`useGpsBroadcaster`; el mapa lee la posición del `conductor_id` asignado.

Ranking: `entregas` con `estado='entregado'` y `entregado_at >= now() - interval
'7 days'` (últimos 7 días corridos), agrupado por `conductor_id`, **contando
filas** (no plata).

---

## 4. Ciclo de vida

```
buscando ──(cajero ofrece a 1..N conductores en el radar → entrega_ofertas)──┐
   ▲                                                                          │
   │  (todos rechazan / el cajero suma más)                                   │
   └──────────────────────────────────────────────────────────────────────────┤
                                            (1er conductor acepta; resto → 'cerrada')
                                            ▼
                                         aceptado ──► retirado ──► en_ruta ──► entregado
                                            │            │           │
              (cancela cajero/cliente) ◄────┴────────────┘           │
                        cancelado                                    │
                                                                     ▼
                                        (cliente no apareció → repartidor avisa
                                         → ADMIN cierra) ──► no_entregado
```

- **Oferta a varios**: el cajero toca conductores en el radar; cada toque crea una
  `entrega_ofertas` `pendiente`. **Sin timeout** — la oferta vive hasta que ese
  conductor la rechaza o el admin cancela el pedido. El **primero que acepta**
  gana (transacción: solo si `entregas.conductor_id` sigue null); al resto la
  oferta les pasa a `cerrada`.
- **Cancelar** (`cancelado`): botón para cajero/admin **y** cliente, **solo antes
  de `retirado`**. Vive dentro del modal del mapa, misma posición que "Cancelar
  viaje" del rol pasajero en Taxi-PE.
- **Rechazo del repartidor**: su `entrega_ofertas` pasa a `rechazada`; si no queda
  ninguna `pendiente` ni aceptada, la entrega sigue `buscando` y el cajero ofrece
  a otros.
- **Finalizar** (`entregado`): **solo el repartidor**, escaneando el QR del
  cliente o tecleando el PIN (input fallback). Compara contra `entregas.pin`.
- **No-show** (`no_entregado`): el repartidor avisa por chat; **solo el admin**
  lo cierra. Es una devolución — ver §5.

---

## 5. Plata

- El repartidor **paga a la Caja como quiera** al retirar el pedido. Para la Caja
  es **una venta más del día** (fila normal en `historial`/`ventas`, la registra
  el cajero — no pasa por Taxi-PE).
- El sistema **no** trackea tarifa de envío ni descuenta créditos: el margen del
  repartidor es entre él y el cliente final.
- **Devolución (no-show)**: el repartidor devuelve el pedido a la Caja; el admin
  cancela → se revierte esa venta del día (flujo de anulación que ya existe en la
  Caja). En Taxi-PE la entrega queda `no_entregado` y **no** suma al ranking.

---

## 6. QR / PIN / WhatsApp

- Al asignar el repartidor, Taxi-PE genera un **PIN de 6 dígitos**. El **QR
  codifica ese mismo PIN** (texto plano).
- **El repartidor finaliza con el QR** (escáner de cámara, `jsqr`). El input de
  PIN es respaldo: aparece solo tras **3 intentos de QR fallidos** (timeout sin
  leer, o QR cuyo PIN no coincide), o de inmediato si no hay cámara / se niega el
  permiso. No hay botón de "voy en camino": la entrega pasa a `en_ruta` sola al
  marcar **"Pedido recogido y pagado"**.
- El cajero recibe, junto a los **botones verdes** que hoy sirven para "enviar
  boleta en imagen copiándola", dos variantes nuevas:
  1. **Copiar QR** — copia el QR como imagen (para pegar en el chat de WhatsApp).
  2. **Copiar PIN** — copia el PIN como texto (para mandarlo como mensaje).
- El cajero manda ambos al cliente por WhatsApp (`wa.me`, mismo patrón actual).
  El PIN va como texto **para que el cliente lo pueda leer directo si el QR no
  escanea**.
- El cliente le muestra el QR al repartidor; si no escanea, le dicta el PIN.

Librería de QR en el front: agregar `qrcode` (npm) — genera el PNG/dataURL que se
copia al portapapeles. (Es la app real, no un artifact — sin restricción de CSP.)

---

## 7. UI

### Caja Tonazo — Cajero/Admin
- **Gestor de Pedidos** → botón **"Asignar repartidor"** → abre modal de
  **radar/mapa** (mismo diseño que el flujo pasajero→conductor de Taxi-PE), con
  solo conductores **en línea + verificados**.
- Al asignar: se abre el modal del mapa con el chat. Botón **Cancelar pedido**
  dentro del modal del mapa. Puede chatear por separado con cliente y con
  repartidor (hilos `cliente_cajero` y `cajero_conductor`).
- Botones verdes → **Copiar QR** / **Copiar PIN** (§6).

### Caja Tonazo — Cliente final
- **Nuevo desplegable** reutilizando el diseño de los desplegables laterales
  (izquierdo/derecho) que ya existen en la app. Dentro: los chats **sucursal
  (admin/cajero)** y **repartidor** agrupados; puede hablar con cada uno
  independiente.
- Puede abrir el **mapa** (mismo componente que ven cajero y repartidor).
- Botón **Cancelar pedido** dentro del modal del mapa (posición idéntica a
  "Cancelar viaje" del pasajero en Taxi-PE).

### Taxi-PE — Repartidor
- Bandeja de **Entregas**: ofertas pendientes con **Aceptar / Rechazar**. Cada
  oferta muestra **nombre del cliente, dirección, sucursal y total** (todo visible
  antes de aceptar).
- Entrega activa: mapa + chats (con cliente y con cajero) + botón **Finalizar**
  → escáner de QR (reusar patrón de `ComprobanteScannerModal`) o input de PIN.

### Taxi-PE — Admin
- (Opcional) lista de entregas para registrar/auditar.
- Cierre de **no-show** (`no_entregado`).

### Taxi-PE — Usuario Estrella
- Cuarta pestaña **"Repartidor"** en `UsuarioEstrellaChip` (junto a Conductor /
  Pasajero / Recolector).
- Ordena por **cantidad de entregas concretadas (`entregado`), semanal**.
- `buildTopRanking` en `src/lib/ranking.js` gana un array `repartidores` contando
  filas de `entregas`.

---

## 8. Plan por fases

| # | Fase | Dónde | Entregable |
|---|------|-------|-----------|
| 1 ✅ | **Núcleo de sesión** | Taxi-PE (SQL + Edge Fn) | `20260908150000_delivery_core.sql` (tablas + RLS cerrada + RPCs de dominio + chat + ranking), Edge Function `entrega-crear`. Baja del webhook 3.2. **Pendiente: aplicar migración + deploy `entrega-crear --no-verify-jwt`.** |
| 2 ✅ | **Repartidor UX** | Taxi-PE (app) | `useEntregasRepartidor` + `useEntregaChat`; `EntregasRepartidorPanel` (bandeja en ConductorPage, solo si `conductor.aprobado`); `EntregaActivaModal` (flujo aceptado→en_ruta→entregado, chat cliente/sucursal); `EscanerQrModal` (`jsqr`) — QR primero, PIN de respaldo tras 3 fallos o sin cámara. Migración `20260908160000_delivery_ajustes.sql` (sin paso manual "en camino"). **Fase 2b pendiente:** mapa en vivo con GPS de los 3 actores (hoy: link "Abrir en Google Maps") — se hace junto con la Fase 3. |
| 3 ✅ | **Puente Caja** | Taxi-PE + Caja | **Taxi-PE:** `rpc_conductores_para_reparto()` (migración `20260908170000`), `useEntregaGpsBroadcaster` (repartidor emite GPS en `entrega-<id>`), `MapaEntrega` (mapa en vivo, montado en `EntregaActivaModal`). **Caja:** `lib/supabaseTaxi.js` (2º cliente), Edge Function `entrega-iniciar` (cajero-auth → HMAC → `entrega-crear`), `useEntregaCaja` (estado/chat/ofertar/cancelar), `useRadarReparto` (radar), migración `0056_delivery_puente.sql` (baja emisor 3.2 + columnas `pedidos.entrega_*`). |
| 4a ✅ | **Caja UX — cajero** | Caja (app) | deps `leaflet`/`react-leaflet`/`qrcode`; `lib/mapboxConfig.js` (tiles oscuros = Taxi-PE); `lib/entregaIniciar.js` (llama a `entrega-iniciar`); `MapaEntregaCaja` (mapa en vivo vía `supabaseTaxi`); `EntregaCajaModal` (radar → ofrecer a repartidores → vista en vivo: mapa + chats cliente/repartidor + Cancelar + **Copiar QR** / **Copiar PIN** por WhatsApp + "no entregó" del admin); `usePedidos` mapea columnas `entrega_*`; botón **"Asignar repartidor" / "Ver entrega"** por pedido en `GestorPedidosModal`. |
| 4b ✅ | **Caja UX — cliente** | Caja (app) | Cliente ve el mismo `EntregaCajaModal` (`rol="cliente"`) en Mis Pedidos (mapa + chats sucursal/repartidor + cancelar); `MapPicker` (Leaflet) en el checkout en vez del `prompt` (punto B → `pedidos.entrega_lat/lng`); coords de sucursal (punto A) en el Gestor de Cajas → `sucursales.lat/lng`. |
| 5 ✅ | **Plata + no-show + cancelación** | Taxi-PE + Caja | **Taxi-PE:** `20260910140000_avisar_caja_min.sql` (`rpc_entrega_avanzar` avisa a la Caja en `en_ruta` + `fn_entrega_avisar_caja` tolerante a fallos), `20260910150000_avisar_caja_cierres.sql` (avisos en entregado/no_entregado/cancelado), `20260910160000_entrega_forzar_cancel.sql` (`rpc_entrega_forzar_cancelacion` — cierra desde cualquier estado) + Edge Function `webhook-caja-entrega-cancelar`. **Caja:** `0065_pedido_cancelar_a_taxi.sql` — trigger en `pedidos` que emite `caja.entrega_cancelar` cuando un pedido con `entrega_id` pasa a `cancelado` (cliente o cajero). **Caja:** `0064_pedidos_entrega_estado.sql` (`pedidos.entrega_estado` + `venta_revertida`); webhook `webhook-taxi-entrega-estado` maneja `en_ruta`; `GestorPedidosModal` botón **"Confirmar recojo y cobro"** (registra la venta del día con correlativo `V-000X`, `0063_correlativo_venta.sql`) al recibir `en_ruta`/`entregado` sin cobrar; devolución por no-show → `revertirVenta` en App.jsx (repone stock + borra `historial`) disparado desde el Gestor. Refresh de historial/stock/métricas vía `onVentaRegistrada` (App re-carga; antes solo cargaba al montar). |
| 6 ✅ | **Ranking** | Taxi-PE (app) | `useRankingRepartidores` (llama a `rpc_ranking_repartidores`), `buildTopRanking` pasa `repartidores`, 4ª pestaña **"Repartidor"** en `UsuarioEstrellaChip` (entregas `entregado` últimos 7 días). |
| 7 ✅ | **Boleta** | Caja (app) | `TicketBoleta` acepta `sede` + `entrega` ({repartidor, direccion}) + `totales.efectivoRecibido/vuelto`. `MisPedidosModal` / `GestorPedidosModal` cargan repartidor+sede+dirección desde `rpc_entrega_estado` (vía `supabaseTaxi`) antes de rasterizar; `PedidoCheckoutModal` muestra sede + efectivo/vuelto + dirección (repartidor "Por asignar"). |

---

## 9. Decisiones tomadas

1. **Ranking semanal** = últimos **7 días corridos** (`now() - interval '7 days'`).
2. **Antes de aceptar** el repartidor ve **nombre, dirección, sucursal y total**.
3. **Hilo `cajero_conductor`**: sí, va.
4. **Sin timeout** de oferta: vive hasta que el conductor la rechaza o el admin
   cancela el pedido.
5. **Oferta a varios** conductores a la vez; gana el **primero que acepta**
   (`entrega_ofertas`).
6. **Sin JWT** (el proyecto usa llaves asimétricas): el acceso de cajero/cliente
   va por `session_token` pasado a RPCs `security definer`. El token no vence;
   deja de servir cuando la entrega se cierra.
7. **Cobro del repartidor** = lo registra el **cajero** con un botón en el Gestor
   ("Confirmar recojo y cobro"), habilitado cuando la entrega llega a `en_ruta`
   (el repartidor recogió y pagó en el mostrador). Es una venta normal del día
   con correlativo `V-000X`. No se registra al confirmar la entrega final.
8. **Cancelación con venta ya registrada** (no-show del repartidor, o
   cancela el cliente / el cajero) → el Gestor **revierte automáticamente**
   la venta del día (repone stock + borra `historial`, misma lógica que
   "Anular venta"), marca `pedidos.venta_revertida` y avisa por el chat.
   El cliente puede cancelar en `nuevo`/`en_atencion`; si ya había venta,
   el stock se repone la próxima vez que un admin/cajero abre el Gestor.
9. **Multi-oferta**: un repartidor puede tener **varias entregas
   `aceptado`** a la vez (sin recogerlas todavía). Apenas UNA llega a
   `en_ruta` (recogió y pagó esa), deja de recibir ofertas nuevas —
   `rpc_conductores_para_reparto()` lo excluye y `rpc_entrega_aceptar`
   rechaza cualquier intento (`status: 'conductor_en_ruta'`) — hasta que
   la cierre (entregado/no_entregado). `rpc_entrega_activa_conductor`
   devuelve TODAS sus entregas activas, no solo la última.
