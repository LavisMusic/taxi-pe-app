import { useState } from "react";
import { MapContainer, TileLayer, Marker, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, X, Plus, Pencil, Trash2, Check, Loader2, Crosshair } from "lucide-react";
import { useBuscadorDireccion } from "../../hooks/useBuscadorDireccion";
import { COORD_DEFAULT } from "../../hooks/useLocalidades";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../../lib/mapboxConfig";
import ListaArrastrable from "./ListaArrastrable";

const ICONO_LOCALIDAD = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker tz-radar-marker-destino">📍</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

// Sub-flujo "Establecer Coordenadas": buscador Nominatim (mismo hook
// que usa RadarGlobal.jsx, sin `localidadFiltro` acá — al revés que ahí,
// ESTO es lo que define una localidad nueva, no puede depender de una ya
// elegida) + un mini-mapa con pin ARRASTRABLE. Las dos formas de fijar
// el punto conviven: buscar y elegir una sugerencia hace `flyTo` hacia
// ahí, o el Admin puede arrastrar el pin directo sobre el mapa — las dos
// terminan llamando a la misma función de arriba (`onSeleccionar`/
// `onMoverPin`), el punto final es siempre el que haya quedado bajo el
// pin, sin importar cómo llegó ahí.
function BuscadorCoordenadas({ coords, onSeleccionar, onMoverPin, onListo }) {
  const [texto, setTexto] = useState("");
  const [mapa, setMapa] = useState(null);
  const { sugerencias, buscando } = useBuscadorDireccion(texto);
  const centro = coords ?? { lat: COORD_DEFAULT[0], lon: COORD_DEFAULT[1] };

  const seleccionar = (sugerencia) => {
    const lat = Number(sugerencia.lat);
    const lon = Number(sugerencia.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    onSeleccionar({ lat, lon, nombreSugerido: (sugerencia.display_name ?? "").split(",")[0].trim() });
    // Imperativo (no un efecto atado a `coords`) a propósito: si esto
    // reaccionara a todo cambio de `coords`, arrastrar el pin también
    // dispararía un `flyTo` de vuelta al punto donde ya está — el mapa
    // "peleando" contra la mano del Admin. Solo una selección del
    // buscador debe mover la CÁMARA; arrastrar el pin no.
    mapa?.flyTo([lat, lon], 14, { duration: 1 });
  };

  return (
    <div className="tz-vis-inline-edit-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <input
        type="text"
        className="tz-text-input"
        placeholder="Buscar ciudad/distrito (ej. San Ramón, Junín)"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        autoFocus
      />
      {texto.trim().length >= 2 && (
        <div className="tz-buscador-dropdown" style={{ position: "static" }}>
          {buscando ? (
            <p className="tz-buscador-empty">
              <Loader2 size={13} className="tz-spin" /> Buscando…
            </p>
          ) : sugerencias.length === 0 ? (
            <p className="tz-buscador-empty">Sin resultados.</p>
          ) : (
            sugerencias.map((s) => (
              <button key={s.place_id} type="button" className="tz-buscador-item" onClick={() => seleccionar(s)}>
                <MapPin size={14} />
                <span>{s.display_name}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="tz-admin-minimapa-wrap">
        <MapContainer
          center={[centro.lat, centro.lon]}
          zoom={13}
          className="tz-admin-minimapa"
          scrollWheelZoom
          ref={setMapa}
          zoomControl={false}
        >
          {/* Consistencia con RadarGlobal.jsx: mismo control de zoom
             reubicado explícitamente, aunque acá el buscador vive en
             flujo normal (arriba del mapa, no superpuesto) y nunca
             chocó con nada — se aplica igual por prolijidad. */}
          <ZoomControl position="bottomright" />
          {/* Migración Mapbox (Fase 1): estilo 'dark-v11'. */}
          <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
          <Marker
            position={[centro.lat, centro.lon]}
            icon={ICONO_LOCALIDAD}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = e.target.getLatLng();
                onMoverPin({ lat: p.lat, lon: p.lng });
              },
            }}
          />
        </MapContainer>
      </div>
      <p className="tz-field-hint">Arrastra el pin para ajustar el punto exacto, o busca arriba.</p>

      <button type="button" className="tz-camera-cancel" style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }} onClick={onListo}>
        <Check size={13} /> Listo
      </button>
    </div>
  );
}

// Formulario de alta/edición — mismo componente para los dos casos
// (`localidad` null = alta nueva). Las coordenadas NUNCA se escriben a
// mano: solo llegan de BuscadorCoordenadas de arriba (buscador o pin
// arrastrable), así se garantiza que toda localidad guardada tiene un
// lat/lon real, nunca un typo.
function LocalidadForm({ localidad, onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState(localidad?.nombre ?? "");
  const [coords, setCoords] = useState(localidad ? { lat: localidad.lat, lon: localidad.lon } : null);
  const [buscandoCoords, setBuscandoCoords] = useState(!localidad);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guardar = async () => {
    if (!nombre.trim()) {
      setError("Escribe un nombre para la localidad.");
      return;
    }
    if (!coords) {
      setError("Fija las coordenadas con el buscador o el pin antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await onGuardar({ nombre: nombre.trim(), lat: coords.lat, lon: coords.lon });
    setSaving(false);
    if (saveError) {
      setError(saveError.message?.includes("duplicate") ? "Ya existe una localidad con ese nombre." : "No se pudo guardar.");
    }
  };

  return (
    <div className="tz-vis-inline-edit-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <input
        type="text"
        className="tz-text-input"
        placeholder="Nombre de la localidad (ej. San Ramón)"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />

      {buscandoCoords ? (
        <BuscadorCoordenadas
          coords={coords}
          onSeleccionar={({ lat, lon, nombreSugerido }) => {
            setCoords({ lat, lon });
            if (!nombre.trim()) setNombre(nombreSugerido);
            setError("");
          }}
          onMoverPin={(nuevasCoords) => {
            setCoords(nuevasCoords);
            setError("");
          }}
          onListo={() => setBuscandoCoords(false)}
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="tz-field-hint" style={{ fontStyle: "normal" }}>
            {coords ? (
              <>
                <Crosshair size={12} style={{ verticalAlign: "-2px" }} /> {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
              </>
            ) : (
              "Sin coordenadas todavía"
            )}
          </span>
          <button type="button" className="tz-camera-cancel tz-scanner-upload-btn" onClick={() => setBuscandoCoords(true)}>
            <Crosshair size={13} /> Establecer Coordenadas
          </button>
        </div>
      )}

      {error && <p className="tz-error">{error}</p>}

      {/* Fix de Layout: antes reusaba .tz-vis-edit-btn (30x30px fijo,
         pensado para un ícono solo) con texto adentro — se veía
         aplastado. .tz-vis-form-actions es flex-wrap + gap, cada botón
         crece a su contenido real. */}
      {!buscandoCoords && (
        <div className="tz-vis-form-actions">
          <button type="button" className="tz-scan-btn tz-payment-save" onClick={guardar} disabled={saving} aria-label="Guardar localidad">
            {saving ? <Loader2 size={14} className="tz-spin" /> : <Check size={14} />} Guardar
          </button>
          <button type="button" className="tz-camera-cancel" onClick={onCancelar} disabled={saving} aria-label="Cancelar">
            <X size={14} /> Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function LocalidadRow({ localidad, onActualizar, onEliminar }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <LocalidadForm
        localidad={localidad}
        onGuardar={async (patch) => {
          const { error } = await onActualizar(localidad.id, patch);
          if (!error) setEditing(false);
          return { error };
        }}
        onCancelar={() => setEditing(false)}
      />
    );
  }

  // Antes esto era la propia <div className="tz-stock-row"> (el
  // ".tz-stock-row" real de Styles.jsx ya trae "display:flex;
  // justify-content:space-between" para separar info/acciones). Ahora
  // ESE wrapper lo pone ListaArrastrable.jsx (con el handle de arrastre
  // como primer hijo) — acá adentro solo queda el contenido, replicando
  // a mano ese mismo flex localmente para no perder el acomodo
  // izquierda/derecha.
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%" }}>
      <div className="tz-stock-row-info">
        <span className="tz-stock-row-name">{localidad.nombre}</span>
        <span className="tz-history-row-amount tz-chat-thread-preview">
          {localidad.lat.toFixed(5)}, {localidad.lon.toFixed(5)}
        </span>
      </div>
      <div className="tz-vis-row-actions">
        <button type="button" className="tz-vis-edit-btn" onClick={() => setEditing(true)} aria-label="Editar localidad" title="Editar">
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="tz-vis-delete-btn"
          onClick={() => {
            if (window.confirm(`¿Eliminar la localidad "${localidad.nombre}"?`)) onEliminar(localidad.id);
          }}
          aria-label="Eliminar localidad"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Panel Admin: CRUD de `localidades` (tabla en Supabase, ver
// useLocalidades.js) — el dropdown de localidad de
// RegistroConductorForm.jsx y el filtro de HomePage.jsx leen esta misma
// lista en vivo.
export default function AdminLocalidadesModal({
  localidades,
  loading,
  crearLocalidad,
  actualizarLocalidad,
  eliminarLocalidad,
  reordenarLocalidades,
  onClose,
}) {
  const [creando, setCreando] = useState(false);

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <MapPin size={17} /> Localidades
          </h2>
          <p className="tz-stock-editor-sub">
            Zonas de cobertura de la app — alimentan el dropdown de localidad del registro de conductores y el filtro/
            buscador de la Home. Las coordenadas se fijan buscando la ciudad/distrito o arrastrando el pin, nunca a mano.
            Arrastra del ícono ⠿ para cambiar el orden — el filtro del Pasajero se actualiza al instante.
          </p>

          <div className="tz-vis-accordion">
            <div className="tz-vis-create-categoria">
              {creando ? (
                <LocalidadForm
                  onGuardar={async (patch) => {
                    const { error } = await crearLocalidad(patch);
                    if (!error) setCreando(false);
                    return { error };
                  }}
                  onCancelar={() => setCreando(false)}
                />
              ) : (
                <button type="button" className="tz-camera-cancel tz-scanner-upload-btn" onClick={() => setCreando(true)}>
                  <Plus size={15} /> Nueva Localidad
                </button>
              )}
            </div>

            {loading ? (
              <div className="tz-loading" style={{ minHeight: 100 }}>
                <Loader2 className="tz-spin" size={22} />
              </div>
            ) : (
              <ListaArrastrable
                items={localidades ?? []}
                onReordenar={reordenarLocalidades}
                wrapperTag="div"
                wrapperClassName="tz-stock-list"
                itemTag="div"
                itemClassName="tz-stock-row"
                vacio={<p className="tz-method-history-empty">No hay localidades creadas todavía.</p>}
                renderItem={(loc) => (
                  <LocalidadRow localidad={loc} onActualizar={actualizarLocalidad} onEliminar={eliminarLocalidad} />
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
