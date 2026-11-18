// Service worker: notificaciones emergentes (Web Push) de los chats
// y de los anuncios publicados. Muestra el aviso que manda la Edge Function
// push-enviar y, al tocarlo, abre (o enfoca) la app con ese chat abierto o
// con ESE anuncio primero (seguido de los demás).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(datos.title || "Taxi PE", {
      body: datos.body || "Tienes un mensaje nuevo.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: datos.tag,
      data: { url: datos.url || "/", canal: datos.canal || null, anuncio: datos.anuncio || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, canal, anuncio } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const ventana of ventanas) {
        if ("focus" in ventana) {
          await ventana.focus();
          // Anuncio: si la app está en otra pantalla, se va a la que lo muestra.
          if (anuncio && url && "navigate" in ventana) {
            const destino = new URL(url, self.location.origin);
            if (new URL(ventana.url).pathname !== destino.pathname) {
              await ventana.navigate(destino.href);
              return;
            }
          }
          ventana.postMessage(anuncio ? { tipo: "abrir-anuncio", id: anuncio } : { tipo: "abrir-mensajes", canal });
          return;
        }
      }
      await self.clients.openWindow(url || "/");
    })()
  );
});
