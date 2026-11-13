-- =========================================================================
-- Etiqueta "Nuevo" por 3 días + gemas ya vistas guardadas en la base
-- (Taxi-PE).
--
--   * taxi_nuevos(tipo, ids): de esos conductores (conductores.id) o
--     pasajeros (usuarios.id), los que se crearon hace menos de 3 días,
--     con hasta cuándo son "Nuevo". La etiqueta "Nuevo" solo se muestra esos
--     3 días y mientras no tengan sus primeras calificaciones; después, sin
--     etiqueta hasta que lleguen las estrellas. Caja la usa para los
--     repartidores (tipo 'conductor'). Solo devuelve los que siguen siendo
--     nuevos.
--   * gemas_vistas: cuántas gemas verdes/celestes ya vio cada pasajero, para
--     que la gema a pantalla completa no se repita al entrar desde otro
--     navegador o teléfono. Cada uno lee y escribe solo la suya.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_nuevos(p_tipo text, p_ids uuid[])
returns table (id uuid, nuevo_hasta timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    return;
  end if;
  if p_tipo = 'conductor' then
    return query
      select c.id, c.created_at + interval '3 days'
        from public.conductores c
       where c.id = any(p_ids) and c.created_at > now() - interval '3 days';
  elsif p_tipo = 'pasajero' then
    return query
      select u.id, u.created_at + interval '3 days'
        from public.usuarios u
       where u.id = any(p_ids) and u.created_at > now() - interval '3 days';
  end if;
end;
$$;
revoke execute on function public.taxi_nuevos(text, uuid[]) from public;
grant execute on function public.taxi_nuevos(text, uuid[]) to anon, authenticated;

create table if not exists public.gemas_vistas (
  usuario_id uuid primary key default auth.uid() references public.usuarios (id) on delete cascade,
  verdes integer not null default 0 check (verdes >= 0),
  celestes integer not null default 0 check (celestes >= 0),
  updated_at timestamptz not null default now()
);
alter table public.gemas_vistas enable row level security;
revoke all on public.gemas_vistas from anon;
grant select, insert, update on public.gemas_vistas to authenticated;

drop policy if exists gemas_vistas_propias_leer on public.gemas_vistas;
create policy gemas_vistas_propias_leer on public.gemas_vistas
  for select to authenticated using (usuario_id = auth.uid());
drop policy if exists gemas_vistas_propias_crear on public.gemas_vistas;
create policy gemas_vistas_propias_crear on public.gemas_vistas
  for insert to authenticated with check (usuario_id = auth.uid());
drop policy if exists gemas_vistas_propias_cambiar on public.gemas_vistas;
create policy gemas_vistas_propias_cambiar on public.gemas_vistas
  for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

notify pgrst, 'reload schema';
