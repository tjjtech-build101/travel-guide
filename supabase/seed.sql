-- PRD-00 · Seed de demo (solo Supabase local). IDs fijos = packages/shared/src/demo.ts.
-- Remoto: scripts/seed-remote.ts.
--
-- Convención de IDs fijos de este seed (además de los de demo.ts):
--   days            60000000-0000-0000-0000-0000000000NN
--   blocks          30000000-0000-0000-0000-0000000000NN
--   agent_proposals 70000000-0000-0000-0000-0000000000NN
--   place_library   80000000-0000-0000-0000-0000000000NN
--   tour_stops      90000000-0000-0000-0000-0000000000NN

-- ---------------------------------------------------------------------------
-- Usuarios (auth.users + auth.identities) · password = DEMO_PASSWORD
-- El trigger on_auth_user_created crea las filas de public.profiles.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id::uuid, 'authenticated', 'authenticated', u.email,
  extensions.crypt('build101-demo', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-0000-0000-000000000001', 'juan@demo.build101.dev', 'Juan'),
  ('00000000-0000-0000-0000-000000000002', 'ana@demo.build101.dev',  'Ana'),
  ('00000000-0000-0000-0000-000000000003', 'leo@demo.build101.dev',  'Leo'),
  ('00000000-0000-0000-0000-000000000004', 'sofi@demo.build101.dev', 'Sofi')
) as u(id, email, full_name);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004'
);

update public.profiles set home_currency = 'UYU', pace = 'balanced', budget_level = 'mid'
where id in (
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004'
);

-- ---------------------------------------------------------------------------
-- Viaje "Montevideo + Buenos Aires" (el trigger on_trip_created suma a Juan como organizer)
-- ---------------------------------------------------------------------------
insert into public.trips (id, title, base_currency, status, start_date, end_date, invite_code, created_by)
values ('10000000-0000-0000-0000-000000000001', 'Montevideo + Buenos Aires', 'USD', 'planning',
        '2026-10-17', '2026-10-24', 'MVDBUE26', '00000000-0000-0000-0000-000000000001');

insert into public.trip_members (trip_id, user_id, role, location_sharing) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'traveler', 'shared_only'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'traveler', 'shared_only'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'traveler', 'shared_only')
on conflict (trip_id, user_id) do nothing;

-- Tramos: Montevideo [todos] → Colonia [Juan, Ana, Leo] ∥ Buenos Aires [Sofi] → Buenos Aires [todos]
insert into public.legs (id, trip_id, city, country, lat, lng, start_date, end_date, sort_order) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Montevideo',    'UY', -34.9058, -56.1913, '2026-10-17', '2026-10-19', 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Colonia del Sacramento', 'UY', -34.4717, -57.8442, '2026-10-20', '2026-10-21', 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Buenos Aires',  'AR', -34.6037, -58.3816, '2026-10-20', '2026-10-21', 2),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Buenos Aires',  'AR', -34.6037, -58.3816, '2026-10-22', '2026-10-24', 3);

insert into public.leg_members (leg_id, user_id)
select l.leg_id::uuid, u.user_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000001', array['1','2','3','4']),
  ('20000000-0000-0000-0000-000000000002', array['1','2','3']),
  ('20000000-0000-0000-0000-000000000003', array['4']),
  ('20000000-0000-0000-0000-000000000004', array['1','2','3','4'])
) as l(leg_id, members)
cross join lateral (
  select '00000000-0000-0000-0000-00000000000' || m as user_id from unnest(l.members) m
) u;

