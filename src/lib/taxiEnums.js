// Valores de texto libre usados en columnas `text` de Supabase
// (ventas.tipo_item, conductores.estado, fiados_conductores.estado).
// Ninguna de esas columnas es un enum real en la base — son strings
// sueltos — así que centralizamos el valor exacto acá en un solo lugar
// para corregirlo con un cambio de una línea si el valor real difiere.
//
// Confirmados contra el esquema real (information_schema.columns):
//   ventas: id, codigo_venta, conductor_id, recolector_id, tipo_item,
//           detalle, monto, metodo_pago, voucher_url, created_at
//   conductores: id, nombre, placa, telefono, foto_url, estado,
//                creditos, vencimiento_suscripcion, categoria_id,
//                subgrupo_id, nivel_servicio, aprobado, foto_general_url,
//                foto_placa_url, foto_conductor_dni_url, created_at
//   subgrupos: id, categoria_id, nombre, orden, created_at
//   fiados_conductores: id, conductor_id, concepto, monto, estado,
//                       fecha_fiado, fecha_pago
//   usuarios: id, dni, telefono, pin, nombre, rol, estado_cuenta, foto_url, created_at
//            (pin: hash bcrypt vía pgcrypto, ver lib/pinAuth.js — nunca
//             texto plano desde esta ronda en adelante)
//   categorias: id, nombre, orden
//   peticiones_pin: id, nombre, dni, placa, tipo_usuario, estado, created_at
//
// "membresia" viene literal del enunciado original
// ("tipo_item === 'membresia'"); "creditos" es una suposición simétrica
// — ajustar acá si el valor real es otro (ej. "credito", "recarga").
export const TIPO_ITEM_MEMBRESIA = "membresia";
export const TIPO_ITEM_CREDITOS = "creditos";

// `conductores.estado` no tiene una columna `aprobado` aparte: se
// asume que un conductor recién registrado queda con estado NULL (o
// 'pendiente') hasta que el admin lo aprueba a uno de los 3 estados
// operativos del enunciado. "rechazado" es una suposición para poder
// distinguir un registro rechazado de uno operativo — ajustar si el
// admin prefiere borrar la fila en vez de marcarla.
export const ESTADO_CONDUCTOR_ACTIVO = "activo";
export const ESTADO_CONDUCTOR_OCUPADO = "ocupado";
export const ESTADO_CONDUCTOR_DESCONECTADO = "desconectado";
export const ESTADO_CONDUCTOR_PENDIENTE = "pendiente";
export const ESTADO_CONDUCTOR_RECHAZADO = "rechazado";

export const ESTADOS_CONDUCTOR_OPERATIVOS = [
  { value: ESTADO_CONDUCTOR_ACTIVO, label: "Activo" },
  { value: ESTADO_CONDUCTOR_OCUPADO, label: "Ocupado" },
  { value: ESTADO_CONDUCTOR_DESCONECTADO, label: "Desconectado" },
];

export function esConductorPendiente(estado) {
  return !estado || estado === ESTADO_CONDUCTOR_PENDIENTE;
}

// `usuarios.rol` — usado tanto para el selector del Registro/Login de
// Pasajero como para etiquetar el tipo de solicitante en el Centro de
// Peticiones (pestaña Recuperación de PIN).
export const TIPO_USUARIO_CONDUCTOR = "conductor";
export const TIPO_USUARIO_PASAJERO = "pasajero";
export const TIPO_USUARIO_RECOLECTOR = "recolector";

export const TIPOS_USUARIO = [
  { value: TIPO_USUARIO_CONDUCTOR, label: "Conductor" },
  { value: TIPO_USUARIO_PASAJERO, label: "Pasajero" },
  { value: TIPO_USUARIO_RECOLECTOR, label: "Recolector" },
];

