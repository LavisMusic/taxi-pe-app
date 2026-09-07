// Edge Function: create-cliente
//
// Invocada desde el admin (App.jsx) con:
//   supabase.functions.invoke('create-cliente', { body: { tipo: 'cliente', nombre, celular, pin } })
//   supabase.functions.invoke('create-cliente', { body: { tipo: 'cajero', nombre, usuario, pin } })
// El SDK adjunta automáticamente el JWT del admin en el header Authorization.
//
// Usa la service_role key (variable de entorno inyectada por Supabase,
// nunca presente en el bundle del navegador) para:
//   1) confirmar que quien llama es realmente un admin (profiles.role),
//   2) crear el usuario de Auth con el "dummy email" + PIN como password,
//   3) guardar el perfil (y, si es cliente, el registro de clientes_fiado).
//
// La sesión del navegador del admin NUNCA se toca: el cliente admin.* de
// aquí abajo vive únicamente dentro de esta función (server-side), es un
// objeto totalmente distinto del supabase client que corre en el navegador.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1) Verificar que quien llama es admin, usando SU JWT (nunca confiar en
  // un flag "isAdmin" que venga en el body de la petición).
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json(401, { error: "No autenticado." });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json(401, { error: "No autenticado." });
  }

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  const callerRole = callerProfileErr ? null : callerProfile?.role;
  if (callerRole !== "admin" && callerRole !== "cajero") {
    return json(403, { error: "No autorizado." });
  }

  // 2) Validar input
  let body: { tipo?: string; nombre?: string; celular?: string; usuario?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Cuerpo de la petición inválido." });
  }

  const tipo = body.tipo === "cajero" ? "cajero" : "cliente";

  // Un cajero puede dar de alta clientes (fiados nuevos), pero NO otros
  // cajeros/personal — eso sigue siendo exclusivo del admin.
  if (tipo === "cajero" && callerRole !== "admin") {
    return json(403, { error: "Solo el admin puede crear cuentas de cajero." });
  }

  const nombre = (body.nombre || "").trim();
  // Normalización explícita: null, undefined, "" (incluso "   " con
  // solo espacios) son TODOS "no se mandó PIN" — nunca "se mandó un
  // PIN inválido". Antes esto ya funcionaba vía 'body.pin || ""'
  // (undefined/"" ya colapsaban al mismo valor), pero se deja
  // explícito con .trim() para que tampoco un PIN de puros espacios
  // cuele como "truthy" por accidente.
  const pinProvided = typeof body.pin === "string" ? body.pin.trim() : "";
  const pinWasSent = pinProvided.length > 0;

  if (!nombre) return json(400, { error: "Falta el nombre." });

  // Un cajero SIEMPRE necesita su clave puesta por el admin en el
  // momento (es personal de confianza, no pasa por el flujo de
  // "crear tu PIN en el primer login"). Un cliente, en cambio, ahora
  // puede registrarse SOLO con nombre + teléfono — si no viene 'pin',
  // la cuenta se crea con un password placeholder aleatorio que nadie
  // conoce, y 'pin_configurado' queda en false hasta que el cliente
  // mismo lo reemplace por su PIN real (ver set-initial-pin).
  if (tipo === "cajero" && !/^\d{4,10}$/.test(pinProvided)) {
    return json(400, { error: "El PIN/clave debe tener entre 4 y 10 dígitos." });
  }
  if (tipo === "cliente" && pinWasSent && !/^\d{4,10}$/.test(pinProvided)) {
    return json(400, { error: "El PIN debe tener entre 4 y 10 dígitos." });
  }

  let dummyEmail: string;
  let celular = "";
  let usuario = "";

  if (tipo === "cliente") {
    celular = (body.celular || "").trim();
    if (!/^\d{6,15}$/.test(celular)) {
      return json(400, { error: "El celular debe tener entre 6 y 15 dígitos." });
    }
    dummyEmail = `${celular}@tonazo.app`;
  } else {
    usuario = (body.usuario || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,20}$/.test(usuario)) {
      return json(400, {
        error: "El usuario debe tener 3 a 20 caracteres (letras, números, punto, guion).",
      });
    }
    dummyEmail = `${usuario}@tonazo.staff`;
  }

  // Password real de Supabase Auth para esta cuenta: el PIN si vino
  // (cajero siempre, o un cliente al que el admin igual quiso ponerle
  // uno de una), o si no un placeholder aleatorio de 32 caracteres
  // (crypto.randomUUID, NUNCA expuesto ni guardado en ningún otro
  // lado) — nadie puede loguearse con él porque nadie lo conoce; el
  // cliente entra recién cuando reemplaza este placeholder por su PIN
  // real en su primer login.
  const pinConfigurado = !!pinProvided;
  const password = pinProvided || crypto.randomUUID().replace(/-/g, "");

  // 3) Crear el usuario en Supabase Auth (server-side, con service_role).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: dummyEmail,
    password,
    email_confirm: true,
  });

  if (createErr) {
    const msg = /already been registered|already registered/i.test(createErr.message || "")
      ? tipo === "cliente"
        ? "Ya existe un cliente registrado con ese celular."
        : "Ya existe un cajero con ese usuario."
      : createErr.message;
    return json(409, { error: msg });
  }

  const newUserId = created.user.id;

  // 4) profile row (rol según tipo). 'nombre' se guarda siempre acá —
  // aunque el de cliente TAMBIÉN vive en clientes_fiado.nombre (no se
  // duplica por gusto: el panel de administración de usuarios lista
  // cajeros Y clientes desde 'profiles' en una sola consulta, y
  // necesita poder mostrar el nombre de ambos sin tener que hacer join
  // con clientes_fiado).
  const { error: profInsertErr } = await admin
    .from("profiles")
    .insert({ id: newUserId, role: tipo, nombre, pin_configurado: pinConfigurado });

  if (profInsertErr) {
    await admin.auth.admin.deleteUser(newUserId);
    return json(500, { error: "No se pudo crear el perfil." });
  }

  if (tipo === "cajero") {
    return json(200, { id: newUserId, nombre, usuario });
  }

  // 5) clientes_fiado row — reutiliza el esquema existente (whatsapp =
  // el mismo celular usado para el login).
  const { data: clienteRow, error: clienteErr } = await admin
    .from("clientes_fiado")
    .insert({
      nombre,
      whatsapp: celular,
      fecha: Date.now(),
      auth_user_id: newUserId,
    })
    .select()
    .single();

  if (clienteErr) {
    await admin.auth.admin.deleteUser(newUserId); // profiles cascadea por FK
    return json(500, { error: "No se pudo crear el registro de cliente." });
  }

  return json(200, {
    id: clienteRow.id,
    nombre: clienteRow.nombre,
    whatsapp: clienteRow.whatsapp,
    fecha: clienteRow.fecha,
  });
});
