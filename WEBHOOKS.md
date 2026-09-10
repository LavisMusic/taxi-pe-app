# Comunicación Taxi-PE ↔ Caja-Registradora (webhooks)

Dos proyectos Supabase **separados**, cada uno con su `.env` y su backend:

| App          | Proyecto Supabase        | Repo                                   |
| ------------ | ------------------------ | ------------------------------------- |
| Taxi-PE      | `silfhbdmfdryjdzpwzvh`   | `taxi-pe-app` (este)                  |
| Caja Tonazo  | `xaerfywydzwifohjsvwa`   | `caja-registradora-tonazo/caja-app`  |

No comparten base. Se hablan por HTTP: un **trigger + `pg_net`** emite en un proyecto,
una **Edge Function** recibe en el otro, valida la firma y aplica el cambio vía un
**RPC `security definer`**.

---

## 1. Identidad compartida

No hay IDs comunes entre las dos bases. El puente es:

1. **DNI** (principal) — en Taxi-PE vive en `usuarios.dni`; en la Caja se guarda en
   `clientes_fiado.taxi_conductor_dni` (columna nueva, ver migración de la Caja).
2. **Teléfono** (fallback) — `conductores.telefono` ↔ `usuarios.telefono` ↔
   `clientes_fiado.telefono` / `.whatsapp`.

Cada payload viaja con **ambos**:

```json
"identidad": { "dni": "12345678", "telefono": "912345678" }
```

Resolución en el receptor (función `fn_webhook_resolver_conductor` / `_cliente`):
DNI exacto → si no, teléfono exacto → si no, se registra el evento como
`sin_match` (se responde 200, no se reintenta) para conciliación manual.

---

## 2. Esquema de autenticación

**HMAC-SHA256 sobre el cuerpo + timestamp.** No se usan las claves anon/service de
un proyecto para hablarle al otro — cada dirección tiene su propio secreto rotable.

### Secretos (2, uno por dirección)

| Secreto                          | Lo conoce                                   |
| -------------------------------- | ------------------------------------------ |
| `WEBHOOK_SECRET_CAJA_TO_TAXI`    | Caja (emite) + Taxi-PE (verifica)          |
| `WEBHOOK_SECRET_TAXI_TO_CAJA`    | Taxi-PE (emite) + Caja (verifica)          |

- En el proyecto **emisor**: se guarda en Supabase Vault
  (`vault.decrypted_secrets`), lo lee el trigger.
- En el proyecto **receptor**: se guarda como secreto de Edge Function
  (`supabase secrets set`), lo lee `Deno.env`.
- Generar cada uno con: `openssl rand -hex 32`.

### Firma

El emisor arma el sobre JSON (`rawBody`) y calcula:

```
timestamp = floor(epoch_now)            (segundos)
signature = base64( HMAC_SHA256( secret, `${timestamp}.${rawBody}` ) )
```

Headers de la request:

| Header                 | Valor                                    |
| ---------------------- | ---------------------------------------- |
| `Content-Type`         | `application/json`                       |
| `X-Webhook-Id`         | `event_id` (uuid v4)                     |
| `X-Webhook-Timestamp`  | `timestamp`                             |
| `X-Webhook-Signature`  | `signature`                            |

### Verificación (Edge Function, antes de tocar nada)

1. `abs(now - X-Webhook-Timestamp) <= 300` seg — si no, **401** (anti-replay).
2. Recalcular la firma y comparar en **tiempo constante** — si no, **401**.
3. Idempotencia: `insert into webhook_inbox(event_id...) on conflict do nothing`.
   Si ya existía → **200** `{ "status": "duplicado" }` sin re-aplicar.
4. Aplicar el dominio (RPC). Responder **200** con `ok` / `sin_match`.

Las Edge Functions se despliegan con **`verify_jwt = false`** (el que llama es un
servidor, no un usuario de Supabase). El HMAC **es** la autenticación.

### Reintentos

`pg_net` es fire-and-forget. Patrón **outbox**:

- El trigger inserta en `webhook_outbox` (`estado='pendiente'`) y dispara el POST.
- Un `pg_cron` cada minuto (`fn_webhook_reconciliar`) cruza contra
  `net._http_response`:
  - 2xx → `estado='enviado'`.
  - error / timeout y `intentos < max_intentos` → re-despacha con backoff
    exponencial (`proximo_intento_at = now() + 1min * 2^intentos`).
  - `intentos >= max_intentos` (8 ≈ ~4 h) → `estado='fallido'` (revisar a mano).

### Anti-bucle

Toda fila creada por un webhook entrante lleva `origen = 'webhook:<app>'` y
`origen_ref = <id del otro lado>`. Los triggers emisores **ignoran** filas con
`origen like 'webhook:%'`, y el `insert` de dominio hace
`on conflict (origen, origen_ref) do nothing` (índice único), así una
re-entrega no duplica cargos ni pagos.

