-- =========================================================================
-- Foto y nombre de usuario en vivo: cada vez que cambian (desde Taxi-PE, o
-- desde Caja Tonazo por el espejo de perfil) se avisa por Realtime
-- Broadcast en el canal público 'perfiles' (evento 'perfil', solo el id:
-- cada pantalla vuelve a pedir lo que puede ver). Lo escuchan los chats y
-- Mensajes de las dos apps — sin esto había que recargar la página: el
-- pasajero no puede recibir por Realtime los cambios de la cuenta de otro
-- (RLS de usuarios).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_avisar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('tabla', tg_table_name, 'id', new.id),
      'perfil',
      'perfiles',
      false
    );
  exception when others then
    raise warning 'fn_avisar_perfil: aviso no enviado: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_avisar_perfil_usuario on public.usuarios;
create trigger trg_avisar_perfil_usuario
  after update of foto_url, nombre_usuario on public.usuarios
  for each row
  when (old.foto_url is distinct from new.foto_url or old.nombre_usuario is distinct from new.nombre_usuario)
  execute function public.fn_avisar_perfil();

drop trigger if exists trg_avisar_perfil_conductor on public.conductores;
create trigger trg_avisar_perfil_conductor
  after update of foto_url, nombre on public.conductores
  for each row
  when (old.foto_url is distinct from new.foto_url or old.nombre is distinct from new.nombre)
  execute function public.fn_avisar_perfil();
