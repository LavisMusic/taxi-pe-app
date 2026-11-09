import InsigniaReputacion from "./InsigniaReputacion";
import { useReputacion } from "../lib/reputacion";

// Insignia de reputación de un conductor o pasajero de Taxi-PE, leída sola
// (en lote y en vivo) a partir de su id.
export default function ReputacionDe({ tipo, id, tamano, className }) {
  const { rep, etiquetas } = useReputacion(tipo, id);
  if (!id) return null;
  return <InsigniaReputacion rep={rep} etiquetas={etiquetas} tamano={tamano} className={className} />;
}