---

## 3. Eventos

### 3.1 `caja.venta_fiado_conductor` — Caja → Taxi-PE

**Dispara:** `AFTER INSERT ON historial` (Caja) donde `metodo_pago = 'FIADO'` y el
`clientes_fiado` asociado tiene `taxi_conductor_dni` no nulo.

**Payload `data`:**

```json
{
  "identidad": { "dni": "12345678", "telefono": "912345678" },
  "cargo": {
    "caja_ref": "<historial.purchase_id>",
    "concepto": "Venta fiado · 3 items",
    "monto": 45.50,
    "fecha": "2026-09-08T17:00:00Z"
  }
}
```

**Aplica (Taxi-PE, `rpc_webhook_caja_venta_fiado`):** resuelve el conductor →
`insert into fiados_conductores (conductor_id, concepto, monto, fecha_fiado,
estado, origen, origen_ref) values (…, 'pendiente', 'webhook:caja', caja_ref)`
con dedupe por `(origen, origen_ref)`. Sin match → `sin_match`, queda en
`webhook_inbox` para conciliar.

### 3.2 `caja.pedido_delivery` — ❌ REEMPLAZADO

El delivery dejó de ser un webhook fire-and-forget: es una sesión en vivo
(mapa + chat + GPS + QR/PIN) compartida entre cajero, cliente y repartidor.
Ver **[DELIVERY.md](DELIVERY.md)**. El handshake ahora es la Edge Function
`entrega-crear` (misma firma HMAC, evento `caja.entrega_crear`).

La migración `20260908150000_delivery_core.sql` da de baja las piezas 3.2 que
se habían creado (`pedidos_delivery_entrantes`, `rpc_webhook_caja_pedido_delivery`,
la función `webhook-caja-pedido-delivery`).

### 3.3 `taxi.pago_fiado_conductor` — Taxi-PE → Caja

**Dispara:** `AFTER INSERT ON pagos_fiados_conductores` (Taxi-PE) donde
`origen <> 'webhook:caja'`.

**Payload `data`:**

```json
{
  "identidad": { "dni": "12345678", "telefono": "912345678" },
  "pago": {
    "taxi_ref": "<pagos_fiados_conductores.id>",
    "monto": 20.00,
    "metodo_pago": "yape",
    "comprobante_url": "https://…/comprobantes-fotos/…jpg",
    "fecha": "2026-09-08T18:30:00Z"
  }
}
```

**Aplica (Caja, `rpc_webhook_taxi_pago_fiado`):** resuelve `clientes_fiado` por
DNI/teléfono → `insert into movimientos_fiado (cliente_id, tipo, monto,
descripcion, foto_url, metodo_pago, fecha, origen, origen_ref)` con
`tipo='pago'`, `metodo_pago` mapeado a `'DIGITAL'` (yape/plin/otros) o
`'EFECTIVO'`, `origen='webhook:taxi'`, `origen_ref=taxi_ref`, dedupe por
`(origen, origen_ref)`.

> **Decisión pendiente (ver §6):** ¿este pago entra al arqueo de caja
> (`efectivo_real` / `cierres_caja`) o es solo un movimiento digital que baja la
> deuda? Por defecto el RPC lo marca **digital/externo** y NO lo suma al efectivo
> físico del turno.

---

## 4. Archivos

### En este repo (Taxi-PE, proyecto `silfhbdmfdryjdzpwzvh`)

```
supabase/migrations/20260908120000_webhooks_infra.sql   infra + emisor 3.3 + RPC 3.1 (y 3.2, dado de baja luego)
supabase/migrations/20260908150000_delivery_core.sql    baja de 3.2 + núcleo de la sesión de delivery (DELIVERY.md)
supabase/functions/_shared/webhook.ts                   verificación HMAC (Deno)
supabase/functions/webhook-caja-fiado-conductor/index.ts   receptor 3.1
supabase/functions/entrega-crear/index.ts               handshake de delivery (reemplaza 3.2)
```

### En el repo de la Caja (`caja-registradora-tonazo/caja-app`, proyecto `xaerfywydzwifohjsvwa`)

```
supabase/migrations/0055_webhooks_infra.sql             infra + emisores 3.1/3.2 + RPC receptor 3.3
                                                        + columna clientes_fiado.taxi_conductor_dni
                                                        + columnas movimientos_fiado.origen / .origen_ref (+ índice único)
                                                        + columnas pedidos.requiere_delivery / .direccion_entrega /
                                                          .entrega_lat / .entrega_lng / .contacto_nombre / .contacto_telefono
supabase/functions/_shared/webhook.ts                   idéntico al de Taxi-PE
supabase/functions/webhook-taxi-pago-fiado/index.ts     receptor 3.3
```

