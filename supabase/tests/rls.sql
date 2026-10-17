-- PRD-00 · Test de RLS. Correr contra la DB local después de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f supabase/tests/rls.sql
-- Falla (exit != 0) con raise exception si algo no se cumple. Todo corre en una transacción con rollback.

\set ON_ERROR_STOP on

begin;

-- Sanity del seed (como postgres, sin RLS)
do $$
begin
  if (select count(*) from public.blocks where trip_id = '10000000-0000-0000-0000-000000000001') < 18 then
    raise exception 'seed: se esperaban >= 18 bloques';
  end if;
  if (select count(*) from public.legs where trip_id = '10000000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'seed: se esperaban 4 tramos';
  end if;
  if (select count(*) from public.tour_stops where tour_id = '50000000-0000-0000-0000-000000000001') <> 10 then
    raise exception 'seed: se esperaban 10 paradas';
  end if;
  if (select count(*) from public.agent_proposals where status = 'pending') < 1 then
    raise exception 'seed: se esperaba 1 propuesta pending';
  end if;
  if (select count(*) from public.profiles) < 4 then
    raise exception 'seed: el trigger de auth.users no creó los profiles';
  end if;
end $$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1) No miembro: 0 filas en blocks / legs / activity_feed / blocks_visible / trips
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

do $$
begin
  if (select count(*) from public.blocks) <> 0 then raise exception 'no miembro ve blocks'; end if;
  if (select count(*) from public.legs) <> 0 then raise exception 'no miembro ve legs'; end if;
  if (select count(*) from public.activity_feed) <> 0 then raise exception 'no miembro ve activity_feed'; end if;
  if (select count(*) from public.blocks_visible) <> 0 then raise exception 'no miembro ve blocks_visible'; end if;
  if (select count(*) from public.trips) <> 0 then raise exception 'no miembro ve trips'; end if;
  if (select count(*) from public.trip_members) <> 0 then raise exception 'no miembro ve trip_members'; end if;
  if (select count(*) from public.agent_proposals) <> 0 then raise exception 'no miembro ve agent_proposals'; end if;
  raise notice 'OK 1: no miembro ve 0 filas';
end $$;

-- ---------------------------------------------------------------------------
-- 2) Sofi: el privado de Juan aparece como 'Ocupado' en blocks_visible y no aparece en blocks
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  r record;
begin
  if (select count(*) from public.blocks where id = '30000000-0000-0000-0000-000000000007') <> 0 then
    raise exception 'Sofi ve el privado de Juan en blocks';
  end if;

  select * into r from public.blocks_visible where id = '30000000-0000-0000-0000-000000000007';
  if not found then raise exception 'Sofi no ve el privado de Juan en blocks_visible'; end if;
  if r.title <> 'Ocupado' then raise exception 'title no enmascarado: %', r.title; end if;
  if not r.masked then raise exception 'masked deberia ser true'; end if;
  if r.description is not null or r.notes is not null or r.place_name is not null
     or r.google_place_id is not null or r.lat is not null or r.lng is not null
     or r.cost_estimate is not null or r.booking_url is not null then
    raise exception 'campos sensibles sin enmascarar para Sofi';
  end if;
  if r.start_time <> '18:00'::time or r.end_time <> '19:00'::time then
    raise exception 'el horario del privado deberia verse';
  end if;

  -- Sofi ve el resto de los bloques (no privados) del viaje
  if (select count(*) from public.blocks) < 18 then raise exception 'Sofi deberia ver los bloques compartidos'; end if;
  if (select count(*) from public.blocks_visible where masked) <> 1 then
    raise exception 'Sofi deberia tener exactamente 1 bloque enmascarado';
  end if;
  -- block_participants del privado tampoco
  if (select count(*) from public.block_participants where block_id = '30000000-0000-0000-0000-000000000007') <> 0 then
    raise exception 'Sofi ve participantes del privado de Juan';
  end if;
  raise notice 'OK 2: Sofi ve el privado como Ocupado y no lo ve en blocks';
end $$;

-- Sofi (viajera) no puede escribir en el tramo de Colonia (no es leg_member)
do $$
begin
  begin
    insert into public.blocks (trip_id, leg_id, type, title)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'activity', 'Intruso');
    raise exception 'FAIL: Sofi pudo insertar en Colonia';
  exception when insufficient_privilege then
    null; -- esperado (new row violates row-level security policy)
  end;
  -- Sofi no puede cambiarse el rol
  begin
    update public.trip_members set role = 'organizer'
    where trip_id = '10000000-0000-0000-0000-000000000001' and user_id = auth.uid();
    raise exception 'FAIL: Sofi pudo cambiarse el rol';
  exception when insufficient_privilege then
    null; -- esperado (trigger)
  end;
  raise notice 'OK 3: Sofi no escribe en Colonia ni se cambia el rol';
end $$;

-- ---------------------------------------------------------------------------
-- 3) Juan: ve su privado completo en blocks y en blocks_visible
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  r record;
begin
  if (select count(*) from public.blocks where id = '30000000-0000-0000-0000-000000000007') <> 1 then
    raise exception 'Juan no ve su privado en blocks';
  end if;
  select * into r from public.blocks_visible where id = '30000000-0000-0000-0000-000000000007';
  if not found then raise exception 'Juan no ve su privado en blocks_visible'; end if;
  if r.title <> 'Llamada de laburo' or r.masked then raise exception 'Juan ve su privado enmascarado'; end if;
  if r.description is null or r.notes is null or r.lat is null then
    raise exception 'Juan deberia ver los detalles de su privado';
  end if;
  raise notice 'OK 4: Juan ve su privado completo';
end $$;

-- Juan (único organizer) no puede bajarse a traveler: el viaje quedaría con 0 organizers
do $$
begin
  begin
    update public.trip_members set role = 'traveler'
    where trip_id = '10000000-0000-0000-0000-000000000001' and user_id = auth.uid();
    raise exception 'FAIL: el viaje quedó sin organizer';
  exception when check_violation then
    null; -- esperado
  end;
  raise notice 'OK 5: el viaje no puede quedar con 0 organizers';
end $$;

-- ---------------------------------------------------------------------------
-- 4) Ana (viajera del tramo Colonia) puede escribir ahí; el creador de un trip queda organizer
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_trip uuid;
begin
  insert into public.blocks (trip_id, leg_id, type, title)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'activity', 'Test Ana');

  insert into public.trips (title) values ('Viaje de prueba') returning id into v_trip;
  if public.trip_role(v_trip) is distinct from 'organizer' then
    raise exception 'el trigger no sumó al creador como organizer';
  end if;
  if length((select invite_code from public.trips where id = v_trip)) <> 8 then
    raise exception 'invite_code deberia tener 8 caracteres';
  end if;
  raise notice 'OK 6: Ana escribe en su tramo y crea viajes como organizer';
end $$;

rollback;

\echo 'RLS: todos los tests pasaron'
