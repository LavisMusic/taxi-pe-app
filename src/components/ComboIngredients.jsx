// Lista vertical de ingredientes de un Combo (uno por fila, "1x Hey FIT
// 600ml Fresa"), debajo del nombre — 'item.comboItems' guarda
// [{ productoId, cantidad }] (ver crearCombo en productLookup.js). Si el
// ingrediente es una variante con color asignado (composeProductoNombre
// la deja siempre al final: "Base Presentación - Variante"), esa palabra
// se resalta con su color — mismo criterio que CardDetail.jsx pero sobre
// 'name' en vez de 'detail'.
function nombreConColorDeVariante(producto) {
  if (!producto.variant || !producto.color || !producto.name.endsWith(producto.variant)) {
    return producto.name;
  }
  const prefijo = producto.name.slice(0, producto.name.length - producto.variant.length);
  return (
    <>
      {prefijo}
      <span style={{ color: producto.color }}>{producto.variant}</span>
    </>
  );
}

export default function ComboIngredients({ item, productsById }) {
  if (!item.esCombo || !Array.isArray(item.comboItems) || item.comboItems.length === 0) {
    return null;
  }

  const filas = item.comboItems
    .map(({ productoId, cantidad }) => {
      const ingrediente = productsById[productoId];
      return ingrediente ? { cantidad, ingrediente } : null;
    })
    .filter(Boolean);

  if (filas.length === 0) return null;

  return (
    <ul className="tz-combo-ingredients-list">
      {filas.map(({ cantidad, ingrediente }) => (
        <li key={ingrediente.id} className="tz-combo-ingredient-row">
          {cantidad}x {nombreConColorDeVariante(ingrediente)}
        </li>
      ))}
    </ul>
  );
}
