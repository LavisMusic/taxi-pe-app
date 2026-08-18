import {
  NIVELES_SERVICIO,
  NIVEL_SERVICIO_VIP,
  NIVEL_SERVICIO_PREMIUM,
  NIVEL_SERVICIO_EJECUTIVO,
  NIVEL_SERVICIO_ECONOMICO,
  ESTADO_CONDUCTOR_ACTIVO,
} from "./taxiEnums";

// Mismos colores que el glow de borde de .tz-card[data-nivel] en
// Styles.jsx — el puntito del encabezado del acordeón y el glow de la
// tarjeta cuentan la misma historia con el mismo color. Compartido
// entre el Directorio del Admin (editable) y la Home pública (solo
// lectura) para que ambos agrupen exactamente igual.
export const NIVEL_COLOR = {
  [NIVEL_SERVICIO_VIP]: "#ffd700",
  [NIVEL_SERVICIO_PREMIUM]: "var(--pink)",
  [NIVEL_SERVICIO_EJECUTIVO]: "var(--cyan)",
  [NIVEL_SERVICIO_ECONOMICO]: "var(--text-dim)",
};

// Orden fijo de los grupos, del más exclusivo al más básico — no
// alfabético ni por cantidad, para que VIP siempre encabece la lista.
export const ORDEN_NIVELES = [
  NIVEL_SERVICIO_VIP,
  NIVEL_SERVICIO_PREMIUM,
  NIVEL_SERVICIO_EJECUTIVO,
  NIVEL_SERVICIO_ECONOMICO,
];

// Agrupa una lista de conductores por nivel_servicio, en ORDEN_NIVELES,
// descartando los grupos vacíos. DENTRO de cada grupo, Libre siempre
// antes que En Carrera — así un conductor que se marca "Ocupado" se
// desliza visualmente hacia el fondo de su categoría (con
// `motion.div layout` en el grid, ver ConductoresDirectorio.jsx/
// HomePage.jsx) en vez de saltar a una posición random según cuándo
// llegó el evento de Realtime.
export function agruparPorNivel(conductores) {
  return ORDEN_NIVELES.map((nivel) => ({
    nivel,
    label: NIVELES_SERVICIO.find((n) => n.value === nivel)?.label ?? nivel,
    conductores: conductores
      .filter((c) => (c.nivel_servicio || NIVEL_SERVICIO_ECONOMICO) === nivel)
      .slice()
      .sort((a, b) => {
        const aLibre = a.estado === ESTADO_CONDUCTOR_ACTIVO ? 0 : 1;
        const bLibre = b.estado === ESTADO_CONDUCTOR_ACTIVO ? 0 : 1;
        return aLibre - bLibre;
      }),
  })).filter((g) => g.conductores.length > 0);
}
