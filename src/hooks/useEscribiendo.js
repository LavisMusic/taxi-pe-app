import { useCallback, useEffect, useRef, useState } from "react";

// Indicador de "escribiendo…" (los tres puntitos) entre los dos lados de
// un chat — mismo archivo en Taxi-PE y Caja Tonazo. Va por un canal
// Broadcast propio de esa conversación (`escribiendo-<clave>`), sin tocar
// la base: los dos lados tienen que usar la MISMA clave (antes el chat de
// viajes mandaba el aviso por un canal con un código distinto en cada
// ventana y nunca le llegaba al otro).
//
// `cliente`: el cliente de Supabase donde viven los dos lados (en Caja, el
// chat del repartidor usa el de Taxi-PE). `miRol`: para no mostrarme a mí
// mismo. Devuelve { escribiendo (rol del otro o null), avisar, apagar }.
const VISIBLE_MS = 2500; // sin un aviso nuevo en este lapso, se apaga
const CADA_MS = 1500; // un aviso cada tanto mientras se teclea, no por tecla

// Un solo canal por conversación aunque varias partes de la app lo usen a
// la vez: `cliente.channel(nombre)` devuelve el canal ya suscrito si el
// nombre existe, y agregarle oyentes después de suscribirlo falla.
const canalesPorCliente = new WeakMap();

function unirse(cliente, nombre, oyente) {
  let canales = canalesPorCliente.get(cliente);
  if (!canales) {
    canales = new Map();
    canalesPorCliente.set(cliente, canales);
  }
  let entrada = canales.get(nombre);
  if (!entrada) {
    const oyentes = new Set();
    const canal = cliente
      .channel(nombre)
      .on("broadcast", { event: "escribiendo" }, ({ payload }) => oyentes.forEach((fn) => fn(payload)))
      .subscribe();
    entrada = { canal, oyentes };
    canales.set(nombre, entrada);
  }
  entrada.oyentes.add(oyente);
  return () => {
    entrada.oyentes.delete(oyente);
    if (entrada.oyentes.size === 0) {
      canales.delete(nombre);
      cliente.removeChannel(entrada.canal);
    }
  };
}

export function useEscribiendo(cliente, clave, miRol) {
  const [escribiendo, setEscribiendo] = useState(null);
  const ultimoRef = useRef(0);
  const apagarRef = useRef(null);
  const nombre = clave ? `escribiendo-${clave}` : null;

  useEffect(() => {
    if (!cliente || !nombre) return undefined;
    const salir = unirse(cliente, nombre, (payload) => {
      if (!payload || (miRol && payload.rol === miRol)) return;
      setEscribiendo(payload.rol || "otro");
      clearTimeout(apagarRef.current);
      apagarRef.current = setTimeout(() => setEscribiendo(null), VISIBLE_MS);
    });
    return () => {
      clearTimeout(apagarRef.current);
      setEscribiendo(null);
      salir();
    };
  }, [cliente, nombre, miRol]);

  const avisar = useCallback(() => {
    if (!cliente || !nombre) return;
    const ahora = Date.now();
    if (ahora - ultimoRef.current < CADA_MS) return;
    ultimoRef.current = ahora;
    const entrada = canalesPorCliente.get(cliente)?.get(nombre);
    entrada?.canal.send({ type: "broadcast", event: "escribiendo", payload: { rol: miRol } }).catch(() => {});
  }, [cliente, nombre, miRol]);

  // Llegó un mensaje del otro: los puntitos ya cumplieron.
  const apagar = useCallback(() => {
    clearTimeout(apagarRef.current);
    setEscribiendo(null);
  }, []);

  return { escribiendo, avisar, apagar };
}

