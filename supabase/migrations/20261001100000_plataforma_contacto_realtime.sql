-- Contacto de la plataforma en tiempo real: el botón "Soporte" y el aviso
-- de cuenta eliminada se actualizan apenas el super admin de Caja cambia
-- el número (antes había que recargar la página). Idempotente.
do $$
begin
  alter publication supabase_realtime add table public.plataforma_contacto;
exception when duplicate_object then null;
end $$;
