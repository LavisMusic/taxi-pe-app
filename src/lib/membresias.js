import { descuentoVigente } from "../components/TarjetasPlanes";

// Membresías (paquetes / paquetes_recolectores) → tarjetas de
// TarjetasPlanes. `precio` ya es el precio vigente (lo calcula la base con el
// descuento programado, migración 20261205100000); `precio_base`, sin él.
// `detalle(p)`: el texto bajo el nombre.
export function itemsDeMembresias(lista, detalle) {
  return lista.map((p) => {
    const desc = descuentoVigente(p);
    return {
      id: String(p.id),
      nombre: p.nombre,
      detalle: detalle(p),
      grupo: Number(p.dias_membresia) >= 360 ? "anual" : "mensual",
      precio: Number(p.precio),
      precioBase: Number(p.precio_base ?? p.precio),
      descuento: desc,
      descuentoHasta: desc > 0 ? p.descuento_hasta : null,
    };
  });
}
