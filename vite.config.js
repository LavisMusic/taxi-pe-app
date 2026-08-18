import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  // basicSsl + host:true: para probar la cámara (ComprobanteScannerModal,
  // getUserMedia) desde el celular en la misma WiFi. El navegador solo
  // permite cámara en un "contexto seguro" — localhost cuenta como
  // seguro automáticamente, pero la IP de la LAN (192.168.x.x) NO, salvo
  // que el sitio sea https. El certificado es autofirmado: el celular va
  // a mostrar una advertencia la primera vez, hay que aceptarla a mano
  // (ver instrucciones aparte) — es awaited, no un bug.
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
})