> ⚠️ El header de `0055_webhooks_infra.sql` trae una query para verificar los
> nombres de columna de `fiado_items` / `movimientos_fiado` (inferidos del
> código de `caja-app/src/App.jsx`) contra el esquema real antes de aplicar.

> ⚠️ Cambio pendiente en `caja-app` (frontend): el cálculo de cierre/arqueo en
> `App.jsx` debe **excluir** `movimientos_fiado` con `origen = 'webhook:taxi'`
> (o `caja_id is null`) para que un pago hecho en Taxi-PE baje la deuda del
> cliente sin inflar el efectivo/digital del turno (§6.1).

> ⚠️ El evento 3.2 (`caja.pedido_delivery`) fue **reemplazado** por la sesión de
> delivery en vivo — ver [DELIVERY.md](DELIVERY.md). En `caja-app`, las piezas
> 3.2 de `0055_webhooks_infra.sql` (`fn_emitir_pedido_delivery*`,
> `trg_emitir_pedido_delivery`, columnas `pedidos.requiere_delivery`/…) se dan
> de baja en la migración de la Fase 3 del delivery.

El bloque de infra (`webhook_outbox`, `webhook_inbox`, `fn_webhook_*`,
`pg_cron`) es **el mismo** en ambos proyectos — cambia solo qué triggers emisores
y qué RPCs receptores se agregan.

---

## 5. Variables de entorno / secretos

### Taxi-PE (`silfhbdmfdryjdzpwzvh`)

Vault (SQL Editor):

```sql
select vault.create_secret('<hex-64>', 'webhook_secret_taxi_to_caja');
select vault.create_secret('https://xaerfywydzwifohjsvwa.supabase.co/functions/v1/webhook-taxi-pago-fiado',
                           'webhook_url_caja_pago_fiado');
```

Edge Functions:

```bash
supabase secrets set WEBHOOK_SECRET_CAJA_TO_TAXI=<hex-64> --project-ref silfhbdmfdryjdzpwzvh
```

### Caja (`xaerfywydzwifohjsvwa`)

Vault:

```sql
select vault.create_secret('<hex-64>', 'webhook_secret_caja_to_taxi');
select vault.create_secret('https://silfhbdmfdryjdzpwzvh.supabase.co/functions/v1/webhook-caja-fiado-conductor',
                           'webhook_url_taxi_fiado');
select vault.create_secret('https://silfhbdmfdryjdzpwzvh.supabase.co/functions/v1/webhook-caja-pedido-delivery',
                           'webhook_url_taxi_pedido');
```

Edge Functions:

```bash
supabase secrets set WEBHOOK_SECRET_TAXI_TO_CAJA=<hex-64> --project-ref xaerfywydzwifohjsvwa
```

> `<hex-64>` de `CAJA_TO_TAXI` es el mismo string en los dos proyectos; ídem
> `TAXI_TO_CAJA`. Son 2 valores distintos en total.

---

## 6. Decisiones abiertas

1. **Pago de fiado desde Taxi-PE en el arqueo de la Caja** (§3.3): ¿solo baja la
   deuda (movimiento digital externo) o además cuenta como ingreso del turno
   actual? Afecta `cierres_caja` / `efectivo_real`.
2. **Pedido delivery sin conductor disponible**: ¿la Caja necesita un rechazo/ACK
   de Taxi-PE, o alcanza con que quede `nuevo` en el panel de despacho?
3. **Venta fiado a un conductor que Taxi-PE no conoce** (`sin_match`): ¿se crea el
   conductor automáticamente con los datos de la Caja, o queda para que el Admin
   lo vincule a mano?
4. **`clientes_fiado` ↔ conductor**: ¿la Caja marca a mano qué cliente fiado es un
   conductor de taxi (setear `taxi_conductor_dni`), o cualquier `clientes_fiado`
   con DNI que exista en `usuarios` de Taxi-PE se considera conductor?

---

## 7. Despliegue

```bash
# Taxi-PE
supabase db push --project-ref silfhbdmfdryjdzpwzvh
supabase functions deploy webhook-caja-fiado-conductor --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh
supabase functions deploy webhook-caja-pedido-delivery  --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh

# Caja (cuando estén los archivos)
supabase db push --project-ref xaerfywydzwifohjsvwa
supabase functions deploy webhook-taxi-pago-fiado --no-verify-jwt --project-ref xaerfywydzwifohjsvwa
```

Prueba de humo (desde el proyecto emisor, SQL Editor):

```sql
select fn_webhook_emitir(
  'taxi.pago_fiado_conductor', 'caja',
  jsonb_build_object(
    'identidad', jsonb_build_object('dni','00000000','telefono','900000000'),
    'pago', jsonb_build_object('taxi_ref', gen_random_uuid(), 'monto', 1.0,
                               'metodo_pago','yape','comprobante_url',null,
                               'fecha', now())
  )
);
select * from webhook_outbox order by created_at desc limit 1;
```
