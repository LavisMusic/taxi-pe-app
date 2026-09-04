// Catálogo de íconos de vehículo — Fase 1 de "Rutas Dinámicas y
// Contratos Inteligentes". Preparación para que el Admin pueda elegir
// un ícono por categoría/subgrupo más adelante (todavía no hay UI que
// los consuma). Son placeholders geométricos A PROPÓSITO, sin pulir —
// cada uno es un componente React normal (acepta `size`/props igual
// que los íconos de lucide-react ya usados en el resto de la app) para
// poder reemplazar el <path> de adentro más tarde sin tocar nada de lo
// que ya los importe.

function IconBase({ size = 24, children, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function MototaxiClasicaIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="15" cy="18" r="2.2" />
      <path d="M8 18h5M4 14l2-6h6l3 4h2a2 2 0 0 1 2 2v2h-2" />
      <path d="M10 8V5h3" />
    </IconBase>
  );
}

export function MototaxiModernaIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="16" cy="18" r="2.2" />
      <path d="M8 18h6M3.5 13.5 6 8h7l3.5 5.5H19a2 2 0 0 1 2 2V17h-2.5" />
      <path d="M11 8V6h4l1 2" />
    </IconBase>
  );
}

export function AutoSedanIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M3 17v-3.5L5 9a2 2 0 0 1 1.8-1h10.4A2 2 0 0 1 19 9l2 4.5V17h-2M9 17h6M3 17h2" />
      <path d="M6 8.5 7.5 6h9L18 8.5" />
    </IconBase>
  );
}

export function MinivanIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
      <path d="M3 17.5v-8a2 2 0 0 1 2-2h11l3.5 4.5.5 1v4.5h-2M9 17.5h6M3 17.5h2" />
      <path d="M14 7.5V11M9 7.5V11" />
    </IconBase>
  );
}

export function BusIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M3 12h18M7 5v12M12 5v12M17 5v12" />
      <circle cx="7" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </IconBase>
  );
}

export function CamionFleteIcon(props) {
  return (
    <IconBase {...props}>
      <rect x="2" y="8" width="11" height="8" rx="1" />
      <path d="M13 11h4l3 3v2h-2" />
      <circle cx="6" cy="18" r="1.8" />
      <circle cx="16" cy="18" r="1.8" />
      <path d="M8 18h4.5" />
    </IconBase>
  );
}

// Diccionario por clave — lookup directo (ej. VEHICLE_ICONS[categoria.icono]).
export const VEHICLE_ICONS = {
  "mototaxi-clasica": MototaxiClasicaIcon,
  "mototaxi-moderna": MototaxiModernaIcon,
  "auto-sedan": AutoSedanIcon,
  minivan: MinivanIcon,
  bus: BusIcon,
  "camion-flete": CamionFleteIcon,
};

// Lista ordenada con label — lista para un selector del Admin
// (dropdown o grid de botones tipo TIPOS_MEDIA en GestorAnunciosModal.jsx).
export const VEHICULOS_CATALOGO = [
  { value: "mototaxi-clasica", label: "Mototaxi Clásica", icon: MototaxiClasicaIcon },
  { value: "mototaxi-moderna", label: "Mototaxi Moderna", icon: MototaxiModernaIcon },
  { value: "auto-sedan", label: "Auto Sedán", icon: AutoSedanIcon },
  { value: "minivan", label: "Minivan", icon: MinivanIcon },
  { value: "bus", label: "Bus", icon: BusIcon },
  { value: "camion-flete", label: "Camión de Flete", icon: CamionFleteIcon },
];
