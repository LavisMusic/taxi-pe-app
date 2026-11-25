// Motor 3D de Don Peje (three.js). Se carga solo cuando aparece la mascota
// (import dinámico): la app no paga este peso hasta entonces.
//
// El modelo (public/mascota/don-peje.glb, exportado de Tripo y optimizado
// con gltf-transform) no trae esqueleto ni animaciones: viene en 24 piezas.
// Acá se arma un "esqueleto" con grupos que giran en sus articulaciones
// (cuerpo, cuello, cabeza, cola y las 4 patas-rueda) y todas las
// animaciones son por código. La pantalla de la cara (tripo_part_9) lleva
// encima una cara dibujada en vivo: ojos que parpadean, emociones y boca que
// se mueve al hablar.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export const URL_MODELO = "/mascota/don-peje.glb";

// En desarrollo, un cambio en este motor recarga la página: si no, la escena
// ya creada seguía con el código viejo (la cara y la cola de antes).
if (import.meta.hot) import.meta.hot.decline();

// Piezas del modelo (frente = +z). Cada pata: hombro, segmento, rueda,
// centro de la rueda y tornillos. El centro de la rueda trasera derecha
// (part_8) viene pegado a la cola: se separa por altura.
const PIEZAS = {
  cuerpo: ["tripo_part_1"],
  cuello: ["tripo_part_20"],
  cabeza: ["tripo_part_2", "tripo_part_9"],
  pantalla: "tripo_part_9",
  // `ruedas`: las dos mitades de la goma de cada llanta (lo único que gira).
  patas: {
    DD: { hombro: "tripo_part_16", piezas: ["tripo_part_16", "tripo_part_5", "tripo_part_13", "tripo_part_11", "tripo_part_21"], ruedas: ["tripo_part_13", "tripo_part_11"] },
    DI: { hombro: "tripo_part_6", piezas: ["tripo_part_6", "tripo_part_15", "tripo_part_3", "tripo_part_12", "tripo_part_22", "tripo_part_24"], ruedas: ["tripo_part_3", "tripo_part_12"] },
    TD: { hombro: "tripo_part_19", piezas: ["tripo_part_19", "tripo_part_17", "tripo_part_4", "tripo_part_8", "tripo_part_23"], ruedas: ["tripo_part_4", "tripo_part_8"] },
    TI: { hombro: "tripo_part_18", piezas: ["tripo_part_18", "tripo_part_7", "tripo_part_14", "tripo_part_10"], ruedas: ["tripo_part_14", "tripo_part_10"] },
  },
  colaEn: "tripo_part_8",
};

// Altura (m) del centro sobre el que da la voltereta.
const ALTO_CENTRO = 0.45;
// Vueltas que dan las ruedas en la voltereta (entero: terminan como empezaron).
const VUELTAS_RUEDA = 5;

const suave = (actual, meta, k) => actual + (meta - actual) * k;
const campana = (p) => Math.sin(Math.PI * Math.min(Math.max(p, 0), 1));
const facil = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

