// Subtítulo de la tarjeta de producto ("Fresa · 600ml"). Si el producto
// tiene una variante (sabor/color) con su propio hex asignado en el Admin,
// solo esa palabra toma ese color — el resto de la descripción (ej. la
// presentación "600ml") queda en el color de texto normal.
export default function CardDetail({ item }) {
  if (!item.detail) return null;

  if (item.variant && item.detail.startsWith(item.variant)) {
    const rest = item.detail.slice(item.variant.length);
    return (
      <p className="tz-card-detail">
        <span style={item.color ? { color: item.color } : undefined}>{item.variant}</span>
        {rest}
      </p>
    );
  }

  return <p className="tz-card-detail">{item.detail}</p>;
}
