#!/usr/bin/env bash
# Cambia las dos claves que firman los avisos entre Taxi-PE y Caja Tonazo.
# Crea dos claves nuevas al azar (64 caracteres), las guarda donde van y
# nunca las muestra en pantalla. No toca ninguna cuenta de usuario.
#
#   Taxi -> Caja: Vault de Taxi-PE (webhook_secret_taxi_to_caja) y
#                 WEBHOOK_SECRET_TAXI_TO_CAJA en las funciones de Caja.
#   Caja -> Taxi: Vault de Caja (webhook_secret_caja_to_taxi) y
#                 WEBHOOK_SECRET_CAJA_TO_TAXI en las funciones de los dos.
#
# Uso (Git Bash):  bash scripts/rotar-claves-webhooks.sh
set -euo pipefail

TAXI_DIR="/e/taxiPE/taxi-pe-app"
CAJA_DIR="/e/CAJA REGISTRADORA TONAZO/caja-app"
TAXI_REF="silfhbdmfdryjdzpwzvh"
CAJA_REF="xaerfywydzwifohjsvwa"

nueva_clave() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

# Guarda la clave en el Vault del proyecto (dir, ref, nombre, valor).
guardar_en_vault() {
  local dir="$1" ref="$2" nombre="$3" valor="$4" salida
  mkdir -p "$dir/supabase/.temp"
  echo -n "$ref" > "$dir/supabase/.temp/project-ref"
  salida=$(cd "$dir" && npx supabase db query --linked \
    "select vault.update_secret(id, '$valor') from vault.secrets where name = '$nombre'" 2>&1 || true)
  rm -f "$dir/supabase/.temp/project-ref"
  if echo "$salida" | grep -qi '"error"\|ERROR'; then
    echo "  ✗ No se pudo guardar $nombre en el Vault ($ref)." >&2
    exit 1
  fi
  echo "  ✓ Vault $ref: $nombre"
}

# Guarda la clave en las funciones del proyecto (ref, nombre, valor).
guardar_en_funciones() {
  local ref="$1" nombre="$2" valor="$3"
  if ! (cd "$TAXI_DIR" && npx supabase secrets set "$nombre=$valor" --project-ref "$ref" >/dev/null 2>&1); then
    echo "  ✗ No se pudo guardar $nombre en las funciones ($ref)." >&2
    exit 1
  fi
  echo "  ✓ Funciones $ref: $nombre"
}

echo "Creando claves nuevas…"
TAXI_A_CAJA=$(nueva_clave)
CAJA_A_TAXI=$(nueva_clave)

echo "Clave Taxi-PE -> Caja:"
guardar_en_vault "$TAXI_DIR" "$TAXI_REF" "webhook_secret_taxi_to_caja" "$TAXI_A_CAJA"
guardar_en_funciones "$CAJA_REF" "WEBHOOK_SECRET_TAXI_TO_CAJA" "$TAXI_A_CAJA"

echo "Clave Caja -> Taxi-PE:"
guardar_en_vault "$CAJA_DIR" "$CAJA_REF" "webhook_secret_caja_to_taxi" "$CAJA_A_TAXI"
guardar_en_funciones "$CAJA_REF" "WEBHOOK_SECRET_CAJA_TO_TAXI" "$CAJA_A_TAXI"
guardar_en_funciones "$TAXI_REF" "WEBHOOK_SECRET_CAJA_TO_TAXI" "$CAJA_A_TAXI"

unset TAXI_A_CAJA CAJA_A_TAXI
echo "Listo: las dos claves quedaron cambiadas."
