// Pasos de la guía de bienvenida de Don Peje en Taxi PE, por rol (los
// archivos de la mascota son los mismos que en Caja; este es el de Taxi).
//   abrir:    qué abrir antes de señalar (en Taxi no hace falta).
//   objetivo: selector de lo que se señala (si no está en pantalla, el paso
//             se salta solo).
//   hecho:    (estado) => true si ya lo tiene (ese paso se salta).
//   accion:   animación al empezar el paso.
// `{nombre}` en el texto se cambia por el nombre del usuario.

export const PASOS = {
  pasajero: [
    {
      id: "hola",
      texto: "¡Hola, {nombre}! Soy Don Peje, el robot asistente de Taxi PE. Te enseño a pedir tu taxi en un minuto. ¿Vamos?",
      boton: "¡Vamos!",
      accion: "saludar",
    },
    {
      id: "localidad",
      objetivo: ".tz-localidad-filtro-wrap",
      texto: "Primero elige tu localidad para ver los taxis de tu zona.",
    },
    {
      id: "radar",
      objetivo: ".tz-radar-btn",
      texto: "Toca el radar para marcar tu destino en el mapa y ver qué taxis están cerca de ti.",
    },
    {
      id: "conductores",
      objetivo: ".tz-grid",
      texto: 'Estos son los conductores disponibles: toca uno para ver su perfil, o "Contactar" para pedirle el viaje y acordar el precio.',
    },
    {
      id: "gemas",
      objetivo: ".tz-fila-saldo",
      texto: "Tus gemas: las ganas con tus viajes y compras, y te sirven para pagar parte de ellos.",
    },
    {
      id: "mensajes",
      objetivo: '[aria-label="Mensajes"]',
      texto: "En Mensajes conversas con tu conductor y te llegan los avisos de Taxi PE.",
    },
    {
      id: "perfil",
      objetivo: '[aria-label="Perfil"]',
      texto: "Y aquí está tu perfil: tu foto, tu nombre y tus calificaciones.",
    },
    {
      id: "fin",
      texto: "¡Listo, {nombre}! Ya puedes pedir tu taxi. Si me necesitas, tócame aquí en la esquina.",
      boton: "¡Gracias, Don Peje!",
      accion: "celebrar",
      emocion: "feliz",
    },
  ],

  conductor: [
    {
      id: "hola",
      texto: "¡Hola, {nombre}! Soy Don Peje, el robot asistente de Taxi PE. Te muestro cómo recibir pasajeros y pedidos. ¿Vamos?",
      boton: "¡Vamos!",
      accion: "saludar",
    },
    {
      id: "estado",
      objetivo: ".tz-estado-toggle",
      texto: "Este es tu interruptor: tócalo para ponerte Activo y que los pasajeros te vean. Vuelve a tocarlo cuando quieras descansar.",
    },
    {
      id: "paneles",
      objetivo: ".tz-paneles-tabs",
      texto: "Cambia entre Viajes y Delivery: en Delivery te llegan los pedidos de las tiendas para que los repartas.",
    },
    {
      id: "mensajes",
      objetivo: '[aria-label="Mensajes"]',
      texto: "En Mensajes te escriben los pasajeros y las tiendas.",
    },
    {
      id: "perfil",
      objetivo: '[aria-label="Editar perfil"]',
      texto: "En tu perfil pones tu foto y tu vehículo, y ves tu membresía y tus calificaciones.",
    },
    {
      id: "cierre",
      objetivo: ".tz-footer-btn-cierre",
      texto: "Al terminar tu día, cierra tu turno aquí y verás todo lo que hiciste.",
    },
    {
      id: "fin",
      texto: "¡Eso es todo, {nombre}! A rodar. Si me necesitas, tócame aquí en la esquina.",
      boton: "¡Gracias, Don Peje!",
      accion: "celebrar",
      emocion: "feliz",
    },
  ],

  recolector: [
    {
      id: "hola",
      texto: "¡Hola, {nombre}! Soy Don Peje, el robot asistente de Taxi PE. Te enseño a usar tu panel de recolector. ¿Vamos?",
      boton: "¡Vamos!",
      accion: "saludar",
    },
    {
      id: "registrar",
      objetivo: '[aria-label="Registrar conductor"]',
      texto: "Con este botón registras a un conductor nuevo y verificas su número.",
    },
    {
      id: "numeros",
      objetivo: ".tz-stats",
      texto: "Aquí ves lo que llevas cobrado hoy y el cupo que te queda para recargar.",
    },
    {
      id: "recarga",
      objetivo: ".tz-main form.tz-payment-modal",
      texto: "Con la recarga rápida le cargas membresía o créditos a un conductor: eliges el plan, cobras y listo.",
    },
    {
      id: "autorecarga",
      objetivo: ".tz-footer-btn-stock",
      texto: "Cuando se te acabe el cupo, recarga tu saldo de recolector desde aquí.",
    },
    {
      id: "cierre",
      objetivo: ".tz-footer-btn-cierre",
      texto: "Al terminar tu turno, haz el cierre: queda registrado todo lo que cobraste.",
    },
    {
      id: "fin",
      texto: "¡Listo, {nombre}! Ya conoces tu panel. Si me necesitas, tócame aquí en la esquina.",
      boton: "¡Gracias, Don Peje!",
      accion: "celebrar",
      emocion: "feliz",
    },
  ],
};

// Lo que ya tiene cada rol para saltar pasos hechos (en Taxi, nada todavía).
export function leerEstado() {
  return Promise.resolve({});
}
