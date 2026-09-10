-- Tarjeta de Conductor desde el registro exprés (ver
-- useConductorTemporal.js): ahora `registrarTemporal` inserta también
-- una fila en `conductores` de una, sin foto ni placa todavía (se
-- completan recién al verificar, ver VerificarConductorForm.jsx) y con
-- 2 meses de membresía PRO de regalo. Hasta ahora TODO alta de
-- conductor mandaba siempre una placa/dni real, así que es probable que
-- esas columnas todavía tengan NOT NULL de una migración vieja — un
-- ALTER ... DROP NOT NULL sobre una columna que ya admite NULL no
-- falla, es un no-op (mismo criterio que ya usó
-- 20260905120000_cuentas_temporales.sql para usuarios.dni/pin/nombre).
alter table conductores alter column placa drop not null;
alter table conductores alter column dni drop not null;

-- El cron de cuentas temporales vencidas (ver
-- 20260905120000_cuentas_temporales.sql) hasta ahora solo borraba
-- `usuarios` — no hacía falta tocar `conductores` porque un conductor
-- temporal todavía no tenía fila ahí. Ahora que sí la tiene desde el
-- registro (con la membresía PRO gratis incluida), si nunca verifica su
-- cuenta hay que borrar TAMBIÉN esa tarjeta — si no, se queda para
-- siempre en el Directorio disfrutando la membresía gratis sin haberse
-- verificado nunca ("obviamente si nunca verifica su cuenta... se
-- eliminará junto con estos créditos", pedido explícito). Se borra
-- `conductores` ANTES que `usuarios` (mismo filtro, por teléfono)
-- porque la subconsulta necesita que esas filas de `usuarios` todavía
-- existan para encontrarlas.
create or replace function borrar_cuentas_temporales_vencidas()
returns void
language sql
as $$
  delete from conductores
  where telefono in (
    select telefono from usuarios
    where rol = 'conductor'
      and estado_verificacion = 'temporal'
      and expira_en is not null
      and expira_en < now()
  );

  delete from usuarios
  where estado_verificacion = 'temporal'
    and expira_en is not null
    and expira_en < now();
$$;
