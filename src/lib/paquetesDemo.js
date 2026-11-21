// Fallback SOLO de interfaz — nunca se guarda en la base. Si el admin
// todavía no configuró ningún paquete real en `paquetes`, el
// desplegable de Recarga Rápida usa esto para que se pueda probar el
// flujo completo (selección → resumen → registrar) sin datos reales.
// El nombre queda marcado "(demo)" a propósito: si alguien lo
// selecciona y de verdad registra una recarga con esto, en el
// Historial va a quedar clarísimo que fue de prueba.
import { TIPO_ITEM_MEMBRESIA } from "./taxiEnums";

export const PAQUETES_DEMO = {
  [TIPO_ITEM_MEMBRESIA]: [
    { id: "demo-mem-basica", tipo_item: TIPO_ITEM_MEMBRESIA, nombre: "(demo) Membresía Básica", precio: 30, dias_membresia: 30 },
    { id: "demo-mem-premium", tipo_item: TIPO_ITEM_MEMBRESIA, nombre: "(demo) Membresía Premium", precio: 50, dias_membresia: 30 },
  ],
};

export function esPaqueteDemo(id) {
  return typeof id === "string" && id.startsWith("demo-");
}
