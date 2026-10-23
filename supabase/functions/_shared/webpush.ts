// Web Push sin dependencias (Web Crypto): cifra el mensaje para el
// navegador (RFC 8291, aes128gcm) y firma el pedido con VAPID (RFC 8292).
// Lo usa push-enviar. Las claves VAPID vienen del Vault:
//   vapid_private_key = JWK { kty, crv: "P-256", x, y, d }
// (scripts/generar-claves-push.sh en taxi-pe-app).

export interface Suscripcion {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const enc = new TextEncoder();

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, largo * 8);
  return new Uint8Array(bits);
}

// Cuerpo cifrado (aes128gcm) para una suscripción.
async function cifrar(sub: Suscripcion, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);

  const efimera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, efimera.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const registro = concat(payload, new Uint8Array([2])); // 0x02: último registro
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, registro));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cifrado);
}

export interface Vapid {
  jwk: JsonWebKey;
  publica: string; // base64url, punto sin comprimir (65 bytes)
  sujeto: string; // "mailto:..." o "https://..."
}

export function vapidDesdeJwk(jwkTexto: string, sujeto: string): Vapid {
  const jwk = JSON.parse(jwkTexto) as JsonWebKey;
  const publica = b64uEncode(concat(new Uint8Array([4]), b64uDecode(jwk.x!), b64uDecode(jwk.y!)));
  return { jwk, publica, sujeto };
}

async function firmaVapid(endpoint: string, vapid: Vapid): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cabecera = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const datos = b64uEncode(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.sujeto }))
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: vapid.jwk.x, y: vapid.jwk.y, d: vapid.jwk.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${cabecera}.${datos}`));
  return `${cabecera}.${datos}.${b64uEncode(firma)}`;
}

// Devuelve el código HTTP del servicio de push (201 = enviado; 404/410 =
// la suscripción ya no existe y conviene borrarla).
export async function enviarPush(sub: Suscripcion, mensaje: unknown, vapid: Vapid): Promise<number> {
  const cuerpo = await cifrar(sub, enc.encode(JSON.stringify(mensaje)));
  const jwt = await firmaVapid(sub.endpoint, vapid);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${vapid.publica}`,
    },
    body: cuerpo,
  });
  await r.body?.cancel();
  return r.status;
}