// `usuarios.estado_cuenta` — el equivalente de `conductores.aprobado`
// pero para cuentas que NO tienen fila en `conductores` (Recolectores
// auto-registrados, ver RegistroRecolectorModal.jsx). Todo lo que crea
// una fila en `usuarios` la marca explícito ('activo' para altas del
// Admin/Recolector-a-Recolector, 'pendiente' solo para el auto-registro
// público) — nunca se deja que sea el DEFAULT de la columna quien
// decida, mismo criterio que ya costó el bug "conductor fantasma" con
// `conductores.estado`.
export const ESTADO_CUENTA_ACTIVO = "activo";
export const ESTADO_CUENTA_PENDIENTE = "pendiente";
export const ESTADO_CUENTA_RECHAZADO = "rechazado";

// `conductores.localidad` — lista cerrada (no texto libre) para que el
// filtro de la Home pública sea un match exacto simple, no un buscador
// de texto. Ajustar esta lista es un cambio de una línea si la zona de
// cobertura real difiere (son distritos de la provincia de Chanchamayo,
// Junín — el ejemplo que dio el enunciado).
export const LOCALIDADES = ["San Ramón", "La Merced", "Chanchamayo", "Pichanaki", "Perené", "San Luis de Shuaro"];

// Nombre completo: exige al menos 2 palabras (nombre + apellido) — sin
// esto, un solo token ("Daniela") pasaba el form pero después es
// imposible distinguir personas en el Centro de Peticiones o Usuarios.
export function esNombreCompletoValido(nombre) {
  return /^\S+(\s+\S+)+$/.test(nombre.trim());
}

// Teléfono Perú: celular de 9 dígitos, siempre empieza en 9 (no hay
// operador que emita números móviles con otro prefijo). Reemplaza al
// regex laxo /^\d{6,15}$/ que se usaba antes en cada formulario por
// separado — centralizado acá para que un ajuste futuro (otro país,
// otro prefijo) sea un cambio de una sola línea en vez de perseguir
// cada input de teléfono del proyecto uno por uno.
export const TELEFONO_REGEX = /^9\d{8}$/;

export function esTelefonoValido(telefono) {
  return TELEFONO_REGEX.test(String(telefono || "").trim());
}

// `peticiones_pin.estado` — máquina de 3 pasos del flujo 2FA manual:
// pendiente (recién llegada) -> verificado (el admin ya confirmó
// identidad por WhatsApp, falta generar+enviar el PIN nuevo) ->
// resuelto (PIN ya cambiado y enviado, o descartada).
export const ESTADO_PETICION_PENDIENTE = "pendiente";
export const ESTADO_PETICION_VERIFICADO = "verificado";
export const ESTADO_PETICION_RESUELTO = "resuelto";

// `conductores.nivel_servicio` — con CHECK constraint en la DB (ver
// SQL entregado), así que estos 4 valores son un contrato real con la
// base, no solo una convención de frontend como los demás enums de
// este archivo.
export const NIVEL_SERVICIO_ECONOMICO = "economico";
export const NIVEL_SERVICIO_EJECUTIVO = "ejecutivo";
export const NIVEL_SERVICIO_PREMIUM = "premium";
export const NIVEL_SERVICIO_VIP = "vip";

export const NIVELES_SERVICIO = [
  { value: NIVEL_SERVICIO_ECONOMICO, label: "Económico" },
  { value: NIVEL_SERVICIO_EJECUTIVO, label: "Ejecutivo" },
  { value: NIVEL_SERVICIO_PREMIUM, label: "Premium" },
  { value: NIVEL_SERVICIO_VIP, label: "VIP" },
];

// fiados_conductores.estado: sin valor confirmado, se asume el par
// obvio pendiente/pagado (fecha_pago se llena al marcar como pagado).
// "anulado" es nuevo: lo pone useAnularVenta.js cuando la venta que
// originó el fiado (fiados_conductores.venta_id) se anula — la deuda
// deja de existir sin necesidad de borrar la fila.
export const ESTADO_FIADO_PENDIENTE = "pendiente";
export const ESTADO_FIADO_PAGADO = "pagado";
export const ESTADO_FIADO_ANULADO = "anulado";

export function fiadoEstaPendiente(fila) {
  return fila.estado !== ESTADO_FIADO_PAGADO && fila.estado !== ESTADO_FIADO_ANULADO && !fila.fecha_pago;
}

