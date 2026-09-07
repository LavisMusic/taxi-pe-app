# Redesplegar las Edge Functions de caja-registradora en el proyecto de Taxi-PE

`create-cliente`, `check-pin-status`, `set-initial-pin` y `manage-usuario`
son código de servidor (usan la `service_role key`, nunca presente en el
navegador) — no las mueve ningún script SQL. Ya las copié tal cual a este
repo, en `supabase/functions/`:

```
supabase/functions/create-cliente/index.ts
supabase/functions/check-pin-status/index.ts
supabase/functions/set-initial-pin/index.ts
supabase/functions/manage-usuario/index.ts
```

Para desplegarlas al proyecto de Taxi-PE (`silfhbdmfdryjdzpwzvh`), desde la
raíz de `taxi-pe-app/` con el CLI de Supabase instalado y con sesión
iniciada (`supabase login`):

```bash
supabase link --project-ref silfhbdmfdryjdzpwzvh
supabase functions deploy create-cliente
supabase functions deploy check-pin-status
supabase functions deploy set-initial-pin
supabase functions deploy manage-usuario
```

No hace falta configurar `SUPABASE_URL` ni `SUPABASE_SERVICE_ROLE_KEY` a
mano — Supabase las inyecta automáticamente como variables de entorno en
cada función, ya apuntando al proyecto donde la desplegaste (Taxi-PE en
este caso).

## Verificación

Con el catálogo de productos y sucursales ya migrado (ver
`MIGRACION_CAJA_A_TAXIPE.md`), desde el Dashboard del proyecto de Taxi-PE →
Edge Functions → `create-cliente` → "Invoke" (o desde la app real, en
`/admin` → Usuarios → "Crear cliente"), prueba dar de alta un cliente de
prueba con nombre + celular. Si responde `200` con el `id`/`nombre`/
`whatsapp` del cliente creado, la función ya está funcionando contra el
proyecto nuevo. Luego prueba el login completo desde `caja-app` (celular +
"Crea tu PIN" en el primer login).
