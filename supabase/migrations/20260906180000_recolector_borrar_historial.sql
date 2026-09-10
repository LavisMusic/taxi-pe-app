-- Pedido: "un botón para directamente borrar su historial de su
-- interfaz, más no del historial independiente del admin" — un
-- recolector puede "vaciar" lo que ÉL ve en su propio Historial de
-- Ventas sin borrar ninguna fila real de `ventas` (el Admin sigue
-- viendo todo en su propio Historial, que no lee esta columna). Se
-- guarda solo un punto de corte por recolector — todo lo anterior a
-- esta fecha queda oculto en SU pantalla (ver HistorialVentasModal.jsx
-- `ocultarAntesDe` / RecolectorPage.jsx), nada se elimina de verdad.
alter table usuarios
  add column if not exists historial_ventas_oculto_desde timestamptz;
