import { useEffect, useState } from "react";
import { Megaphone, Plus, Save, Pencil, Trash2, X, Loader2, Upload, Image as ImageIcon, Video, Link2 } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { formatDate } from "../../utils/format";
import { FRECUENCIAS_ANUNCIO, FRECUENCIA_UNA_VEZ_DIA, FRECUENCIA_UNA_VEZ_TOTAL } from "../../lib/taxiEnums";
import { toYoutubeEmbedUrl } from "../../lib/youtube";

// input datetime-local necesita "YYYY-MM-DDTHH:mm" en hora LOCAL — ni
// el timestamptz crudo de la base (UTC, con offset) ni un ISO con "Z"
// le sirven tal cual, hay que recortarlo a mano.
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tipoMediaDe(anuncio) {
  if (anuncio?.video_url) return toYoutubeEmbedUrl(anuncio.video_url) ? "youtube" : "video";
  return "imagen";
}

// Mide el archivo (o la URL ya subida, al editar) para decidir si es
// vertical (9:16) — YouTube nunca pasa por acá, se asume 16:9 siempre.
// Acepta un File (subida nueva, con URL.createObjectURL) o un string
// (URL ya guardada, al abrir en modo edición).
function detectarOrientacionVertical(fileOUrl, tipo) {
  const medir = new Promise((resolve) => {
    const esFile = fileOUrl instanceof File;
    const url = esFile ? URL.createObjectURL(fileOUrl) : fileOUrl;
    const limpiar = () => {
      if (esFile) URL.revokeObjectURL(url);
    };
    if (tipo === "video") {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        resolve(video.videoHeight > video.videoWidth);
        limpiar();
      };
      video.onerror = () => {
        resolve(false);
        limpiar();
      };
      video.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        resolve(img.naturalHeight > img.naturalWidth);
        limpiar();
      };
      img.onerror = () => {
        resolve(false);
        limpiar();
      };
      img.src = url;
    }
  });
  // Algunos navegadores no disparan NI 'loadedmetadata' NI 'error' para
  // ciertos codecs de video en un blob local — sin este límite, ese
  // video dejaba la subida entera colgada para siempre (el admin veía
  // "no pasa nada" al tocar Guardar, porque `subiendo` nunca volvía a
  // false). Pasados 4s se asume horizontal y se sigue con la subida.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 4000));
  return Promise.race([medir, timeout]);
}

const TIPOS_MEDIA = [
  { value: "imagen", label: "Subir Imagen", icon: ImageIcon },
  { value: "video", label: "Subir Video", icon: Video },
  { value: "youtube", label: "YouTube", icon: Link2 },
];

