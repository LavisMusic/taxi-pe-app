#!/usr/bin/env bash
# Crea el par de claves VAPID de las notificaciones emergentes (Web Push) y
# las guarda en el Vault de Taxi-PE y de Caja Tonazo (las mismas en las
# dos): vapid_public_key (la usa la app para suscribirse) y
# vapid_private_key (firma los envíos, Edge Function push-enviar). No
# muestra la clave privada.
#
# Volver a correrlo crea claves NUEVAS: los dispositivos ya suscritos
# dejan de recibir avisos hasta que vuelvan a abrir la app (se suscriben
# solos con la clave nueva).
#
# Uso (Git Bash):  bash scripts/generar-claves-push.sh
set -euo pipefail

TAXI_DIR="/e/taxiPE/taxi-pe-app"
CAJA_DIR="/e/CAJA REGISTRADORA TONAZO/caja-app"
TAXI_REF="silfhbdmfdryjdzpwzvh"
CAJA_REF="xaerfywydzwifohjsvwa"

echo "Creando claves VAPID…"
CLAVES=$(node -e '
const { generateKeyPairSync } = require("crypto");
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
process.stdout.write(pub + "\n" + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
')
PUBLICA=$(echo "$CLAVES" | sed -n 1p)
PRIVADA=$(echo "$CLAVES" | sed -n 2p)
unset CLAVES

# Crea o actualiza un secreto del Vault (dir, ref, nombre, valor).
guardar() {
  local dir="$1" ref="$2" nombre="$3" valor="$4" salida
  mkdir -p "$dir/supabase/.temp"
  echo -n "$ref" > "$dir/supabase/.temp/project-ref"
  # En una sola línea y sin ";" final: la CLI rechaza la consulta si no.
  salida=$(cd "$dir" && npx supabase db query --linked "do \$\$ begin if exists (select 1 from vault.secrets where name = '$nombre') then perform vault.update_secret((select id from vault.secrets where name = '$nombre'), '$valor'); else perform vault.create_secret('$valor', '$nombre'); end if; end \$\$" 2>&1 < /dev/null || true)
  rm -f "$dir/supabase/.temp/project-ref"
  if echo "$salida" | grep -qi '"error"\|ERROR'; then
    echo "  ✗ No se pudo guardar $nombre ($ref)." >&2
    exit 1
  fi
  echo "  ✓ Vault $ref: $nombre"
}

guardar "$TAXI_DIR" "$TAXI_REF" "vapid_public_key" "$PUBLICA"
guardar "$TAXI_DIR" "$TAXI_REF" "vapid_private_key" "$PRIVADA"
guardar "$CAJA_DIR" "$CAJA_REF" "vapid_public_key" "$PUBLICA"
guardar "$CAJA_DIR" "$CAJA_REF" "vapid_private_key" "$PRIVADA"

unset PRIVADA PUBLICA
echo "Listo: claves de notificaciones guardadas en las dos apps."
