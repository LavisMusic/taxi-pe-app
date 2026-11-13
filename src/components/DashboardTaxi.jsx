import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Wallet, Car, PackageCheck, Radio, Crown, CalendarClock, MessageCircle, Loader2, BarChart3, Flame,
  MapPinned, Users, Repeat, UserMinus, PieChart,
} from "lucide-react";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../lib/mapboxConfig";
import IconoGema from "./IconoGema";
import {
  useContador, Delta, TarjetaDesglose, AnilloEstados, PestanasDp, HorasPico, ESTILO_PIEZAS,
} from "./DashboardPiezas";

/* Fase 5c — dashboard de Taxi-PE. MISMO archivo en Taxi-PE y Caja
   (src/components/DashboardTaxi.jsx): mantener iguales.
   - Taxi-PE: /admin/dashboard, leer = rpc taxi_dashboard_admin.
   - Caja: /superadmin/dashboard, leer = puente firmado "dashboard.resumen".
   `leer(desdeISO, hastaISO)` devuelve { data, error }.
   Colores en rgba literales: Taxi-PE no tiene las variables --*-rgb. */

const MS_DIA = 86400000;
const LIMA = 5 * 3600000; // Lima = UTC−5, sin horario de verano.
const PERIODOS = [
  { id: "mes", label: "Este mes" },
  { id: "anterior", label: "Mes anterior" },
  { id: "30", label: "Últimos 30 días" },
];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
function rango(id) {
  const ahora = Date.now();
  const lima = new Date(ahora - LIMA);
  const y = lima.getUTCFullYear();
  const m = lima.getUTCMonth();
  const inicioMes = (yy, mm) => new Date(Date.UTC(yy, mm, 1) + LIMA);
  if (id === "anterior") return { desde: inicioMes(y, m - 1), hasta: inicioMes(y, m) };
  if (id === "30") {
    const hoy = Date.UTC(y, m, lima.getUTCDate()) + LIMA;
    return { desde: new Date(hoy - 29 * MS_DIA), hasta: new Date(ahora) };
  }
  return { desde: inicioMes(y, m), hasta: new Date(ahora) };
}

const diaLima = (t) => new Date(t - LIMA).toISOString().slice(0, 10);
const soles = (n, dec = 2) =>
  `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const entero = (n) => Math.round(Number(n || 0)).toLocaleString("es-PE");
const fechaCorta = (f) => new Date(f).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });

function Kpi({ icono: Icono, titulo, valor, formato = soles, anterior, invertido, nota, tono = "cyan", i = 0, children }) {
  const v = useContador(valor);
  return (
    <div className={`tz-dt-kpi tono-${tono}`} style={{ animationDelay: `${i * 70}ms` }}>
      <span className="tz-dt-kpi-icono">{children || <Icono size={18} />}</span>
      <span className="tz-dt-kpi-titulo">{titulo}</span>
      <strong className="tz-dt-kpi-valor">{formato(v)}</strong>
      <span className="tz-dt-kpi-pie">
        {anterior !== undefined && <Delta actual={valor} anterior={anterior} invertido={invertido} />}
        {nota && <span className="tz-dt-kpi-nota">{nota}</span>}
      </span>
    </div>
  );
}

// Viajes (cian) y entregas (rosa) por día.
function GraficoDias({ serie }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 210, P = { l: 8, r: 8, t: 26, b: 22 };
  const max = Math.max(...serie.map((d) => Math.max(d.viajes, d.entregas)), 1);
  const paso = serie.length > 1 ? (W - P.l - P.r) / (serie.length - 1) : 0;
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  const camino = (k) => serie.map((d, i) => `${i ? "L" : "M"}${(P.l + i * paso).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const lv = camino("viajes");
  const le = camino("entregas");
  const area = serie.length ? `${lv} L${P.l + (serie.length - 1) * paso},${H - P.b} L${P.l},${H - P.b} Z` : "";
  const marcas = serie.length > 12 ? Math.ceil(serie.length / 6) : 1;
  const h = hover != null ? serie[hover] : null;
  return (
    <div className="tz-dt-grafico" onMouseLeave={() => setHover(null)}>
      <div className="tz-dt-leyenda-linea">
        <span><i className="is-viajes" /> Viajes</span>
        <span><i className="is-entregas" /> Entregas</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} key={serie.length + ":" + max}>
        <defs>
          <linearGradient id="tz-dt-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2be8ff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2be8ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="tz-dt-guia" x1={P.l} x2={W - P.r} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} />
        ))}
        <path className="tz-dt-area" d={area} fill="url(#tz-dt-area)" />
        <path className="tz-dt-linea is-viajes" d={lv} pathLength="1" />
        <path className="tz-dt-linea is-entregas" d={le} pathLength="1" />
        {serie.map((d, i) => {
          const x = P.l + i * paso;
          return (
            <g key={d.dia}>
              <rect x={x - paso / 2} y={0} width={Math.max(paso, 6)} height={H} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              {hover === i && (
                <>
                  <line className="tz-dt-cursor" x1={x} x2={x} y1={P.t - 6} y2={H - P.b} />
                  <circle className="tz-dt-punto is-viajes" cx={x} cy={y(d.viajes)} r="4.5" />
                  <circle className="tz-dt-punto is-entregas" cx={x} cy={y(d.entregas)} r="4.5" />
                </>
              )}
            </g>
          );
        })}
        {serie.map((d, i) =>
          i % marcas === 0 ? (
            <text key={d.dia} className="tz-dt-eje" x={P.l + i * paso} y={H - 6} textAnchor={i === 0 ? "start" : "middle"}>
              {Number(d.dia.slice(8))}/{Number(d.dia.slice(5, 7))}
            </text>
          ) : null
        )}
      </svg>
      {h && (
        <div className="tz-dt-tip" style={{ left: `${((P.l + hover * paso) / W) * 100}%`, top: `${(y(Math.max(h.viajes, h.entregas)) / H) * 100}%` }}>
          <span>{Number(h.dia.slice(8))} {MESES[Number(h.dia.slice(5, 7)) - 1]}</span>
          <strong className="is-viajes">{entero(h.viajes)} viajes</strong>
          <strong className="is-entregas">{entero(h.entregas)} entregas</strong>
        </div>
      )}
    </div>
  );
}

