// Mismo criterio que ya usaba App.jsx (toPeruWhatsappNumber) para el
// wa.me de clientes: wa.me necesita el número en formato internacional
// sin signos — un celular peruano de 9 dígitos que empieza en "9" se
// guarda casi siempre sin el "51" delante, así que se lo agregamos acá
// en vez de asumir que `conductores.telefono` ya viene con código de país.
export function buildWhatsappLink(telefono, mensaje) {
  const cleaned = String(telefono || "").replace(/\D/g, "");
  if (!cleaned) return null;
  const numero = cleaned.length === 9 && cleaned.startsWith("9") ? `51${cleaned}` : cleaned;
  const base = `https://wa.me/${numero}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}
