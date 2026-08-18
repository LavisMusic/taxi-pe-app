// Ranking tripartito (Top Usuarios / Usuario Estrella) calculado desde
// `ventas`. Sin tabla de viajes/contactos, no hay forma de atribuir una
// venta a un pasajero (ventas solo tiene conductor_id/recolector_id) —
// el ranking de Pasajeros queda vacío a propósito hasta que exista esa
// pieza (decisión tomada con el usuario: placeholder por ahora).
export function buildTopRanking({ ventas, conductores, usuarios }) {
  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));

  const porConductor = new Map();
  const porRecolector = new Map();

  for (const v of ventas) {
    const monto = Number(v.monto || 0);

    if (v.conductor_id) {
      const acc = porConductor.get(v.conductor_id) || { total: 0, ventas: 0 };
      acc.total += monto;
      acc.ventas += 1;
      porConductor.set(v.conductor_id, acc);
    }
    if (v.recolector_id) {
      const acc = porRecolector.get(v.recolector_id) || { total: 0, ventas: 0 };
      acc.total += monto;
      acc.ventas += 1;
      porRecolector.set(v.recolector_id, acc);
    }
  }

  const conductoresRanking = [...porConductor.entries()]
    .map(([id, acc]) => ({
      id,
      nombre: conductoresById.get(id)?.nombre ?? "Conductor eliminado",
      total: acc.total,
      ventas: acc.ventas,
    }))
    .sort((a, b) => b.total - a.total);

  const recolectoresRanking = [...porRecolector.entries()]
    .map(([id, acc]) => ({
      id,
      nombre: usuariosById.get(id)?.nombre ?? "Recolector eliminado",
      total: acc.total,
      ventas: acc.ventas,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    conductores: conductoresRanking,
    recolectores: recolectoresRanking,
    pasajeros: [],
  };
}
