#!/usr/bin/env bash
# Guarda la llave secreta NUEVA de Caja Tonazo (sb_secret_…) en las Edge
# Functions de Caja y las vuelve a desplegar para que la usen (en lugar
# de la service_role vieja, que se filtró). Pide la llave escondida: no se
# ve en pantalla ni queda escrita en ningún archivo.
#
# Después de correrlo y probar que Caja funciona, revocar la llave
# "Previous" en Supabase → Project Settings → JWT Keys.
#
# Uso (Git Bash):  bash scripts/configurar-llave-secreta-caja.sh
set -euo pipefail

CAJA_DIR="/e/CAJA REGISTRADORA TONAZO/caja-app"
CAJA_REF="xaerfywydzwifohjsvwa"
PUBLICABLE="sb_publishable_UY6VtQa2Qm77tQ_RtcD3Ww_EmBb0knR"

echo "Pega tu secret key de Caja (empieza con sb_secret_) y presiona Enter."
echo "(No se va a ver mientras la pegas: es normal.)"
read -rs CLAVE
echo
CLAVE="$(echo -n "$CLAVE" | tr -d '[:space:]')"
case "$CLAVE" in
  sb_secret_*) ;;
  *)
    echo "Eso no parece una secret key: tiene que empezar con sb_secret_. No se cambió nada."
    exit 1
    ;;
esac

cd "$CAJA_DIR"
echo "1/2 Guardando la llave en las funciones de Caja…"
npx supabase secrets set "SB_SECRET_KEY=$CLAVE" "SB_PUBLISHABLE_KEY=$PUBLICABLE" --project-ref "$CAJA_REF" < /dev/null
unset CLAVE

echo "2/2 Desplegando las funciones de Caja con el código nuevo (tarda un poco)…"
npx supabase functions deploy --no-verify-jwt --project-ref "$CAJA_REF" < /dev/null

echo
echo "Listo. Prueba Caja (iniciar sesión, una venta, crear un cliente) y, si todo"
echo "funciona, revoca la llave \"Previous\" en Supabase → Project Settings → JWT Keys."
