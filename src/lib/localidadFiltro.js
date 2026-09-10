// Clave compartida del filtro de localidad de la Home (HomePage.jsx) —
// vive acá en vez de duplicada como string suelto porque un segundo
// lugar además necesita ESCRIBIRLA: el registro exprés de Pasajero
// (PasajeroAuthForm.jsx) deja elegir su localidad al registrarse, y esa
// elección debe "fijarse" en el mismo filtro que ya usa la Home para
// acotar el Directorio/Radar — sin esto, el pasajero recién registrado
// aterriza en "/" viendo todas las localidades mezcladas, teniendo que
// volver a elegir la que ya había dicho un segundo antes.
export const LOCALIDAD_FILTRO_STORAGE_KEY = "tz_localidad_filtro";

export function guardarLocalidadFiltro(nombre) {
  if (!nombre) return;
  try {
    window.localStorage.setItem(LOCALIDAD_FILTRO_STORAGE_KEY, nombre);
  } catch {
    // no-op — en el peor caso, la Home simplemente arranca sin ningún
    // filtro preseleccionado, como si esto no existiera.
  }
}
