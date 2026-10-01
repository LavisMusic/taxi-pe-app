-- =========================================================================
-- Fix: eliminar un conductor desde el Table Editor (o desde
-- eliminarUsuario, ya con la policy de DELETE arreglada en la
-- migración anterior) sigue chocando con violaciones de llave foránea
-- — 'entregas' fue la primera que se topó el admin, pero hay 5 tablas
-- MÁS que referencian conductores(id) sin ningún ON DELETE: la próxima
-- prueba se hubiera trabado igual con la siguiente.
--
-- Encontrado con `supabase gen types` (introspección real del schema,
-- no adivinado): chat_mensajes, entrega_ofertas, entregas,
-- fiados_conductores, pagos_fiados_conductores, ventas.
--
-- Criterio por tabla — nunca se borra historial real, solo se
-- desvincula del conductor que ya no existe:
--   - entregas / fiados_conductores / ventas: ya son nullable ->
--     ON DELETE SET NULL (conserva el pedido/fiado/venta).
--   - chat_mensajes / pagos_fiados_conductores: son NOT NULL (una fila
--     sin ningún conductor no tendría sentido de otra forma) -> se
--     relaja a nullable + SET NULL, mismo criterio (conserva el chat y
--     el pago como historial, ninguno se borra).
--   - entrega_ofertas: es solo una OFERTA/negociación transitoria, sin
--     valor de negocio una vez que el conductor ya no existe ->
--     ON DELETE CASCADE (se borra la oferta, no la entrega en sí).
--
-- Proyecto: Taxi-PE. Idempotente (busca el nombre real de cada
-- constraint en vez de asumirlo, igual que el fix de pedidos en Caja).
-- =========================================================================

alter table public.chat_mensajes alter column conductor_id drop not null;
alter table public.pagos_fiados_conductores alter column conductor_id drop not null;

create or replace function pg_temp.fix_fk_conductor(p_table text, p_action text)
returns void
language plpgsql
as $$
declare
  v_conname text;
begin
  select tc.constraint_name into v_conname
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = p_table
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'conductor_id'
  limit 1;

  if v_conname is not null then
    execute format('alter table public.%I drop constraint %I', p_table, v_conname);
  end if;

  execute format(
    'alter table public.%I add constraint %I foreign key (conductor_id) references public.conductores(id) on delete %s',
    p_table, p_table || '_conductor_id_fkey', p_action
  );
end;
$$;

select pg_temp.fix_fk_conductor('chat_mensajes', 'set null');
select pg_temp.fix_fk_conductor('entrega_ofertas', 'cascade');
select pg_temp.fix_fk_conductor('entregas', 'set null');
select pg_temp.fix_fk_conductor('fiados_conductores', 'set null');
select pg_temp.fix_fk_conductor('pagos_fiados_conductores', 'set null');
select pg_temp.fix_fk_conductor('ventas', 'set null');