// Ingresos por membresías, 6 meses: barras apiladas conductores + recolectores.
function GraficoIngresos({ serie }) {
  const max = Math.max(...serie.map((d) => d.conductores + d.recolectores), 1);
  return (
    <>
      <div className="tz-dt-leyenda-linea">
        <span><i className="is-cond" /> Conductores</span>
        <span><i className="is-reco" /> Recolectores</span>
      </div>
      <div className="tz-dt-barras">
        {serie.map((d, i) => {
          const tot = d.conductores + d.recolectores;
          return (
            <div key={d.mes} className={`tz-dt-barra ${i === serie.length - 1 ? "is-actual" : ""}`}>
              <span className="tz-dt-barra-valor">{tot ? soles(tot, 0) : "—"}</span>
              <span className="tz-dt-barra-pista">
                <span className="tz-dt-barra-pila" style={{ height: `${Math.max(3, (tot / max) * 100)}%`, animationDelay: `${i * 80}ms` }}>
                  <span className="is-reco" style={{ flexGrow: d.recolectores }} />
                  <span className="is-cond" style={{ flexGrow: d.conductores || (tot ? 0 : 1) }} />
                </span>
              </span>
              <span className="tz-dt-barra-mes">{MESES[Number(d.mes.slice(5)) - 1]}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Encuadre({ zonas }) {
  const map = useMap();
  useEffect(() => {
    if (!zonas.length) return;
    const b = L.latLngBounds(zonas.map((z) => [Number(z.lat), Number(z.lng)]));
    map.fitBounds(b.pad(0.3), { maxZoom: 15, animate: true });
  }, [map, zonas]);
  return null;
}

// Zonas de entrega agrupadas (~550 m), nunca direcciones exactas.
function MapaZonas({ zonas }) {
  const max = Math.max(...zonas.map((z) => Number(z.total)), 1);
  const centro = zonas.length ? [Number(zonas[0].lat), Number(zonas[0].lng)] : [-12.0464, -77.0428];
  return (
    <div className="tz-dt-mapa">
      <MapContainer center={centro} zoom={13} scrollWheelZoom={false} attributionControl={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
        <Encuadre zonas={zonas} />
        {zonas.map((z) => {
          const f = Number(z.total) / max;
          const color = f > 0.66 ? "#ff2f9e" : f > 0.33 ? "#ff9500" : "#2be8ff";
          return (
            <CircleMarker
              key={`${z.lat}:${z.lng}`}
              center={[Number(z.lat), Number(z.lng)]}
              radius={10 + f * 22}
              className="tz-dt-zona"
              pathOptions={{ color, fillColor: color, fillOpacity: 0.28 + f * 0.35, weight: 1.5, opacity: 0.85 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                {entero(z.total)} pedidos · {entero(z.entregadas)} entregados
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {!zonas.length && <div className="tz-dt-mapa-vacio">Sin entregas con ubicación en el periodo.</div>}
    </div>
  );
}

const ESTADOS_MEMBRESIA = [
  { key: "vigente", label: "Vigente", color: "#39ffb0" },
  { key: "por_vencer", label: "Por vencer", color: "#d7ff3b" },
  { key: "vencida", label: "Vencida", color: "#ff5470" },
  { key: "sin", label: "Sin membresía", color: "#9c93c2" },
];

function linkWhatsapp(numero, texto) {
  let d = String(numero || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 9) d = `51${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

function Avatar({ url }) {
  return url ? <img src={url} alt="" className="tz-dt-avatar" /> : <span className="tz-dt-avatar is-vacio"><Users size={14} /></span>;
}

// `conectadosAhora`: pasajeros con la app abierta en este momento
// (Presencia de Taxi-PE); solo lo pasa el admin de Taxi-PE.
export default function DashboardTaxi({ leer, titulo = "Taxi-PE", conectadosAhora = null }) {
  const [periodo, setPeriodo] = useState("mes");
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [grupoEstados, setGrupoEstados] = useState("conductores");
  const { desde, hasta } = useMemo(() => rango(periodo), [periodo]);

  const refrescar = useCallback(async () => {
    setCargando(true);
    let r;
    try {
      r = await leer(desde.toISOString(), hasta.toISOString());
    } catch (e) {
      r = { error: e };
    }
    setCargando(false);
    if (r?.error) return setError(r.error.message || "No se pudo leer el dashboard.");
    setError("");
    setDatos(r?.data || {});
  }, [leer, desde, hasta]);

  useEffect(() => {
    refrescar();
    const t = setInterval(refrescar, 120000);
    return () => clearInterval(t);
  }, [refrescar]);

  const serieDias = useMemo(() => {
    const mapa = new Map((datos?.serie_dias || []).map((d) => [d.dia, d]));
    const out = [];
    const fin = Math.min(hasta.getTime(), Date.now());
    for (let t = desde.getTime(); t < fin; t += MS_DIA) {
      const dia = diaLima(t + 1);
      const d = mapa.get(dia);
      out.push({ dia, viajes: Number(d?.viajes || 0), entregas: Number(d?.entregas || 0) });
    }
    return out;
  }, [datos, desde, hasta]);

  const serieIngresos = useMemo(() => {
    const mapa = new Map((datos?.serie_ingresos || []).map((d) => [d.mes, d]));
    const lima = new Date(Date.now() - LIMA);
    const out = [];
    for (let k = 5; k >= 0; k--) {
      const mes = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      const d = mapa.get(mes);
      out.push({ mes, conductores: Number(d?.conductores || 0), recolectores: Number(d?.recolectores || 0) });
    }
    return out;
  }, [datos]);

  const d = datos || {};
  const tasaBajas = d.base_bajas ? Math.round((Number(d.bajas || 0) / d.base_bajas) * 100) : 0;
  const estados = d[grupoEstados === "conductores" ? "estados_conductores" : "estados_recolectores"] || {};
  const entregasTot = Number(d.entregas_ok || 0) + Number(d.entregas_fallidas || 0);
  const exito = entregasTot ? Math.round((Number(d.entregas_ok || 0) / entregasTot) * 100) : 0;
  const topC = d.top_conductores || [];
  const topR = d.top_recolectores || [];
  const maxC = Math.max(...topC.map((t) => Number(t.viajes) + Number(t.entregas)), 1);
  const vencen = d.vencen || [];
  const zonas = d.zonas || [];

  return (
    <section className="tz-dt">
      <style>{ESTILO_PIEZAS + ESTILO}</style>
      <div className="tz-dt-cabecera">
        <h2 className="tz-dt-titulo"><BarChart3 size={17} /> {titulo}</h2>
        <div className="tz-dt-periodos" role="tablist">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={periodo === p.id}
              className={`tz-dt-periodo ${periodo === p.id ? "is-activo" : ""}`} onClick={() => setPeriodo(p.id)}>
              {p.label}
            </button>
          ))}
          {cargando && <Loader2 size={15} className="tz-spin tz-dt-cargando" />}
        </div>
      </div>
      {error && <p className="tz-dt-error">{error}</p>}

      <div className="tz-dt-kpis">
        <TarjetaDesglose
          i={0} icono={Wallet} titulo="Ingresos por membresías"
          nota={`${entero(d.membresias)} vendidas`}
          partes={[
            { key: "c", label: "Conductores", color: "#39ffb0", monto: Number(d.ingresos_conductores || 0),
              ant: Number(d.ingresos_conductores_ant || 0), cantidad: d.membresias_conductores ?? 0, detalle: "vendidas" },
            { key: "r", label: "Recolectores", color: "#d7ff3b", monto: Number(d.ingresos_recolectores || 0),
              ant: Number(d.ingresos_recolectores_ant || 0), cantidad: d.membresias_recolectores ?? 0, detalle: "vendidas" },
          ]}
        />
        <Kpi i={1} icono={Repeat} titulo="Ingreso mensual (MRR)" valor={d.mrr} anterior={d.mrr_ant} tono="cyan" nota="membresías vigentes" />
        <Kpi i={2} icono={UserMinus} titulo="Bajas del periodo" valor={d.bajas} formato={entero} tono="danger"
          nota={`${tasaBajas}% de las que estaban vigentes`} />
        <Kpi i={3} icono={Car} titulo="Viajes" valor={d.viajes} formato={entero} anterior={d.viajes_ant} tono="cyan"
          nota={`ganaron ${soles(d.ganado_viajes, 0)} · turnos cerrados`} />
        <Kpi i={4} icono={PackageCheck} titulo="Entregas completadas" valor={d.entregas_ok} formato={entero} anterior={d.entregas_ok_ant} tono="pink"
          nota={`${exito}% de éxito${d.entrega_minutos != null ? ` · ${d.entrega_minutos} min promedio` : ""}${d.entregas_en_curso ? ` · ${d.entregas_en_curso} en curso` : ""}`} />
        <Kpi i={5} icono={Radio} titulo="Conductores activos" valor={d.activos_periodo} formato={entero} anterior={d.activos_ant} tono="yellow"
          nota={`hoy ${entero(d.activos_hoy)} de ${entero(d.conductores_total)} · ${entero(d.horas_taxi)} h taxi · ${entero(d.horas_delivery)} h delivery`} />
        <Kpi i={6} icono={Users} titulo="Pasajeros activos" valor={d.pasajeros_activos} formato={entero} anterior={d.pasajeros_activos_ant} tono="green"
          nota={[
            conectadosAhora != null ? `${entero(conectadosAhora)} conectados ahora` : null,
            `hoy ${entero(d.pasajeros_hoy)} de ${entero(d.pasajeros_total)}`,
            `${entero(d.pasajeros_nuevos)} nuevos`,
          ].filter(Boolean).join(" · ")} />
      </div>

      <div className="tz-dt-fila is-ancha-primero">
        <div className="tz-dt-tarjeta">
          <h3>Viajes y entregas por día</h3>
          {serieDias.length ? <GraficoDias serie={serieDias} /> : <p className="tz-dt-vacio">Sin días en el periodo.</p>}
        </div>
        <div className="tz-dt-tarjeta">
          <h3>
            <PieChart size={15} /> Membresías
            <PestanasDp
              opciones={[{ id: "conductores", label: "Conductores" }, { id: "recolectores", label: "Recolectores" }]}
              valor={grupoEstados}
              onCambiar={setGrupoEstados}
            />
          </h3>
          <AnilloEstados
            sub={grupoEstados}
            items={ESTADOS_MEMBRESIA.map((e) => ({ ...e, valor: Number(estados[e.key] || 0) }))}
          />
        </div>
      </div>

      <div className="tz-dt-fila is-mitad">
        <div className="tz-dt-tarjeta">
          <h3>Membresías · 6 meses</h3>
          <GraficoIngresos serie={serieIngresos} />
        </div>
        <div className="tz-dt-tarjeta">
          <h3><Flame size={15} /> Horas pico</h3>
          <HorasPico datos={d.horas_pico} unidad="conductores" vacio="Sin conexiones en el periodo." />
        </div>
      </div>

      <div className="tz-dt-fila is-mitad">
        <div className="tz-dt-tarjeta">
          <h3><MapPinned size={15} /> Zonas de entrega</h3>
          <MapaZonas zonas={zonas} />
        </div>
        <div className="tz-dt-tarjeta">
          <h3><Crown size={15} /> Conductores con más servicios</h3>
          {topC.length === 0 ? <p className="tz-dt-vacio">Todavía no hay turnos cerrados en este periodo.</p> : (
            <ol className="tz-dt-lista">
              {topC.map((t, i) => (
                <li key={t.id} className={i === 0 ? "is-estrella" : ""} style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="tz-dt-pos">{i === 0 ? <Crown size={15} /> : i + 1}</span>
                  <Avatar url={t.foto_url} />
                  <span className="tz-dt-info">
                    <b>{t.nombre}</b>
                    <span className="tz-dt-pista"><span style={{ width: `${((Number(t.viajes) + Number(t.entregas)) / maxC) * 100}%`, animationDelay: `${i * 70 + 150}ms` }} /></span>
                  </span>
                  <span className="tz-dt-monto">{entero(t.viajes)} viajes · {entero(t.entregas)} entregas<small>ganó {soles(t.ganado)}</small></span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="tz-dt-fila is-mitad">
        <div className="tz-dt-tarjeta">
          <h3><Users size={15} /> Recolectores</h3>
          {topR.length === 0 ? <p className="tz-dt-vacio">Ningún recolector vendió membresías en este periodo.</p> : (
            <ol className="tz-dt-lista">
              {topR.map((t, i) => {
                const cupo = Number(t.cupo || 0);
                const usado = Number(t.usado || 0);
                return (
                  <li key={t.id} className={i === 0 ? "is-estrella" : ""} style={{ animationDelay: `${i * 70}ms` }}>
                    <span className="tz-dt-pos">{i === 0 ? <Crown size={15} /> : i + 1}</span>
                    <Avatar url={t.foto_url} />
                    <span className="tz-dt-info">
                      <b>{t.nombre}</b>
                      <span className="tz-dt-pista is-cupo"><span style={{ width: `${cupo ? Math.min(100, (usado / cupo) * 100) : 0}%`, animationDelay: `${i * 70 + 150}ms` }} /></span>
                      <small>cupo {entero(usado)} / {entero(cupo)}</small>
                    </span>
                    <span className="tz-dt-monto">{entero(t.conductores)} conductores<small>{soles(t.monto)}</small></span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="tz-dt-tarjeta">
          <h3><CalendarClock size={15} /> Membresías que vencen en 7 días</h3>
          {vencen.length === 0 ? <p className="tz-dt-vacio">Ninguna membresía vence esta semana.</p> : (
            <ul className="tz-dt-lista tz-dt-vencen">
              {vencen.map((n, i) => {
                const dias = Math.ceil((new Date(n.vence).getTime() - Date.now()) / MS_DIA);
                const wa = linkWhatsapp(
                  n.telefono,
                  `Hola ${n.nombre}, te recordamos que tu membresía de Taxi PE vence el ${fechaCorta(n.vence)}. Renuévala para seguir activo sin interrupciones.`
                );
                return (
                  <li key={`${n.tipo}:${n.id}`} className={dias <= 2 ? "is-urgente" : ""} style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="tz-dt-dias"><b>{dias}</b>{dias === 1 ? "día" : "días"}</span>
                    <span className="tz-dt-info">
                      <b>{n.nombre} <em className={`tz-dt-rol is-${n.tipo}`}>{n.tipo === "conductor" ? "Conductor" : "Recolector"}</em></b>
                      <small>{fechaCorta(n.vence)} · {n.paquete || "Sin paquete"}{n.precio != null ? ` · ${soles(n.precio)}` : ""}</small>
                    </span>
                    {wa && (
                      <a className="tz-dt-btn" href={wa} target="_blank" rel="noreferrer">
                        <MessageCircle size={14} /> Recordar
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="tz-dt-fila is-unica">
        <div className="tz-dt-tarjeta tz-dt-gemas">
          <h3><IconoGema color="verde" size={16} /> Gemas</h3>
          <div className="tz-dt-gema">
            <span>Ganadas por pasajeros</span>
            <strong>{entero(d.gemas_ganadas)}</strong>
            <small>{entero(d.gemas_usadas)} usadas en el periodo</small>
          </div>
          <div className="tz-dt-gema">
            <span>Canjeadas en membresías</span>
            <strong>{entero(d.gemas_canjeadas)}</strong>
            <small>{soles(d.gemas_canjeadas_soles)} que pone la plataforma</small>
          </div>
        </div>
      </div>
    </section>
  );
}

const ESTILO = `
.tz-dt { margin: 26px 0 18px; }
.tz-dt-cabecera { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.tz-dt-titulo { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; letter-spacing: .06em; text-transform: uppercase; color: var(--cyan); }
.tz-dt-periodos { display: inline-flex; align-items: center; gap: 4px; padding: 4px; border-radius: 999px; flex-wrap: wrap;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); }
.tz-dt-periodo { border: 0; background: transparent; color: var(--text-dim); font-weight: 700; font-size: 12.5px; padding: 7px 13px;
  border-radius: 999px; cursor: pointer; transition: color .25s ease, background .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease, transform .35s cubic-bezier(.34,1.56,.64,1); }
.tz-dt-periodo:hover { color: var(--text); transform: translateY(-1px); }
.tz-dt-periodo.is-activo { color: #06131a; background: linear-gradient(110deg, #2be8ff, #39ffb0); box-shadow: 0 0 16px rgba(43,232,255,0.45); }
.tz-dt-cargando { color: var(--cyan); margin: 0 6px; }
.tz-dt-error { color: var(--danger); font-size: 13px; }
.tz-dt-vacio { color: var(--text-dim); font-size: 13px; margin: 10px 0; }

.tz-dt-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 12px; }
.tz-dt-kpi { --t: 43,232,255; position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 4px; padding: 14px 14px 12px;
  border-radius: 18px; background: var(--panel); border: 1px solid rgba(var(--t), 0.28);
  box-shadow: 0 0 22px rgba(var(--t), 0.08), inset 0 1px 0 rgba(255,255,255,0.05);
  animation: tz-dt-in .6s cubic-bezier(.34,1.56,.64,1) both; transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease; }
.tz-dt-kpi:hover { transform: translateY(-3px); box-shadow: 0 0 28px rgba(var(--t), 0.25); }
.tz-dt-kpi::after { content: ""; position: absolute; inset: -40% -60%; pointer-events: none;
  background: linear-gradient(105deg, transparent 40%, rgba(var(--t), 0.16) 50%, transparent 60%); animation: tz-dt-brillo 5.5s ease-in-out infinite; }
.tz-dt-kpi.tono-green { --t: 57,255,176; }
.tz-dt-kpi.tono-pink { --t: 255,47,158; }
.tz-dt-kpi.tono-yellow { --t: 215,255,59; }
.tz-dt-kpi.tono-danger { --t: 255,84,112; }
.tz-dt-kpi-icono { width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; color: rgb(var(--t));
  background: rgba(var(--t), 0.12); box-shadow: 0 0 14px rgba(var(--t), 0.3); }
.tz-dt-kpi-titulo { font-size: 12px; font-weight: 700; color: var(--text-dim); letter-spacing: .03em; }
.tz-dt-kpi-valor { font-size: 24px; font-weight: 900; color: var(--text); font-variant-numeric: tabular-nums; text-shadow: 0 0 16px rgba(var(--t), 0.45); line-height: 1.15; }
.tz-dt-kpi-pie { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 20px; }
.tz-dt-kpi-nota { font-size: 11.5px; color: var(--text-dim); }
.tz-dt-fila { display: grid; gap: 12px; margin-bottom: 12px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.tz-dt-fila.is-ancha-primero { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
.tz-dt-fila.is-unica { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 760px) { .tz-dt-fila, .tz-dt-fila.is-ancha-primero { grid-template-columns: minmax(0, 1fr); } }
.tz-dt-tarjeta { padding: 14px; border-radius: 18px; background: var(--panel); border: 1px solid rgba(255,255,255,0.09); min-width: 0;
  animation: tz-dt-in .65s .1s cubic-bezier(.34,1.56,.64,1) both; }
.tz-dt-tarjeta h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 13px; font-weight: 800;
  letter-spacing: .06em; text-transform: uppercase; color: var(--text-dim); }

.tz-dt-leyenda-linea { display: flex; gap: 14px; font-size: 11.5px; color: var(--text-dim); margin-bottom: 4px; }
.tz-dt-leyenda-linea span { display: inline-flex; align-items: center; gap: 6px; }
.tz-dt-leyenda-linea i { width: 14px; height: 4px; border-radius: 4px; }
i.is-viajes { background: #2be8ff; box-shadow: 0 0 8px #2be8ff; }
i.is-entregas { background: #ff2f9e; box-shadow: 0 0 8px #ff2f9e; }
i.is-cond { background: #39ffb0; box-shadow: 0 0 8px #39ffb0; }
i.is-reco { background: #d7ff3b; box-shadow: 0 0 8px #d7ff3b; }
.tz-dt-grafico { position: relative; }
.tz-dt-grafico svg { width: 100%; height: auto; display: block; overflow: visible; }
.tz-dt-guia { stroke: rgba(255,255,255,0.07); stroke-dasharray: 3 5; }
.tz-dt-area { animation: tz-dt-fade 1.1s .35s ease both; }
.tz-dt-linea { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: tz-dt-trazo 1.4s cubic-bezier(.65,0,.35,1) forwards; }
.tz-dt-linea.is-viajes { stroke: #2be8ff; filter: drop-shadow(0 0 6px rgba(43,232,255,0.8)); }
.tz-dt-linea.is-entregas { stroke: #ff2f9e; filter: drop-shadow(0 0 6px rgba(255,47,158,0.8)); animation-delay: .2s; }
.tz-dt-cursor { stroke: rgba(255,255,255,0.18); stroke-dasharray: 2 4; }
.tz-dt-punto { stroke-width: 2; fill: var(--text); animation: tz-dt-pop .35s cubic-bezier(.34,1.56,.64,1) both; }
.tz-dt-punto.is-viajes { stroke: #2be8ff; filter: drop-shadow(0 0 6px #2be8ff); }
.tz-dt-punto.is-entregas { stroke: #ff2f9e; filter: drop-shadow(0 0 6px #ff2f9e); }
.tz-dt-eje { fill: var(--text-dim); font-size: 10px; }
.tz-dt-tip { position: absolute; transform: translate(-50%, calc(-100% - 12px)); pointer-events: none; white-space: nowrap;
  display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 10px; border-radius: 10px;
  background: var(--panel-solid); border: 1px solid rgba(43,232,255,0.45); box-shadow: 0 0 16px rgba(43,232,255,0.35);
  font-size: 11px; color: var(--text-dim); animation: tz-dt-pop .3s cubic-bezier(.34,1.56,.64,1) both;
  transition: left .25s cubic-bezier(.34,1.56,.64,1), top .25s cubic-bezier(.34,1.56,.64,1); }
.tz-dt-tip strong { font-size: 12.5px; }
.tz-dt-tip strong.is-viajes { color: #2be8ff; }
.tz-dt-tip strong.is-entregas { color: #ff2f9e; }

.tz-dt-barras { display: flex; align-items: stretch; gap: 8px; height: 200px; }
.tz-dt-barra { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; }
.tz-dt-barra-valor { font-size: 10px; color: var(--text-dim); white-space: nowrap; }
.tz-dt-barra-pista { flex: 1; width: 100%; max-width: 34px; display: flex; align-items: flex-end; border-radius: 10px; background: rgba(255,255,255,0.04); overflow: hidden; }
.tz-dt-barra-pila { width: 100%; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; transform-origin: bottom;
  animation: tz-dt-crece .9s cubic-bezier(.34,1.56,.64,1) both; }
.tz-dt-barra-pila .is-cond { background: linear-gradient(to top, rgba(57,255,176,0.35), #39ffb0); box-shadow: 0 0 14px rgba(57,255,176,0.5); flex-basis: 0; }
.tz-dt-barra-pila .is-reco { background: linear-gradient(to top, rgba(215,255,59,0.5), #d7ff3b); flex-basis: 0; }
.tz-dt-barra.is-actual .tz-dt-barra-pista { box-shadow: 0 0 16px rgba(43,232,255,0.35); outline: 1px solid rgba(43,232,255,0.4); }
.tz-dt-barra-mes { font-size: 11px; font-weight: 700; color: var(--text-dim); }
.tz-dt-barra.is-actual .tz-dt-barra-mes { color: var(--cyan); }

.tz-dt-mapa { position: relative; height: 260px; border-radius: 14px; overflow: hidden; border: 1px solid rgba(43,232,255,0.2); }
.tz-dt-mapa .leaflet-container { background: #0a0716; }
.tz-dt-zona { animation: tz-dt-zona 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes tz-dt-zona { 0%, 100% { filter: drop-shadow(0 0 4px currentColor); opacity: .85; } 50% { filter: drop-shadow(0 0 14px currentColor); opacity: 1; } }
.tz-dt-mapa-vacio { position: absolute; inset: 0; display: grid; place-items: center; z-index: 500; font-size: 13px; color: var(--text-dim);
  background: rgba(10,7,22,0.55); backdrop-filter: blur(2px); }

.tz-dt-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tz-dt-lista li { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 14px; flex-wrap: wrap;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  animation: tz-dt-in .5s cubic-bezier(.34,1.56,.64,1) both; transition: transform .3s cubic-bezier(.34,1.56,.64,1), border-color .3s ease; }
.tz-dt-lista li:hover { transform: translateX(3px); border-color: rgba(43,232,255,0.35); }
.tz-dt-lista li.is-estrella { border-color: rgba(215,255,59,0.5); background: rgba(215,255,59,0.06); box-shadow: 0 0 20px rgba(215,255,59,0.15); }
.tz-dt-pos { width: 24px; text-align: center; font-weight: 900; color: var(--text-dim); display: grid; place-items: center; }
.is-estrella .tz-dt-pos { color: #d7ff3b; filter: drop-shadow(0 0 6px #d7ff3b); animation: tz-dt-flota 2.4s ease-in-out infinite; }
.tz-dt-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(43,232,255,0.4); }
.tz-dt-avatar.is-vacio { display: grid; place-items: center; color: var(--text-dim); background: rgba(255,255,255,0.05); }
.tz-dt-info { flex: 1; min-width: 120px; display: flex; flex-direction: column; gap: 4px; }
.tz-dt-info b { font-size: 13.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tz-dt-info small, .tz-dt-monto small { font-weight: 600; font-size: 11px; color: var(--text-dim); }
.tz-dt-pista { height: 5px; border-radius: 99px; background: rgba(255,255,255,0.06); overflow: hidden; }
.tz-dt-pista span { display: block; height: 100%; border-radius: 99px; transform-origin: left;
  background: linear-gradient(90deg, #ff2f9e, #2be8ff); box-shadow: 0 0 10px rgba(43,232,255,0.5); animation: tz-dt-crece-x .9s cubic-bezier(.34,1.56,.64,1) both; }
.is-estrella .tz-dt-pista span { background: linear-gradient(90deg, #ff9500, #d7ff3b); }
.tz-dt-pista.is-cupo span { background: linear-gradient(90deg, #39ffb0, #d7ff3b); }
.tz-dt-monto { display: flex; flex-direction: column; align-items: flex-end; font-weight: 800; color: var(--text); font-size: 12.5px; white-space: nowrap; }
.tz-dt-dias { display: flex; flex-direction: column; align-items: center; min-width: 42px; font-size: 10px; color: var(--text-dim); }
.tz-dt-dias b { font-size: 20px; color: #d7ff3b; line-height: 1; text-shadow: 0 0 10px rgba(215,255,59,0.5); }
.tz-dt-vencen li.is-urgente { border-color: rgba(255,84,112,0.45); }
.tz-dt-vencen li.is-urgente .tz-dt-dias b { color: #ff5470; text-shadow: 0 0 10px rgba(255,84,112,0.6); animation: tz-dt-late-x 1.6s ease-in-out infinite; }
.tz-dt-rol { font-style: normal; font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 999px; margin-left: 4px; vertical-align: middle; }
.tz-dt-rol.is-conductor { color: #2be8ff; background: rgba(43,232,255,0.12); }
.tz-dt-rol.is-recolector { color: #d7ff3b; background: rgba(215,255,59,0.12); }
.tz-dt-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 700;
  text-decoration: none; color: #39ffb0; background: rgba(57,255,176,0.08); border: 1px solid rgba(57,255,176,0.4);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-dt-btn:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 0 14px rgba(57,255,176,0.45); }

.tz-dt-gemas { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.tz-dt-gemas h3 { grid-column: 1 / -1; }
.tz-dt-gema { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 14px;
  background: rgba(57,255,176,0.06); border: 1px solid rgba(57,255,176,0.25); }
.tz-dt-gema::after { content: ""; position: absolute; inset: -40% -60%; pointer-events: none;
  background: linear-gradient(105deg, transparent 42%, rgba(57,255,176,0.18) 50%, transparent 58%); animation: tz-dt-brillo 4.5s ease-in-out infinite; }
.tz-dt-gema span { font-size: 12px; color: var(--text-dim); font-weight: 700; }
.tz-dt-gema strong { font-size: 24px; color: #39ffb0; text-shadow: 0 0 14px rgba(57,255,176,0.6); }
.tz-dt-gema small { font-size: 11.5px; color: var(--text-dim); }

@keyframes tz-dt-in { from { opacity: 0; transform: translateY(12px) scale(.97); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-dt-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
@keyframes tz-dt-trazo { to { stroke-dashoffset: 0; } }
@keyframes tz-dt-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-dt-crece { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes tz-dt-crece-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes tz-dt-brillo { 0%, 70% { transform: translateX(-60%); } 100% { transform: translateX(60%); } }
@keyframes tz-dt-flota { 0%, 100% { transform: translateY(0) rotate(-6deg); } 50% { transform: translateY(-3px) rotate(6deg); } }
@keyframes tz-dt-late-x { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
`;