// ---------------------------------------------------------------- la cara
function crearCara() {
  const lienzo = document.createElement("canvas");
  lienzo.width = 512;
  lienzo.height = 384;
  const ctx = lienzo.getContext("2d");
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 4;
  const estado = { emocion: "normal", parpadeo: 0, mirarX: 0, mirarY: 0, boca: 0 };

  const redondeado = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const dibujar = () => {
    const W = lienzo.width;
    const H = lienzo.height;
    // Fondo: apagado (la pantalla es vidrio oscuro; solo brilla la cara).
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const cian = "#5ff3ff";
    ctx.fillStyle = cian;
    ctx.strokeStyle = cian;
    ctx.lineCap = "round";
    // Los ojos van EXACTO donde el modelo tiene los suyos (medidos en su
    // textura original): óvalos altos al 22,5 % y 72,5 % del ancho, centro al
    // 53 % del alto. Mirar los mueve poco para no salirse del hueco.
    const ox = estado.mirarX * 10;
    const oy = estado.mirarY * 8;
    const anchoOjo = W * 0.2;
    const altoOjo = H * 0.4;
    const ojos = [W * 0.225 + ox, W * 0.725 + ox];
    const yOjo = H * 0.53 + oy;
    const abierto = 1 - estado.parpadeo;
    const e = estado.emocion;
    ojos.forEach((x, i) => {
      // Fondo del hueco siempre con luz tenue: nunca se ve como un agujero
      // negro, y la expresión brilla encima.
      ctx.save();
      ctx.shadowColor = "#2be8ff";
      ctx.shadowBlur = 18;
      ctx.globalAlpha = e === "dormido" ? 0.1 : 0.2;
      redondeado(x - anchoOjo / 2, yOjo - altoOjo / 2, anchoOjo, altoOjo, anchoOjo / 2);
      ctx.fill();
      ctx.restore();

      ctx.shadowColor = "#2be8ff";
      ctx.shadowBlur = 40;
      if (e === "dormido") {
        ctx.lineWidth = 22;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(x, yOjo - altoOjo * 0.1, anchoOjo * 0.42, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e === "feliz") {
        ctx.lineWidth = 30;
        ctx.beginPath();
        ctx.arc(x, yOjo + altoOjo * 0.18, anchoOjo * 0.44, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      } else if (e === "triste") {
        // Ojo caído: la mitad de abajo, con el borde de arriba inclinado.
        const s = i === 0 ? 1 : -1;
        const arriba = yOjo - altoOjo * 0.05;
        ctx.beginPath();
        ctx.moveTo(x - anchoOjo / 2, arriba + s * 18);
        ctx.lineTo(x + anchoOjo / 2, arriba - s * 18);
        ctx.lineTo(x + anchoOjo / 2, yOjo + altoOjo * 0.32);
        ctx.quadraticCurveTo(x, yOjo + altoOjo * 0.55, x - anchoOjo / 2, yOjo + altoOjo * 0.32);
        ctx.closePath();
        ctx.fill();
      } else if (e === "molesto") {
        // Ceño fruncido: el borde de arriba baja hacia el medio de la cara.
        const s = i === 0 ? -1 : 1;
        const arriba = yOjo - altoOjo * 0.18;
        ctx.beginPath();
        ctx.moveTo(x - anchoOjo / 2, arriba + s * 26);
        ctx.lineTo(x + anchoOjo / 2, arriba - s * 26);
        ctx.lineTo(x + anchoOjo / 2, yOjo + altoOjo * 0.3);
        ctx.quadraticCurveTo(x, yOjo + altoOjo * 0.5, x - anchoOjo / 2, yOjo + altoOjo * 0.3);
        ctx.closePath();
        ctx.fill();
      } else if (e === "guino" && i === 1) {
        ctx.lineWidth = 24;
        ctx.beginPath();
        ctx.moveTo(x - anchoOjo * 0.42, yOjo);
        ctx.lineTo(x + anchoOjo * 0.42, yOjo);
        ctx.stroke();
      } else {
        // Ojo lleno (el hueco entero); al parpadear se cierra hacia el medio.
        const ancho = anchoOjo * (e === "sorpresa" ? 1.08 : 1);
        const alto = altoOjo * (e === "sorpresa" ? 1.06 : 1) * Math.max(abierto, 0.06);
        redondeado(x - ancho / 2, yOjo - alto / 2, ancho, alto, Math.min(ancho / 2, alto / 2));
        ctx.fill();
        if (abierto > 0.5) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(255,255,255,.8)";
          redondeado(x + ancho * 0.08, yOjo - alto * 0.34, ancho * 0.24, alto * 0.16, 10);
          ctx.fill();
          ctx.restore();
        }
      }
    });
    // Boca: solo al hablar (sigue el volumen) o al sorprenderse, debajo de
    // los ojos.
    const boca = e === "sorpresa" ? 0.6 : estado.boca;
    if (boca > 0.04) {
      const bw = 56 + boca * 26;
      const bh = 8 + boca * 34;
      redondeado(W / 2 - bw / 2 + ox * 0.5, H * 0.86 - bh / 2, bw, bh, Math.min(bh / 2, 22));
      ctx.fill();
    } else if (e === "molesto") {
      // Refunfuña: boca en zigzag.
      ctx.lineWidth = 9;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const bx = W / 2 - 48 + k * 16 + ox * 0.5;
        const by = H * 0.86 + (k % 2 ? -7 : 7);
        if (k) ctx.lineTo(bx, by);
        else ctx.moveTo(bx, by);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    textura.needsUpdate = true;
  };
  dibujar();
  return { textura, estado, dibujar };
}

// ------------------------------------------------------------- separar piezas
// Saca de una malla los triángulos cuyo centro (en el mundo) cumple
// `criterio(x, y, z)` y los devuelve como otra malla (Tripo pegó la cola y
// una placa del lomo a la rueda trasera derecha).
function separar(malla, criterio) {
  const geo = malla.geometry;
  const pos = geo.attributes.position;
  const indice = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const v = new THREE.Vector3();
  malla.updateWorldMatrix(true, false);
  const mundo = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(malla.matrixWorld);
  const arriba = [];
  const abajo = [];
  for (let t = 0; t < indice.length; t += 3) {
    const a = indice[t];
    const b = indice[t + 1];
    const c = indice[t + 2];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const k of [a, b, c]) {
      mundo(k);
      x += v.x / 3;
      y += v.y / 3;
      z += v.z / 3;
    }
    (criterio(x, y, z) ? arriba : abajo).push(a, b, c);
  }
  if (!arriba.length) return null;
  const geoArriba = geo.clone();
  geoArriba.setIndex(arriba);
  geo.setIndex(abajo);
  const cola = new THREE.Mesh(geoArriba, malla.material);
  cola.position.copy(malla.position);
  cola.quaternion.copy(malla.quaternion);
  cola.scale.copy(malla.scale);
  malla.parent.add(cola);
  return cola;
}

// Grupo-articulación en `punto` (mundo) dentro de `padre`; adopta `hijos`
// sin moverlos (attach conserva su posición en el mundo).
function articulacion(padre, punto, hijos) {
  const g = new THREE.Group();
  padre.updateWorldMatrix(true, true);
  g.position.copy(padre.worldToLocal(punto.clone()));
  padre.add(g);
  g.updateWorldMatrix(true, false);
  hijos.filter(Boolean).forEach((h) => g.attach(h));
  return g;
}

export async function crearDonPeje(canvas, { url = URL_MODELO } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setClearColor(0x000000, 0);

  const escena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  escena.environment = entorno;
  escena.add(new THREE.HemisphereLight(0xdff6ff, 0x221a3a, 1.1));
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  sol.position.set(1.5, 3, 3);
  escena.add(sol);
  const borde = new THREE.DirectionalLight(0x2be8ff, 1.6);
  borde.position.set(-2, 1.5, -2);
  escena.add(borde);

  // Encuadre con aire arriba para los saltos (el lienzo es más alto que ancho).
  const camara = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  camara.position.set(0.5, 1.0, 3.3);
  camara.lookAt(0, 0.62, 0);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const modelo = gltf.scene;
  const raiz = new THREE.Group(); // se mueve, salta y gira
  escena.add(raiz);
  // Volteretas: gira sobre su centro (a media altura) y no desde las patas.
  const volteo = new THREE.Group();
  volteo.position.y = ALTO_CENTRO;
  raiz.add(volteo);
  volteo.add(modelo);
  modelo.position.y -= ALTO_CENTRO;
  modelo.updateWorldMatrix(true, true);

  const nodo = (n) => modelo.getObjectByName(n);
  const centro = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());

  // De la rueda trasera derecha salen la colita (angosta, arriba y atrás;
  // medida por franjas de altura) y la placa negra del lomo (va con el
  // cuerpo). La rueda se queda con lo de abajo.
  let colaMalla = null;
  let placaMalla = null;
  {
    let m = null;
    nodo(PIEZAS.colaEn)?.traverse((o) => {
      if (o.isMesh && !m) m = o;
    });
    if (m) {
      colaMalla = separar(m, (x, y, z) => y >= 0.615 && Math.abs(x) < 0.05 && z < -0.1);
      placaMalla = separar(m, (x, y) => y > 0.43);
    }
  }

  // Esqueleto.
  const cuerpo = articulacion(modelo, new THREE.Vector3(0, 0.36, 0), [...PIEZAS.cuerpo.map(nodo), placaMalla, colaMalla]);
  const patas = {};
  Object.entries(PIEZAS.patas).forEach(([id, p]) => {
    const hombro = nodo(p.hombro);
    patas[id] = articulacion(cuerpo, centro(hombro), p.piezas.map(nodo));
  });
  const cuello = articulacion(cuerpo, new THREE.Vector3(0, 0.5, 0.15), PIEZAS.cuello.map(nodo));
  const cabeza = articulacion(cuello, new THREE.Vector3(0, 0.66, 0.12), PIEZAS.cabeza.map(nodo));
  // Cola: no gira entera (se veía cortada: la base quedaba quieta y solo la
  // punta se movía). Se DOBLA: quieta en la raíz y cada vez más hacia la
  // punta, sin cortes.
  let doblarCola = null;
  if (colaMalla) {
    colaMalla.updateWorldMatrix(true, false);
    const geo = colaMalla.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const usados = geo.index ? [...new Set(geo.index.array)] : Array.from({ length: pos.count }, (_, i) => i);
    const M = colaMalla.matrixWorld;
    const inv = M.clone().invert();
    const w = new THREE.Vector3();
    const mundo = usados.map((i) => w.fromBufferAttribute(pos, i).applyMatrix4(M).clone());
    const y0 = Math.min(...mundo.map((p) => p.y));
    const y1 = Math.max(...mundo.map((p) => p.y));
    const raizCola = new THREE.Vector3();
    const base = mundo.filter((p) => p.y < y0 + 0.02);
    base.forEach((p) => raizCola.add(p));
    raizCola.divideScalar(base.length || 1).applyMatrix4(inv);
    const eje = new THREE.Vector3(0, 1, 0).transformDirection(inv);
    const orig = usados.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).sub(raizCola));
    const origN = nor ? usados.map((i) => new THREE.Vector3().fromBufferAttribute(nor, i)) : null;
    const peso = mundo.map((p) => {
      const t = Math.min(Math.max((p.y - y0) / (y1 - y0 || 1), 0), 1);
      return t * t * (3 - 2 * t);
    });
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    colaMalla.frustumCulled = false;
    doblarCola = (ang) => {
      for (let k = 0; k < usados.length; k++) {
        const i = usados[k];
        q.setFromAxisAngle(eje, ang * peso[k]);
        v.copy(orig[k]).applyQuaternion(q).add(raizCola);
        pos.setXYZ(i, v.x, v.y, v.z);
        if (origN) {
          v.copy(origN[k]).applyQuaternion(q);
          nor.setXYZ(i, v.x, v.y, v.z);
        }
      }
      pos.needsUpdate = true;
      if (nor) nor.needsUpdate = true;
    };
  }
  // Ruedas: cada llanta viene en DOS piezas (las dos mitades de la goma) y
  // gira entera sobre su eje (de costado, x), con el centro medido de las
  // dos juntas. Los brazos y tornillos que la sostienen no se mueven.
  const cajaUsada = (objs) => {
    const caja = new THREE.Box3();
    const v = new THREE.Vector3();
    objs.filter(Boolean).forEach((o) =>
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.updateWorldMatrix(true, false);
        const pos = m.geometry.attributes.position;
        const idx = m.geometry.index;
        const n = idx ? idx.count : pos.count;
        for (let k = 0; k < n; k++) caja.expandByPoint(v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld));
      })
    );
    return caja;
  };
  const ruedas = Object.entries(PIEZAS.patas)
    .map(([id, p]) => {
      const piezas = p.ruedas.map(nodo).filter(Boolean);
      if (!piezas.length) return null;
      return articulacion(patas[id], cajaUsada(piezas).getCenter(new THREE.Vector3()), piezas);
    })
    .filter(Boolean);

  // LEDs: todo lo azul de la textura del robot (costados, espalda, ruedas,
  // orejas) brilla. Se arma una máscara emisiva con solo esos píxeles.
  const materialesLed = [];
  {
    const vistos = new Set();
    modelo.traverse((o) => {
      const mat = o.isMesh ? o.material : null;
      const img = mat?.map?.image;
      if (!mat || !img || vistos.has(mat)) return;
      vistos.add(mat);
      try {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const datos = ctx.getImageData(0, 0, c.width, c.height);
        const p = datos.data;
        for (let i = 0; i < p.length; i += 4) {
          const r = p[i];
          const g = p[i + 1];
          const b = p[i + 2];
          const led = b > 120 && b > r + 50 && g > 70 && g > r + 20;
          if (!led) {
            p[i] = 0;
            p[i + 1] = 0;
            p[i + 2] = 0;
          } else {
            // Más vivo: lleva el color hacia el cian de la marca.
            p[i] = Math.min(255, r * 0.6);
            p[i + 1] = Math.min(255, g * 1.15);
            p[i + 2] = 255;
          }
        }
        ctx.putImageData(datos, 0, 0);
        const mascara = new THREE.CanvasTexture(c);
        mascara.flipY = mat.map.flipY;
        mascara.colorSpace = THREE.SRGBColorSpace;
        mat.emissiveMap = mascara;
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveIntensity = 1.6;
        mat.needsUpdate = true;
        materialesLed.push(mat);
      } catch {
        /* sin canvas: sin LEDs */
      }
    });
  }

  // Cara en vivo SOBRE la pantalla del modelo (sigue su curva): la pieza
  // recibe coordenadas de textura proyectadas de frente y un material de
  // vidrio oscuro cuya luz (emisiva) es la cara dibujada.
  const cara = crearCara();
  const pantalla = nodo(PIEZAS.pantalla);
  pantalla?.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const ancho = bb.max.x - bb.min.x || 1;
    const alto = bb.max.y - bb.min.y || 1;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - bb.min.x) / ancho;
      uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / alto;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    o.material = new THREE.MeshStandardMaterial({
      color: 0x060a12,
      roughness: 0.18,
      metalness: 0.2,
      emissive: 0xffffff,
      emissiveMap: cara.textura,
      emissiveIntensity: 1.7,
    });
  });

  // ------------------------------------------------------------ animación
  const base = {
    cuerpoY: cuerpo.position.y,
    raizY: 0,
    hombros: Object.fromEntries(Object.entries(patas).map(([k, g]) => [k, g.rotation.clone()])),
  };
  const meta = { mirarX: 0, mirarY: 0, giro: 0.35, hablar: 0, emocion: "normal", dormido: false };
  const vivo = { mirarX: 0, mirarY: 0, giro: 0.35, boca: 0, sueno: 0 };
  let accion = null; // { nombre, inicio, dur, alTerminar, fuerza }
  let pendiente = null; // lo que llegó en plena voltereta (se hace al caer)
  let proximoParpadeo = performance.now() + 2000;
  let parpadeoInicio = 0;
  let cuadro = 0;
  let pausado = false;
  let ultimoToque = 0;
  let toques = 0;

  const hacer = (nombre, alTerminar) => {
    // En el aire no se corta la voltereta: lo demás espera a que caiga.
    if (accion?.nombre === "voltereta") {
      if (nombre !== "voltereta" && nombre !== "molesto") pendiente = { nombre, alTerminar };
      return;
    }
    const ahora = performance.now();
    const dur =
      { saltar: 900, saludar: 1700, celebrar: 1900, asentir: 650, negar: 750, sorpresa: 900, senalar: 1500, aterrizar: 500, despertar: 1100, molesto: 1100, voltereta: 1600 }[nombre] || 800;
    // Tocarlo seguido lo molesta cada vez más (sacude más fuerte).
    let fuerza = 1;
    if (nombre === "molesto") {
      toques = ahora - ultimoToque < 2500 ? toques + 1 : 1;
      ultimoToque = ahora;
      fuerza = Math.min(1 + (toques - 1) * 0.25, 1.75);
    }
    accion = { nombre, inicio: ahora, dur, alTerminar, fuerza };
    if (nombre === "celebrar" || nombre === "saludar" || nombre === "voltereta") cara.estado.emocion = "feliz";
    if (nombre === "sorpresa") cara.estado.emocion = "sorpresa";
    if (nombre === "molesto") cara.estado.emocion = "molesto";
  };

  const reloj = new THREE.Clock();
  const pintar = () => {
    if (pausado) return;
    cuadro = requestAnimationFrame(pintar);
    const t = reloj.getElapsedTime();
    const ahora = performance.now();

    // Valores que siguen a su meta con suavidad.
    vivo.mirarX = suave(vivo.mirarX, meta.mirarX, 0.08);
    vivo.mirarY = suave(vivo.mirarY, meta.mirarY, 0.08);
    vivo.giro = suave(vivo.giro, meta.giro, 0.07);
    vivo.boca = suave(vivo.boca, meta.hablar, 0.35);
    vivo.sueno = suave(vivo.sueno, meta.dormido ? 1 : 0, 0.04);

    // Reposo: respira, mueve la cola, mira.
    let raizY = 0;
    let cuerpoX = Math.sin(t * 1.6) * 0.015;
    let cuerpoZ = 0;
    let cuerpoY = Math.sin(t * 2.2) * 0.006;
    let cabezaX = -vivo.mirarY * 0.25 + Math.sin(t * 1.3) * 0.03;
    let cabezaY = vivo.mirarX * 0.45;
    let cabezaZ = Math.sin(t * 0.9) * 0.04;
    let colaVel = 7;
    let colaAmp = 0.35;
    let giroExtra = 0;
    let volteoX = 0;
    let ruedaAng = 0;
    const patasRot = { DD: [0, 0], DI: [0, 0], TD: [0, 0], TI: [0, 0] }; // [x, z]

    if (accion) {
      const p = Math.min((ahora - accion.inicio) / accion.dur, 1);
      const n = accion.nombre;
      if (n === "saltar") {
        if (p < 0.22) {
          const q = p / 0.22;
          raizY = -0.05 * facil(q);
          cuerpoX = 0.15 * q;
        } else if (p < 0.72) {
          const q = (p - 0.22) / 0.5;
          raizY = 0.32 * campana(q);
          cuerpoX = 0.15 - 0.3 * q;
          Object.keys(patasRot).forEach((k) => (patasRot[k][0] = (k[0] === "D" ? -0.5 : 0.5) * campana(q)));
        } else {
          const q = (p - 0.72) / 0.28;
          raizY = -0.04 * campana(q);
          cuerpoX = -0.15 * (1 - q);
        }
        colaVel = 16;
      } else if (n === "aterrizar") {
        raizY = -0.04 * campana(p);
      } else if (n === "saludar") {
        const q = campana(p);
        patasRot.DD[0] = -1.35 * q;
        patasRot.DD[1] = Math.sin(p * Math.PI * 6) * 0.35 * q;
        cuerpoZ = 0.1 * q;
        cabezaZ = -0.18 * q;
        colaVel = 14;
      } else if (n === "senalar") {
        const q = campana(p);
        patasRot.DD[0] = -1.0 * q;
        cabezaY = 0.45 * q;
        cuerpoZ = -0.05 * q;
      } else if (n === "celebrar") {
        raizY = 0.2 * Math.abs(Math.sin(p * Math.PI * 2));
        giroExtra = p * Math.PI * 2;
        patasRot.DD[0] = -0.9 * campana(p);
        patasRot.DI[0] = -0.9 * campana(p);
        colaVel = 22;
        colaAmp = 0.55;
      } else if (n === "asentir") {
        cabezaX += 0.28 * Math.sin(p * Math.PI * 3) * (1 - p);
      } else if (n === "negar") {
        cabezaY += 0.4 * Math.sin(p * Math.PI * 4) * (1 - p);
      } else if (n === "despertar") {
        // Se estira: levanta la cabeza, sacude y abre los ojos.
        const q = campana(p);
        cabezaX -= 0.35 * q;
        cabezaZ += Math.sin(p * Math.PI * 5) * 0.18 * (1 - p);
        raizY = 0.06 * q;
        patasRot.DD[0] = -0.5 * q;
        patasRot.DI[0] = -0.5 * q;
        colaVel = 18;
      } else if (n === "sorpresa") {
        raizY = 0.08 * campana(Math.min(p * 2, 1));
        cuerpoX = -0.2 * campana(p);
      } else if (n === "molesto") {
        // Se echa para atrás, refunfuña y sacude la cabeza como quien se
        // quita algo de encima.
        const f = accion.fuerza || 1;
        const q = 1 - p;
        cuerpoX = -0.14 * campana(Math.min(p * 3, 1)) * f;
        cuerpoZ = Math.sin(p * Math.PI * 9) * 0.05 * q * f;
        raizY = 0.035 * campana(Math.min(p * 4, 1));
        cabezaX -= 0.12 * campana(p);
        cabezaY += Math.sin(p * Math.PI * 7) * 0.38 * q * f;
        cabezaZ += Math.sin(p * Math.PI * 7 + 1) * 0.22 * q * f;
        patasRot.DI[0] = -0.3 * campana(Math.min(p * 2.5, 1)); // pisotón
        colaVel = 30;
        colaAmp = 0.18;
      } else if (n === "voltereta") {
        // Ruedas: 5 vueltas exactas (aceleran al impulsarse y frenan al
        // caer), así terminan justo como empezaron. Brazos y patas quietos.
        const avance = p < 0.32 ? 0.25 * (p / 0.32) ** 2 : 0.25 + 0.75 * (1 - (1 - (p - 0.32) / 0.68) ** 2);
        ruedaAng = avance * VUELTAS_RUEDA * Math.PI * 2;
        if (p < 0.32) {
          // Se impulsa: se agacha y acelera las ruedas.
          const q = p / 0.32;
          raizY = -0.06 * facil(q);
          cuerpoX = -0.12 * facil(q) + Math.sin(q * Math.PI * 8) * 0.02 * q;
          cabezaX -= 0.15 * q;
        } else if (p < 0.84) {
          // En el aire: vuelta completa hacia atrás.
          const q = (p - 0.32) / 0.52;
          raizY = 0.42 * campana(q);
          volteoX = -Math.PI * 2 * facil(q);
          colaVel = 20;
        } else {
          // Cae y amortigua.
          const q = (p - 0.84) / 0.16;
          raizY = -0.06 * campana(q);
          cuerpoX = 0.1 * campana(q);
        }
      }
      if (p >= 1) {
        const fin = accion.alTerminar;
        accion = null;
        if (cara.estado.emocion !== meta.emocion) cara.estado.emocion = meta.emocion;
        fin?.();
        if (pendiente) {
          const sig = pendiente;
          pendiente = null;
          hacer(sig.nombre, sig.alTerminar);
        }
      }
    }

    // Dormido: cabeza gacha, cuerpo bajo, respira lento y la cola quieta.
    if (vivo.sueno > 0.001) {
      const s = vivo.sueno;
      raizY -= 0.05 * s;
      cuerpoX = cuerpoX * (1 - s) + (0.07 + Math.sin(t * 0.9) * 0.025) * s;
      cuerpoY = cuerpoY * (1 - s) + Math.sin(t * 0.9) * 0.012 * s;
      cabezaX = cabezaX * (1 - s) + (0.42 + Math.sin(t * 0.9) * 0.03) * s;
      cabezaY *= 1 - s;
      cabezaZ = cabezaZ * (1 - s) + 0.12 * s;
      colaAmp *= 1 - s * 0.85;
      colaVel = colaVel * (1 - s) + 1.5 * s;
    }
    raiz.position.y = base.raizY + raizY;
    raiz.rotation.y = vivo.giro + giroExtra;
    volteo.rotation.x = volteoX;
    ruedas.forEach((r) => (r.rotation.x = ruedaAng));
    cuerpo.position.y = base.cuerpoY + cuerpoY;
    cuerpo.rotation.x = cuerpoX;
    cuerpo.rotation.z = cuerpoZ;
    cabeza.rotation.set(cabezaX, cabezaY, cabezaZ);
    Object.entries(patas).forEach(([k, g]) => {
      g.rotation.x = base.hombros[k].x + patasRot[k][0];
      g.rotation.z = base.hombros[k].z + patasRot[k][1];
    });
    doblarCola?.(Math.sin(t * colaVel) * colaAmp);
    // LEDs que respiran (más suaves dormido).
    const pulso = (1.45 + Math.sin(t * 2.2) * 0.35) * (1 - vivo.sueno * 0.6);
    materialesLed.forEach((m) => {
      m.emissiveIntensity = pulso;
    });

    // Parpadeo.
    if (ahora > proximoParpadeo) {
      parpadeoInicio = ahora;
      proximoParpadeo = ahora + 2200 + Math.random() * 3200;
    }
    const pp = (ahora - parpadeoInicio) / 160;
    cara.estado.parpadeo = !meta.dormido && pp >= 0 && pp <= 1 ? campana(pp) : 0;
    cara.estado.mirarX = vivo.mirarX;
    cara.estado.mirarY = vivo.mirarY;
    cara.estado.boca = vivo.boca;
    const emo = meta.dormido ? "dormido" : meta.emocion;
    if (!accion && cara.estado.emocion !== emo) cara.estado.emocion = emo;
    cara.dibujar();

    renderer.render(escena, camara);
  };

  const redimensionar = (w, h) => {
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  };
  redimensionar(canvas.clientWidth || 200, canvas.clientHeight || 200);
  pintar();

  // Sin pestaña visible no se dibuja (ahorra batería).
  const alCambiarVisibilidad = () => {
    if (document.hidden) {
      pausado = true;
      cancelAnimationFrame(cuadro);
    } else if (pausado) {
      pausado = false;
      pintar();
    }
  };
  document.addEventListener("visibilitychange", alCambiarVisibilidad);

  return {
    hacer,
    // -1..1: hacia dónde mira (pantalla).
    mirar: (x, y) => {
      meta.mirarX = Math.max(-1, Math.min(1, x));
      meta.mirarY = Math.max(-1, Math.min(1, y));
    },
    // Hacia dónde mira el cuerpo: >0 a la derecha de la pantalla.
    girar: (rad) => {
      meta.giro = rad;
    },
    hablar: (nivel) => {
      meta.hablar = Math.max(0, Math.min(1, nivel));
    },
    emocion: (e) => {
      meta.emocion = e || "normal";
    },
    dormir: (si) => {
      meta.dormido = !!si;
    },
    redimensionar,
    destruir: () => {
      pausado = true;
      cancelAnimationFrame(cuadro);
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      escena.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          const m = o.material;
          (Array.isArray(m) ? m : [m]).forEach((x) => {
            x?.map?.dispose();
            x?.dispose?.();
          });
        }
      });
      entorno.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
