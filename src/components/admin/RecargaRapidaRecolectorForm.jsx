import { useState } from "react";
import { Zap, Loader2 } from "lucide-react";
import { METODOS_PAGO, TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import { formatSoles } from "../../utils/format";

// Recarga Rápida — versión Admin para un RECOLECTOR (botón ⚡ de su
// tarjeta en el Directorio, categoría "Recolectores"). Mucho más simple
// que la de conductor: el destinatario ya viene fijo (sin buscador), los
// paquetes son SOLO los de `paquetes_recolectores`, y como es el Admin
// quien cobra en persona, se permite Efectivo (a diferencia de la
// Autorecarga que hace el propio recolector desde /recolector, que no
// lo permite — ver AutorecargaRecolectorModal). Va directo a
// `crearPeticion({ autoAprobar: true })`: aplica el saldo al toque, sin
// pasar por el Centro de Peticiones.
export default function RecargaRapidaRecolectorForm({ recolector, paquetes, crearPeticion, onDone }) {
  const [tipoItem, setTipoItem] = useState(TIPO_ITEM_MEMBRESIA);
  const [paqueteId, setPaqueteId] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const paquetesDelTipo = paquetes.filter((p) => p.tipo_item === tipoItem);
  const paquete = paquetesDelTipo.find((p) => String(p.id) === String(paqueteId)) || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    if (!paquete) {
      setError("Elige un paquete.");
      return;
    }
    if (!metodoPago) {
      setError("Elige un método de pago.");
      return;
    }
    setSaving(true);
    const { error: submitError } = await crearPeticion({
      recolector,
      paquete,
      metodoPago,
      autoAprobar: true,
    });
    setSaving(false);
    if (submitError) {
      setError("No se pudo registrar la recarga.");
      return;
    }
    setSuccessMsg(`Recarga aplicada a ${recolector.nombre}.`);
    setPaqueteId("");
    setMetodoPago("");
    onDone?.();
  };

  return (
    <form className="tz-payment-modal" onSubmit={handleSubmit} style={{ maxWidth: 480, margin: "0 auto" }}>
      <h2>
        <Zap size={17} /> Recarga Rápida — {recolector.nombre}
      </h2>

      <label className="tz-field-label">Tipo</label>
      <div className="tz-gasto-tipo-buttons">
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_MEMBRESIA ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => {
            setTipoItem(TIPO_ITEM_MEMBRESIA);
            setPaqueteId("");
          }}
        >
          Membresía
        </button>
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_CREDITOS ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => {
            setTipoItem(TIPO_ITEM_CREDITOS);
            setPaqueteId("");
          }}
        >
          Paquete de Créditos
        </button>
      </div>

      <label className="tz-field-label" style={{ marginTop: 12 }}>
        {tipoItem === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Paquete de créditos"}
      </label>
      <select className="tz-text-input" value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
        <option value="">{paquetesDelTipo.length === 0 ? "Ninguna configurada" : "Elige una opción…"}</option>
        {paquetesDelTipo.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre} — {formatSoles(p.precio)}
            {p.tipo_item === TIPO_ITEM_CREDITOS ? ` (${p.creditos} créditos)` : ` (${p.dias_membresia} días)`}
          </option>
        ))}
      </select>

      <label className="tz-field-label" style={{ marginTop: 12 }}>
        Método de pago
      </label>
      <div className="tz-gasto-tipo-buttons">
        {METODOS_PAGO.filter((m) => m.key !== "fiado").map((m) => (
          <button
            key={m.key}
            type="button"
            className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${m.key} ${
              metodoPago === m.key ? "tz-gasto-tipo-active" : ""
            }`}
            onClick={() => setMetodoPago(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {error && <p className="tz-error">{error}</p>}
      {successMsg && <p className="tz-success">{successMsg}</p>}

      <button type="submit" className="tz-scan-btn tz-payment-save" disabled={saving} style={{ marginTop: 14 }}>
        {saving ? <Loader2 size={16} className="tz-spin" /> : <Zap size={16} />}
        {saving ? "Registrando…" : "Registrar Recarga"}
      </button>
    </form>
  );
}