function AnuncioForm({ initial, onGuardar, onCancelar, saving }) {
  const [tipoMedia, setTipoMedia] = useState(tipoMediaDe(initial));
  const [titulo, setTitulo] = useState(initial?.titulo ?? "");
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  const [imagenUrl, setImagenUrl] = useState(initial?.imagen_url ?? "");
  const [videoUrl, setVideoUrl] = useState(initial?.video_url ?? "");
  const [fechaInicio, setFechaInicio] = useState(toDatetimeLocalValue(initial?.fecha_inicio));
  const [fechaFin, setFechaFin] = useState(toDatetimeLocalValue(initial?.fecha_fin));
  const [frecuencia, setFrecuencia] = useState(
    initial?.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_DIA ? FRECUENCIA_UNA_VEZ_DIA : FRECUENCIA_UNA_VEZ_TOTAL
  );
  const [esVertical, setEsVertical] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");

  // Al editar un anuncio ya guardado, re-detecta la orientación desde la
  // URL existente — si no lo hiciéramos, un anuncio vertical (que ya
  // guardó título/descripción vacíos) mostraría los campos de texto
  // vacíos y editables, rompiendo la regla "vertical nunca lleva texto".
  useEffect(() => {
    const tipo = tipoMediaDe(initial);
    if (tipo === "youtube") return;
    const url = initial?.imagen_url || initial?.video_url;
    if (!url) return;
    let cancelado = false;
    detectarOrientacionVertical(url, tipo).then((vertical) => {
      if (!cancelado) setEsVertical(vertical);
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cambiarTipoMedia = (nuevo) => {
    setTipoMedia(nuevo);
    setImagenUrl("");
    setVideoUrl("");
    setEsVertical(false);
  };

  const handleArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    setError("");
    try {
      const vertical = await detectarOrientacionVertical(file, tipoMedia);
      setEsVertical(vertical);
      if (vertical) {
        setTitulo("");
        setDescripcion("");
      }
      const ext = (file.name.split(".").pop() || (tipoMedia === "video" ? "mp4" : "jpg")).toLowerCase();
      // Date.now() solo puede colisionar si dos subidas caen en el mismo
      // milisegundo (doble click, dos pestañas) — el sufijo random lo
      // descarta sin necesidad de sumar una dependencia de uuid.
      const fileName = `anuncio-${tipoMedia}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("anuncios-media")
        .upload(fileName, file, {
          contentType: file.type || (tipoMedia === "video" ? "video/mp4" : "image/jpeg"),
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("anuncios-media").getPublicUrl(fileName);
      if (!data?.publicUrl) throw new Error("No se pudo obtener la URL pública.");
      if (tipoMedia === "imagen") setImagenUrl(data.publicUrl);
      else setVideoUrl(data.publicUrl);
    } catch (err) {
      // Visible en consola para diagnosticar RLS del bucket / límite de
      // tamaño de archivo, además del error mostrado en el form.
      console.error("Error al subir archivo de anuncio:", err);
      const etiqueta = tipoMedia === "video" ? "el video" : "la imagen";
      setError(err?.message || `No se pudo subir ${etiqueta}. Puede ser el límite de tamaño del bucket o sus políticas RLS.`);
    } finally {
      setSubiendo(false);
    }
  };

  const handleGuardar = () => {
    if (tipoMedia === "imagen" && !imagenUrl.trim()) {
      setError("Sube una imagen.");
      return;
    }
    if (tipoMedia === "video" && !videoUrl.trim()) {
      setError("Sube un video.");
      return;
    }
    if (tipoMedia === "youtube" && !videoUrl.trim()) {
      setError("Pega el link del video de YouTube.");
      return;
    }
    const usaVigencia = frecuencia === FRECUENCIA_UNA_VEZ_DIA;
    if (usaVigencia && fechaInicio && fechaFin && new Date(fechaFin) < new Date(fechaInicio)) {
      setError("La fecha de fin no puede ser anterior a la de inicio.");
      return;
    }
    setError("");
    onGuardar({
      titulo: esVertical ? null : titulo.trim() || null,
      descripcion: esVertical ? null : descripcion.trim() || null,
      imagen_url: tipoMedia === "imagen" ? imagenUrl.trim() || null : null,
      video_url: tipoMedia !== "imagen" ? videoUrl.trim() || null : null,
      fecha_inicio: usaVigencia && fechaInicio ? new Date(fechaInicio).toISOString() : null,
      fecha_fin: usaVigencia && fechaFin ? new Date(fechaFin).toISOString() : null,
      frecuencia_mostrar: frecuencia,
    });
  };

  return (
    <div className="tz-add-entry">
      <label className="tz-field-label">Tipo de contenido</label>
      <div className="tz-gasto-tipo-buttons">
        {TIPOS_MEDIA.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`tz-gasto-tipo-btn ${tipoMedia === t.value ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => cambiarTipoMedia(t.value)}
          >
            <t.icon size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tipoMedia === "youtube" ? (
        <>
          <label className="tz-field-label" style={{ marginTop: 4 }}>
            Link de YouTube
          </label>
          <input
            type="text"
            className="tz-text-input"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </>
      ) : (
        <>
          <label className="tz-field-label" style={{ marginTop: 4 }}>
            {tipoMedia === "imagen" ? "Imagen" : "Video"}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {tipoMedia === "imagen" && imagenUrl ? (
              <img src={imagenUrl} alt="" style={{ width: 56, height: 40, borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <div className="tz-peticion-foto-placeholder" style={{ width: 56, height: 40, flexShrink: 0 }}>
                {tipoMedia === "imagen" ? <ImageIcon size={16} /> : <Video size={16} />}
              </div>
            )}
            <label className="tz-camera-cancel tz-image-manager-btn" style={{ flex: "0 0 auto" }}>
              {subiendo ? <Loader2 size={14} className="tz-spin" /> : <Upload size={14} />}
              {subiendo ? "Subiendo…" : "Subir archivo"}
              <input
                type="file"
                accept={tipoMedia === "imagen" ? "image/*" : "video/*"}
                hidden
                disabled={subiendo}
                onChange={handleArchivo}
              />
            </label>
            {tipoMedia === "video" && videoUrl && !subiendo && <Video size={14} style={{ color: "var(--text-dim)" }} />}
          </div>
        </>
      )}

      {esVertical && (
        <p className="tz-camera-note" style={{ margin: "-2px 0 0" }}>
          Contenido vertical detectado — el título y la descripción se ocultan para no tapar el video/imagen.
        </p>
      )}

      {!esVertical && (
        <>
          <label className="tz-field-label">Título (opcional)</label>
          <input type="text" className="tz-text-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. ¡Membresía VIP con 20% off!" />

          <label className="tz-field-label">Descripción (opcional)</label>
          <textarea
            className="tz-text-input"
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej. Válido hasta fin de mes, solo para conductores nuevos."
          />
        </>
      )}

      <label className="tz-field-label">Frecuencia</label>
      <select className="tz-text-input" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)}>
        {FRECUENCIAS_ANUNCIO.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {frecuencia === FRECUENCIA_UNA_VEZ_DIA && (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="tz-field-label">Vigente desde</label>
              <input type="datetime-local" className="tz-text-input" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="tz-field-label">Vigente hasta</label>
              <input type="datetime-local" className="tz-text-input" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
            </div>
          </div>
          <p className="tz-camera-note" style={{ margin: "-4px 0 0" }}>
            Deja alguno vacío para no ponerle límite de ese lado.
          </p>
        </>
      )}

      {error && <p className="tz-error">{error}</p>}
      <div className="tz-add-entry-actions">
        <button className="tz-camera-cancel" onClick={onCancelar} disabled={saving}>
          Cancelar
        </button>
        <button className="tz-pw-submit tz-payment-save" onClick={handleGuardar} disabled={saving || subiendo}>
          {saving || subiendo ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
          {subiendo ? `Subiendo ${tipoMedia === "video" ? "video" : "imagen"}…` : saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function AnuncioRow({ anuncio, onActualizar, onEliminar }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState("");

  const guardar = async (patch) => {
    setSaving(true);
    const { error: saveError } = await onActualizar(anuncio.id, patch);
    setSaving(false);
    if (saveError) {
      setError(saveError.message || "No se pudo guardar.");
      return;
    }
    setError("");
    setEditing(false);
  };

  const eliminar = async () => {
    setBorrando(true);
    await onEliminar(anuncio.id);
    setBorrando(false);
  };

  if (editing) {
    return (
      <li className="tz-history-row">
        <div className="tz-history-row-detail" style={{ padding: 12 }}>
          {error && <p className="tz-error">{error}</p>}
          <AnuncioForm initial={anuncio} onGuardar={guardar} onCancelar={() => setEditing(false)} saving={saving} />
        </div>
      </li>
    );
  }

  const frecuenciaLabel = FRECUENCIAS_ANUNCIO.find((f) => f.value === anuncio.frecuencia_mostrar)?.label || anuncio.frecuencia_mostrar;

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {anuncio.imagen_url ? (
            <img src={anuncio.imagen_url} alt="" style={{ width: 44, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div className="tz-peticion-foto-placeholder" style={{ width: 44, height: 32, flexShrink: 0 }}>
              <Video size={14} />
            </div>
          )}
          <span style={{ minWidth: 0 }}>
            <strong style={{ color: "var(--text)" }}>{anuncio.titulo || "(sin título — solo multimedia)"}</strong>
            <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 12 }}>
              {frecuenciaLabel}
              {anuncio.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_DIA && (
                <>
                  {" "}
                  · {anuncio.fecha_inicio ? formatDate(anuncio.fecha_inicio) : "sin inicio"} → {anuncio.fecha_fin ? formatDate(anuncio.fecha_fin) : "sin fin"}
                </>
              )}
            </p>
          </span>
        </span>
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="tz-vis-edit-btn" onClick={() => setEditing(true)} aria-label="Editar anuncio" title="Editar">
            <Pencil size={14} />
          </button>
          <button type="button" className="tz-vis-reject-btn" onClick={eliminar} disabled={borrando} aria-label="Eliminar anuncio" title="Eliminar">
            {borrando ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={14} />}
          </button>
        </span>
      </div>
    </li>
  );
}

// "Gestor de Anuncios" — botón nuevo del footer del Admin. CRUD de
// campañas de marketing (pop-up que ve el público en la Home, ver
// AnuncioPopupModal.jsx / useAnuncioActivo.js).
export default function GestorAnunciosModal({ anuncios, loading, error, crearAnuncio, actualizarAnuncio, eliminarAnuncio, onClose }) {
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const crear = async (patch) => {
    setSaving(true);
    const { error: createError } = await crearAnuncio(patch);
    setSaving(false);
    if (createError) {
      setSaveError(createError.message || "No se pudo crear el anuncio.");
      return;
    }
    setSaveError("");
    setAddOpen(false);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Megaphone size={17} /> Gestor de Anuncios
          </h2>
          <p className="tz-stock-editor-sub">
            Pop-up de marketing que ven los visitantes de la Home pública, con su propia vigencia y frecuencia.
          </p>

          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Nuevo anuncio
            </button>
          ) : (
            <>
              {saveError && <p className="tz-error">{saveError}</p>}
              <AnuncioForm onGuardar={crear} onCancelar={() => setAddOpen(false)} saving={saving} />
            </>
          )}

          {loading ? (
            <div className="tz-loading" style={{ minHeight: 100 }}>
              <Loader2 className="tz-spin" size={22} />
              <p>Cargando…</p>
            </div>
          ) : error ? (
            <p className="tz-error">{error}</p>
          ) : anuncios.length === 0 ? (
            <p className="tz-method-history-empty">No hay anuncios creados todavía.</p>
          ) : (
            <ul className="tz-history-rows">
              {anuncios.map((a) => (
                <AnuncioRow key={a.id} anuncio={a} onActualizar={actualizarAnuncio} onEliminar={eliminarAnuncio} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