-- Días (uno por fecha de cada tramo)
insert into public.days (id, leg_id, date) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2026-10-17'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2026-10-18'),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '2026-10-19'),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '2026-10-20'),
  ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '2026-10-21'),
  ('60000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '2026-10-20'),
  ('60000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000003', '2026-10-21'),
  ('60000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000004', '2026-10-22'),
  ('60000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000004', '2026-10-23'),
  ('60000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000004', '2026-10-24');

-- ---------------------------------------------------------------------------
-- Bloques (32). Coordenadas aproximadas (reemplazables con scripts/resolve-places.ts).
-- ---------------------------------------------------------------------------
insert into public.blocks (
  id, trip_id, leg_id, day_id, type, title, place_name, lat, lng,
  start_time, end_time, time_flex, duration_min, status, sort_order, created_by
)
select v.id::uuid, '10000000-0000-0000-0000-000000000001'::uuid, v.leg_id::uuid, v.day_id::uuid,
       v.type, v.title, v.place_name, v.lat, v.lng,
       v.start_time::time, v.end_time::time, v.time_flex, v.duration_min, v.status, v.sort_order,
       '00000000-0000-0000-0000-000000000001'::uuid
from (values
  -- Montevideo · sáb 17
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
   'meal', 'Almuerzo en el Mercado del Puerto', 'Mercado del Puerto', -34.9067, -56.2128, '13:00', '14:30', 'fixed', 90, 'confirmed', 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
   'lodging', 'Check-in en el alojamiento de Ciudad Vieja', 'Alojamiento en Ciudad Vieja', -34.9070, -56.2045, '15:00', '15:30', 'fixed', 30, 'booked', 2),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
   'activity', 'Rambla al atardecer', 'Rambla Gran Bretaña', -34.9100, -56.2010, '18:30', '20:00', 'evening', 90, 'confirmed', 3),
  -- Montevideo · dom 18
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   'activity', 'Feria de Tristán Narvaja', 'Feria de Tristán Narvaja', -34.9020, -56.1775, '09:00', '10:30', 'morning', 90, 'confirmed', 1),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   'tour', 'Ciudad Vieja', 'Puerta de la Ciudadela', -34.90674, -56.20125, '11:00', '13:30', 'fixed', 150, 'confirmed', 2),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   'activity', 'Visita guiada al Teatro Solís', 'Teatro Solís', -34.90722, -56.20056, '16:00', '17:00', 'fixed', 60, 'confirmed', 3),
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
   'activity', 'Llamada de laburo', 'Alojamiento en Ciudad Vieja', -34.9070, -56.2045, '18:00', '19:00', 'fixed', 60, 'confirmed', 4),
  -- Montevideo · lun 19
  ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
   'meal', 'Desayuno en el Café Brasilero', 'Café Brasilero', -34.9071, -56.2049, '09:30', '10:30', 'morning', 60, 'confirmed', 1),
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
   'activity', 'Museo Andes 1972', 'Museo Andes 1972', -34.9063, -56.2047, '11:00', '12:30', 'morning', 90, 'confirmed', 2),
  ('30000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
   'activity', 'Caminata por la Rambla de Pocitos', 'Playa de los Pocitos', -34.9150, -56.1500, '15:00', '17:00', 'afternoon', 120, 'confirmed', 3),
  ('30000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
   'free', 'Tarde libre', null, null, null, '17:00', '20:00', 'afternoon', 180, 'confirmed', 4),
  ('30000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003',
   'meal', 'Cena en Jacinto', 'Jacinto', -34.9068, -56.2085, '21:00', '23:00', 'fixed', 120, 'confirmed', 5),
  -- Montevideo · ideas
  ('30000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000001', null,
   'meal', 'Probar un chivito', null, null, null, null, null, 'any', 60, 'idea', 1),
  ('30000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000001', null,
   'activity', 'Subir al Cerro de Montevideo', 'Fortaleza del Cerro', -34.8890, -56.2600, null, null, 'any', 120, 'idea', 2),
  -- Colonia · mar 20
  ('30000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004',
   'transfer', 'Bus Montevideo → Colonia', 'Terminal Tres Cruces', -34.8940, -56.1664, '08:30', '11:15', 'fixed', 165, 'booked', 1),
  ('30000000-0000-0000-0000-000000000016', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004',
   'activity', 'Barrio Histórico de Colonia', 'Barrio Histórico', -34.4717, -57.8510, '12:00', '15:00', 'afternoon', 180, 'confirmed', 2),
  ('30000000-0000-0000-0000-000000000017', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004',
   'activity', 'Atardecer en el Faro', 'Faro de Colonia', -34.4723, -57.8518, '18:30', '19:30', 'evening', 60, 'confirmed', 3),
  -- Colonia · mié 21
  ('30000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000005',
   'activity', 'Bici hasta el Real de San Carlos', 'Real de San Carlos', -34.4455, -57.8330, '10:00', '13:00', 'morning', 180, 'confirmed', 1),
  -- Colonia · ideas
  ('30000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000002', null,
   'activity', 'Calle de los Suspiros', 'Calle de los Suspiros', -34.4720, -57.8525, null, null, 'any', 30, 'idea', 1),
  ('30000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000002', null,
   'activity', 'Visitar una bodega de la zona', null, null, null, null, null, 'afternoon', 120, 'idea', 2),
  -- Buenos Aires (Sofi) · mar 20
  ('30000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000006',
   'transfer', 'Ferry Montevideo → Buenos Aires', 'Puerto de Montevideo', -34.9050, -56.2120, '08:00', '10:15', 'fixed', 135, 'booked', 1),
  ('30000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000006',
   'activity', 'San Telmo y Plaza Dorrego', 'Plaza Dorrego', -34.6206, -58.3716, '14:00', '17:00', 'afternoon', 180, 'confirmed', 2),
  -- Buenos Aires (Sofi) · mié 21
  ('30000000-0000-0000-0000-000000000023', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000007',
   'activity', 'Museo Nacional de Bellas Artes', 'Museo Nacional de Bellas Artes', -34.5839, -58.3929, '11:00', '13:00', 'morning', 120, 'confirmed', 1),
  -- Buenos Aires (Sofi) · ideas
  ('30000000-0000-0000-0000-000000000024', '20000000-0000-0000-0000-000000000003', null,
   'activity', 'Librería El Ateneo Grand Splendid', 'El Ateneo Grand Splendid', -34.5959, -58.3942, null, null, 'any', 45, 'idea', 1),
  ('30000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000003', null,
   'meal', 'Café en el Tortoni', 'Café Tortoni', -34.6088, -58.3787, null, null, 'any', 60, 'idea', 2),
  -- Buenos Aires · jue 22
  ('30000000-0000-0000-0000-000000000026', '20000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000008',
   'transfer', 'Ferry Colonia → Buenos Aires', 'Puerto de Colonia', -34.4710, -57.8435, '09:00', '10:15', 'fixed', 75, 'booked', 1),
  ('30000000-0000-0000-0000-000000000027', '20000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000008',
   'meetup', 'Reencuentro', 'Puente de la Mujer', -34.6080, -58.3650, '13:00', '14:00', 'fixed', 60, 'confirmed', 2),
  ('30000000-0000-0000-0000-000000000028', '20000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000008',
   'meal', 'Parrilla en Palermo', 'Palermo Soho', -34.5880, -58.4300, '21:00', '23:00', 'evening', 120, 'confirmed', 3),
  -- Buenos Aires · vie 23
  ('30000000-0000-0000-0000-000000000029', '20000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000009',
   'activity', 'La Boca y Caminito', 'Caminito', -34.6393, -58.3631, '10:00', '12:30', 'morning', 150, 'confirmed', 1),
  -- Buenos Aires · sáb 24
  ('30000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000004', '60000000-0000-0000-0000-000000000010',
   'transfer', 'Vuelo de vuelta', 'Aeroparque Jorge Newbery', -34.5592, -58.4156, '18:00', '19:30', 'fixed', 90, 'booked', 1),
  -- Buenos Aires · ideas
  ('30000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000004', null,
   'activity', 'Show de tango', null, null, null, null, null, 'evening', 120, 'idea', 1),
  ('30000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000004', null,
   'activity', 'Recorrer Puerto Madero', 'Puerto Madero', -34.6110, -58.3630, null, null, 'any', 90, 'idea', 2)
) as v(id, leg_id, day_id, type, title, place_name, lat, lng, start_time, end_time, time_flex, duration_min, status, sort_order);

