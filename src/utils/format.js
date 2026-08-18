export function formatSoles(n) {
  return `S/ ${Number(n).toFixed(n % 1 === 0 ? 0 : 2)}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

// Formato de display "+51 987654321" — algunos números ya se guardaron
// con el "51" delante (ej. datos cargados por SQL), otros vienen como
// el celular local de 9 dígitos nomás. Se limpia y se antepone el
// prefijo una sola vez en cualquiera de los dos casos, para no mostrar
// "+51 51987654321". Solo cambia cómo se MUESTRA — nunca lo que se
// guarda ni lo que se compara/edita.
export function formatTelefono(telefono) {
  const cleaned = String(telefono || "").replace(/\D/g, "");
  if (!cleaned) return "";
  const local = cleaned.length === 11 && cleaned.startsWith("51") ? cleaned.slice(2) : cleaned;
  return `+51 ${local}`;
}
