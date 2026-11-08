-- =========================================================================
-- Fase 3b: el admin corrige la membresía de un recolector (⚡ → "Corregir
-- membresía") sin registrar venta ni pago.
--   * p_vence: nueva fecha de vencimiento; null = sin membresía.
--   * p_cupo: cupo total de conductores del periodo.
--   * p_reiniciar: el periodo empieza hoy (los conductores atendidos
--     vuelven a 0, porque se cuentan desde el inicio del periodo).
--
-- Proyecto: Taxi-PE. Idempotente. Va después de 20261110100000.
-- =========================================================================
create or replace function public.taxi_corregir_membresia_recolector(
  p_recolector_id uuid, p_vence timestamptz, p_cupo integer, p_reiniciar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi_es_admin() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;
  if p_cupo is not null and p_cupo < 0 then
    raise exception 'El cupo no puede ser negativo.' using errcode = '22023';
  end if;
  update public.usuarios
     set membresia_vencimiento = p_vence,
         membresia_cupo = case when p_vence is null then null else coalesce(p_cupo, membresia_cupo, 0) end,
         membresia_inicio = case
           when p_vence is null then null
           when coalesce(p_reiniciar, false) or membresia_inicio is null then now()
           else membresia_inicio
         end
   where id = p_recolector_id and rol = 'recolector';
  if not found then
    raise exception 'Ese recolector no existe.' using errcode = '22023';
  end if;
  return public.taxi_cupo_recolector(p_recolector_id);
end;
$$;
revoke execute on function public.taxi_corregir_membresia_recolector(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function public.taxi_corregir_membresia_recolector(uuid, timestamptz, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