-- Detalles de bloques puntuales
update public.blocks set
  is_private = true,
  description = 'Call semanal con el equipo',
  notes = 'Link de Meet en el calendario',
  booking_url = 'https://meet.google.com/demo-demo-demo'
where id = '30000000-0000-0000-0000-000000000007';

update public.blocks set alerts = '[{"kind":"closes","text":"Última visita 17:00"}]'::jsonb
where id = '30000000-0000-0000-0000-000000000006';

update public.blocks set transfer = '{"from":"Montevideo","to":"Colonia del Sacramento","mode":"bus","duration_min":165}'::jsonb,
  cost_estimate = 900, cost_currency = 'UYU'
where id = '30000000-0000-0000-0000-000000000015';

update public.blocks set transfer = '{"from":"Montevideo","to":"Buenos Aires","mode":"ferry","duration_min":135}'::jsonb,
  cost_estimate = 90, cost_currency = 'USD'
where id = '30000000-0000-0000-0000-000000000021';

update public.blocks set transfer = '{"from":"Colonia del Sacramento","to":"Buenos Aires","mode":"ferry","duration_min":75}'::jsonb,
  cost_estimate = 60, cost_currency = 'USD'
where id = '30000000-0000-0000-0000-000000000026';

update public.blocks set transfer = '{"from":"Buenos Aires","to":"Casa","mode":"flight","duration_min":90}'::jsonb
where id = '30000000-0000-0000-0000-000000000030';