// `peticiones_recarga_recolector.estado` — solicitud de saldo que hace
// un Recolector desde /recolector (Yape/Plin/Otros/Fiado + comprobante
// obligatorio), a diferencia de la Recarga Rápida que hace el Admin
// sobre la tarjeta de un recolector en el Directorio (esa va directo a
// 'aprobado', sin pasar por el Centro de Peticiones).
export const ESTADO_RECARGA_PENDIENTE = "pendiente";
export const ESTADO_RECARGA_APROBADO = "aprobado";
export const ESTADO_RECARGA_RECHAZADO = "rechazado";

// Costo operativo fijo diario que se descuenta de "Recaudado Hoy" para
// obtener la "Ganancia Neta (Hoy)" — dado literal en el enunciado.
export const COSTO_OPERATIVO_DIARIO = 8.67;

export function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// `ventas.metodo_pago` — mismo criterio que tipo_item: strings sueltos,
// valores en minúscula por simetría con "membresia"/"creditos".
export const METODO_PAGO_EFECTIVO = "efectivo";
export const METODO_PAGO_YAPE = "yape";
export const METODO_PAGO_PLIN = "plin";
export const METODO_PAGO_OTROS = "otros";
export const METODO_PAGO_FIADO = "fiado";

// Yape/Plin/Otros comparten el mismo flujo obligatorio de comprobante
// escaneado (cámara + OCR) antes de poder registrar la recarga.
export const METODOS_CON_COMPROBANTE = [METODO_PAGO_YAPE, METODO_PAGO_PLIN, METODO_PAGO_OTROS];

export const METODOS_PAGO = [
  { key: METODO_PAGO_EFECTIVO, label: "Efectivo" },
  { key: METODO_PAGO_YAPE, label: "Yape" },
  { key: METODO_PAGO_PLIN, label: "Plin" },
  { key: METODO_PAGO_OTROS, label: "Otros" },
  { key: METODO_PAGO_FIADO, label: "Fiado" },
];

// Valor de respaldo si el paquete elegido en Recarga Rápida no trae
// `dias_membresia` (no debería pasar con la UI actual, que siempre
// obliga a elegir un paquete de la tabla `paquetes` — ver
// usePaquetes.js/ConfigurarMembresiasModal.jsx).
export const MEMBRESIA_DIAS_EXTENSION = 30;

// `ventas.codigo_venta` es NOT NULL y no tiene default en la DB (es
// `text`, no `serial`) — se genera acá un código corto y suficientemente
// único para uso interno (no es un correlativo fiscal).
export function generarCodigoVenta() {
  return `REC-${Date.now().toString(36).toUpperCase()}`;
}

// `ventas` no tiene columnas numéricas de "cantidad de créditos" ni
// "días de membresía" (solo `monto` en soles) — ambas viajan embebidas
// en `detalle` como texto. build/parse viven juntos acá para que
// Anular (useAnularVenta.js) lea EXACTAMENTE el mismo formato que
// Recarga Rápida escribe.
//
// Importante: `diasMembresia` se graba TAL CUAL traía el paquete
// elegido en el momento de la venta — Anular lo PARSEA del propio
// `detalle` en vez de leer el paquete actual, para que revertir una
// venta vieja siga siendo correcto aunque el admin haya editado o
// borrado ese paquete después.
export function buildDetalleRecarga(tipoItem, cantidadCreditos, diasMembresia) {
  return tipoItem === TIPO_ITEM_MEMBRESIA
    ? `Membresía · ${diasMembresia ?? MEMBRESIA_DIAS_EXTENSION} días`
    : `${cantidadCreditos} créditos`;
}

export function parseCantidadCreditosFromDetalle(detalle) {
  const match = /^(\d+)/.exec(String(detalle || ""));
  return match ? Number(match[1]) : 0;
}

export function parseDiasMembresiaFromDetalle(detalle) {
  const match = /·\s*(\d+)\s*días/.exec(String(detalle || ""));
  return match ? Number(match[1]) : MEMBRESIA_DIAS_EXTENSION;
}
