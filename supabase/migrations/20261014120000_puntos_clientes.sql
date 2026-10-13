-- =========================================================================
-- Créditos, fase B: puntos del cliente por compras online en Caja Tonazo.
--
-- Caja avisa (caja.puntos_cliente → Edge Function webhook-caja-puntos →
-- rpc_webhook_caja_puntos) cuando un pedido online termina ('suma') o se
-- cancela/revierte después ('resta'). Puntos = total del pedido redondeado.
--
--   * taxi_puntos_movimientos: registro de cada movimiento; un pedido suma
--     una sola vez y resta una sola vez (único por pedido + movimiento),
--     aunque el aviso llegue repetido.
--   * Se acreditan a la cuenta de cliente (usuarios rol 'pasajero') con ese
--     teléfono; nunca bajan de 0. Si todavía no tiene cuenta, quedan
--     guardados y se acreditan solos cuando la crea.
--   * El cliente ve sus propios movimientos (para el contador de la fase C);
--     el Admin, todos.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_puntos_movimientos (
  id              bigserial primary key,
  telefono        text not null,
  usuario_id      uuid,
  caja_pedido_id  text not null,
  movimiento      text not null check (movimiento in ('suma', 'resta')),
  puntos          integer not null check (puntos > 0),
  acreditado      boolean not null default false,
  created_at      timestamptz not null default now(),
  acreditado_at   timestamptz,
  unique (caja_pedido_id, movimiento)
);
create index if not exists taxi_puntos_mov_telefono on public.taxi_puntos_movimientos (telefono) where not acreditado;
create index if not exists taxi_puntos_mov_usuario on public.taxi_puntos_movimientos (usuario_id);

alter table public.taxi_puntos_movimientos enable row level security;
revoke all on public.taxi_puntos_movimientos from anon, authenticated;
grant select on public.taxi_puntos_movimientos to authenticated;
drop policy if exists puntos_mov_leer on public.taxi_puntos_movimientos;
create policy puntos_mov_leer on public.taxi_puntos_movimientos for select to authenticated
  using (public.taxi_es_admin() or usuario_id = auth.uid());

-- Aplica a una cuenta los movimientos todavía sin acreditar de su teléfono.
create or replace function public.taxi_acreditar_puntos_pendientes(p_usuario_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tel   text;
  v_delta integer;
begin
  select telefono into v_tel from public.usuarios where id = p_usuario_id and rol = 'pasajero';
  if v_tel is null then
    return 0;
  end if;
  with aplicados as (
    update public.taxi_puntos_movimientos
      set acreditado = true, acreditado_at = now(), usuario_id = p_usuario_id
      where telefono = v_tel and not acreditado
      returning case when movimiento = 'suma' then puntos else -puntos end as d
  )
  select coalesce(sum(d), 0) into v_delta from aplicados;
  if v_delta <> 0 then
    update public.usuarios
      set creditos_disponibles = greatest(coalesce(creditos_disponibles, 0) + v_delta, 0)
      where id = p_usuario_id;
  end if;
  return v_delta;
end;
$$;
revoke execute on function public.taxi_acreditar_puntos_pendientes(uuid) from public, anon, authenticated;

-- Receptor del aviso de Caja.
create or replace function public.rpc_webhook_caja_puntos(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo    integer;
  v_data     jsonb := p_payload -> 'data';
  v_tel      text  := nullif(trim(v_data ->> 'telefono'), '');
  v_pedido   text  := nullif(trim(v_data ->> 'caja_pedido_id'), '');
  v_mov      text  := v_data ->> 'movimiento';
  v_puntos   integer := round(coalesce((v_data ->> 'puntos')::numeric, 0))::integer;
  v_usuario  uuid;
begin
  insert into public.webhook_inbox (event_id, event_type, payload)
  values (p_event_id, p_payload ->> 'event_type', p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  if v_tel is null or v_pedido is null or v_mov not in ('suma', 'resta') or v_puntos <= 0 then
    update public.webhook_inbox set estado = 'sin_match', nota = 'payload inválido', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'invalido');
  end if;

  -- Una 'resta' sin su 'suma' previa no resta nada.
  if v_mov = 'resta' and not exists (
    select 1 from public.taxi_puntos_movimientos where caja_pedido_id = v_pedido and movimiento = 'suma'
  ) then
    update public.webhook_inbox set estado = 'sin_match', nota = 'resta sin suma previa', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'sin_suma');
  end if;

  insert into public.taxi_puntos_movimientos (telefono, caja_pedido_id, movimiento, puntos)
  values (v_tel, v_pedido, v_mov, v_puntos)
  on conflict (caja_pedido_id, movimiento) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  select id into v_usuario from public.usuarios where telefono = v_tel and rol = 'pasajero' limit 1;
  if v_usuario is null then
    update public.webhook_inbox set nota = 'cliente sin cuenta: queda pendiente', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'pendiente');
  end if;

  perform public.taxi_acreditar_puntos_pendientes(v_usuario);
  update public.webhook_inbox set procesado_at = now() where event_id = p_event_id;
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.rpc_webhook_caja_puntos(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_puntos(uuid, jsonb) to service_role;

-- Cuenta de cliente nueva: se le acreditan los puntos que esperaban.
create or replace function public.fn_usuarios_acreditar_puntos_pendientes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol = 'pasajero' and new.telefono is not null then
    perform public.taxi_acreditar_puntos_pendientes(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_usuarios_acreditar_puntos_pendientes on public.usuarios;
create trigger trg_usuarios_acreditar_puntos_pendientes
  after insert on public.usuarios
  for each row execute function public.fn_usuarios_acreditar_puntos_pendientes();