update public.blocks set description = 'Nos juntamos todos de nuevo después de los tramos en paralelo.'
where id = '30000000-0000-0000-0000-000000000027';

update public.blocks set description = 'Paseo a pie con Don Julio por las 10 paradas de Ciudad Vieja.'
where id = '30000000-0000-0000-0000-000000000005';

-- Un bloque creado por Ana (para el feed)
update public.blocks set created_by = '00000000-0000-0000-0000-000000000002'
where id = '30000000-0000-0000-0000-000000000004';

-- Participantes: miembros del tramo, salvo excepciones
insert into public.block_participants (block_id, user_id)
select b.id, lm.user_id
from public.blocks b
join public.leg_members lm on lm.leg_id = b.leg_id
where b.trip_id = '10000000-0000-0000-0000-000000000001'
  and b.id not in ('30000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000026');

-- Privado de Juan: solo Juan
insert into public.block_participants (block_id, user_id) values
  ('30000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001');

-- Ferry Colonia → Buenos Aires: solo los que estaban en Colonia
insert into public.block_participants (block_id, user_id) values
  ('30000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- Propuesta pendiente del agente: cambiar la cena del lunes 19
-- ---------------------------------------------------------------------------
insert into public.agent_proposals (id, trip_id, leg_id, day_id, created_by, by_agent, summary, reason, ops, status, created_at)
values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  true,
  'Mover la cena del lunes a La Perdiz, en Punta Carretas',
  'Terminan la tarde en Pocitos: cenar por la zona les ahorra volver hasta Ciudad Vieja.',
  jsonb_build_array(jsonb_build_object(
    'op', 'update',
    'block_id', '30000000-0000-0000-0000-000000000012',
    'patch', jsonb_build_object(
      'title', 'Cena en La Perdiz',
      'place_name', 'La Perdiz',
      'lat', -34.9195,
      'lng', -56.1580,
      'start_time', '20:30',
      'end_time', '22:30'
    )
  )),
  'pending',
  now() - interval '2 hours'
);

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
insert into public.personas (id, kind, name, city, style, voice, system_prompt) values
  ('40000000-0000-0000-0000-000000000001', 'companion', 'Lucía', null, 'amigable', 'marin',
   'Sos Lucía, la compañera de viaje del grupo. Hablás en español rioplatense, con voseo, cálida y al grano. '
   || 'Ayudás a organizar el día, en lo compartido proponés en vez de cambiar, y nunca inventás datos: '
   || 'si no sabés algo, lo decís y lo buscás con tus herramientas.'),
  ('40000000-0000-0000-0000-000000000002', 'local', 'Don Julio, vecino de Ciudad Vieja', 'Montevideo', 'neighbor', 'cedar',
   'Sos Don Julio, vecino de toda la vida de Ciudad Vieja, en Montevideo. Hablás en rioplatense, pausado y con humor. '
   || 'Guiás paseos a pie contando lo que el grupo tiene enfrente. Solo contás datos que estén en el contenido curado '
   || 'de cada parada; si no está, lo decís con naturalidad y no inventás.');

-- ---------------------------------------------------------------------------
-- place_library (tier curated) · 10 lugares de Ciudad Vieja
-- facts vacíos a propósito: el contenido lo carga el equipo con fuentes verificadas.
-- Coordenadas aproximadas = mismas que scripts/make-track.ts.
-- ---------------------------------------------------------------------------
insert into public.place_library (id, name, lat, lng, city, country, tier, facts, base_lang) values
  ('80000000-0000-0000-0000-000000000001', 'Puerta de la Ciudadela',  -34.90674, -56.20125, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000002', 'Plaza Independencia',     -34.90661, -56.19950, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000003', 'Palacio Salvo',           -34.90598, -56.19870, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000004', 'Teatro Solís',            -34.90722, -56.20056, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000005', 'Peatonal Sarandí',        -34.90690, -56.20250, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000006', 'Plaza Matriz',            -34.90690, -56.20520, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000007', 'Catedral Metropolitana',  -34.90660, -56.20600, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000008', 'Cabildo',                 -34.90745, -56.20525, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000009', 'Museo Torres García',     -34.90697, -56.20330, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es'),
  ('80000000-0000-0000-0000-000000000010', 'Mercado del Puerto',      -34.90670, -56.21280, 'Montevideo', 'UY', 'curated', '[]'::jsonb, 'es');

-- ---------------------------------------------------------------------------
-- Tour "Ciudad Vieja" (ready, planned, Don Julio) + 10 paradas
-- ---------------------------------------------------------------------------
insert into public.tours (
  id, trip_id, block_id, owner_user_id, mode, title, persona_id, duration_min,
  start_lat, start_lng, end_point, status
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'planned', 'Ciudad Vieja',
  '40000000-0000-0000-0000-000000000002',
  150, -34.90674, -56.20125,
  '{"lat":-34.90670,"lng":-56.21280,"label":"Mercado del Puerto"}'::jsonb,
  'ready'
);

update public.blocks set tour_id = '50000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000005';

insert into public.tour_stops (
  id, tour_id, place_id, sort_order, geofence_radius_m, look_at,
  narration_short, narration_more, narration_secret, transition_to_next, nav_to_next, sources
)
select
  ('90000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '50000000-0000-0000-0000-000000000001',
  ('80000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  n, 35, 'PENDIENTE',
  'PENDIENTE contenido curado', 'PENDIENTE contenido curado', 'PENDIENTE contenido curado',
  case when n < 10 then 'PENDIENTE contenido curado' end,
  case when n < 10 then 'PENDIENTE' end,
  '[]'::jsonb
from generate_series(1, 10) as n;

-- ---------------------------------------------------------------------------
-- activity_feed de ejemplo
-- ---------------------------------------------------------------------------
insert into public.activity_feed (trip_id, actor_user_id, actor_agent, kind, payload, created_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', false, 'trip_planned',
   '{"summary":"Juan armó el viaje Montevideo + Buenos Aires"}'::jsonb, now() - interval '3 days'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', false, 'member_joined',
   '{"summary":"Ana se sumó al viaje"}'::jsonb, now() - interval '3 days' + interval '1 hour'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', false, 'member_joined',
   '{"summary":"Leo se sumó al viaje"}'::jsonb, now() - interval '3 days' + interval '2 hours'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', false, 'member_joined',
   '{"summary":"Sofi se sumó al viaje y se va unos días antes a Buenos Aires"}'::jsonb, now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', false, 'block_added',
   '{"summary":"Ana agregó la Feria de Tristán Narvaja el domingo a la mañana","block_id":"30000000-0000-0000-0000-000000000004","day_id":"60000000-0000-0000-0000-000000000002"}'::jsonb,
   now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', false, 'busy_changed',
   '{"summary":"Juan tiene un rato ocupado el domingo","day_id":"60000000-0000-0000-0000-000000000002"}'::jsonb,
   now() - interval '5 hours'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', true, 'proposal_created',
   '{"summary":"El agente propone mover la cena del lunes a La Perdiz","proposal_id":"70000000-0000-0000-0000-000000000001","day_id":"60000000-0000-0000-0000-000000000003"}'::jsonb,
   now() - interval '2 hours');
