-- PRD-00 · Esquema completo de Contratos (docs/CONTRACTS.md) + "Cambios v1.1".
-- Nombres de tablas / columnas / checks EXACTOS de Contratos. Cambiar algo acá = cambiar packages/shared también.
-- Las FKs de usuarios apuntan a public.profiles(id) (que a su vez referencia auth.users con cascade)
-- para que PostgREST pueda embeber perfiles (ej. trip_members?select=*,profiles(*)).

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- Código de invitación: 8 caracteres de ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (sin 0/O/1/I).
create or replace function public.gen_invite_code()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- PERFIL
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text default 'es',
  home_currency text,
  interests jsonb,                                   -- {"arquitectura":3,"comida":4}
  pace text check (pace in ('relaxed','balanced','intense')),
  chronotype text check (chronotype in ('early','normal','night')),
  budget_level text check (budget_level in ('low','mid','high','no_limit')),
  dietary text[],
  mobility jsonb,
  languages text[],
  travel_style text check (travel_style in ('planned','mixed','spontaneous')),
  avoid text[],
  guide_name text,
  guide_voice text,
  guide_style text,                                  -- serious|neighbor|kids
  quiet_hours jsonb,
  notification_prefs jsonb,
  inferred_traits jsonb,                             -- perfil transparente
  onboarded_at timestamptz
);

create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_place_id text,
  name text,
  lat double precision,
  lng double precision,
  city text,
  country text,
  note text,
  created_at timestamptz default now()
);
create unique index saved_places_user_place_uidx on public.saved_places (user_id, google_place_id);

-- ---------------------------------------------------------------------------
-- VIAJE
-- ---------------------------------------------------------------------------

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cover_url text,
  base_currency text default 'USD',
  budget_mode text default 'unlimited' check (budget_mode in ('limited','unlimited')),
  status text default 'planning' check (status in ('planning','active','finished')),
  start_date date,
  end_date date,
  invite_code text not null unique default public.gen_invite_code(),
  share_id text unique,                              -- v1.1: link público de seguidor (null = desactivado)
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'traveler' check (role in ('organizer','traveler','follower')),
  joined_at timestamptz default now(),
  trip_prefs jsonb,                                  -- {goal, budget_per_person, must:[], avoid:[], companions}
  location_sharing text default 'shared_only' check (location_sharing in ('always','shared_only','never')),
  ghost_until timestamptz,
  share_location_with_followers bool default false,
  language text,
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);

create table public.legs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  city text,
  country text,
  google_place_id text,
  lat double precision,
  lng double precision,
  start_date date,
  end_date date,
  sort_order int
);
create index legs_trip_idx on public.legs (trip_id, sort_order);

create table public.leg_members (
  leg_id uuid not null references public.legs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (leg_id, user_id)
);
create index leg_members_user_idx on public.leg_members (user_id);

create table public.days (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.legs(id) on delete cascade,
  date date not null,
  weather jsonb,
  briefing text,
  unique (leg_id, date)
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  leg_id uuid not null references public.legs(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,   -- null = banco de ideas
  type text not null check (type in ('activity','meal','tour','transfer','lodging','free','meetup')),
  title text not null,
  description text,
  google_place_id text,
  place_name text,
  lat double precision,
  lng double precision,
  geo extensions.geography(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  start_time time,
  end_time time,
  time_flex text default 'fixed' check (time_flex in ('fixed','morning','afternoon','evening','any')),
  duration_min int,
  is_private bool default false,
  status text default 'confirmed' check (status in ('idea','proposed','confirmed','booked')),
  plan_variant text default 'main' check (plan_variant in ('main','rain','closed')),
  cost_estimate numeric,
  cost_currency text,
  booking_url text,
  notes text,
  transfer jsonb,                                    -- {from, to, mode, duration_min}
  alerts jsonb,                                      -- [{kind:'closes'|'late'|'rain'|'diet', text}]
  sources jsonb,
  tour_id uuid,                                      -- FK a tours más abajo (referencia circular)
  sort_order int,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_agent bool default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index blocks_trip_day_idx on public.blocks (trip_id, day_id);
create index blocks_leg_idx on public.blocks (leg_id);
create index blocks_day_idx on public.blocks (day_id, start_time, sort_order);
create index blocks_geo_gist on public.blocks using gist (geo);

create table public.block_participants (
  block_id uuid not null references public.blocks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (block_id, user_id)
);
create index block_participants_user_idx on public.block_participants (user_id);

create table public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  leg_id uuid references public.legs(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  by_agent bool default false,
  summary text,
  reason text,
  ops jsonb,                                         -- [{op:'add'|'update'|'move'|'remove', block_id?, block?, patch?}]
  status text default 'pending' check (status in ('pending','accepted','rejected','expired','applied_urgent')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz default now()
);
create index agent_proposals_trip_idx on public.agent_proposals (trip_id, status, created_at desc);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete set null,
  question text,
  options jsonb,
  closes_at timestamptz,
  status text default 'open',
  result jsonb,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null
);
create index polls_trip_idx on public.polls (trip_id);

create table public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_idx int,
  primary key (poll_id, user_id)
);

create table public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_agent bool default false,
  kind text not null,
  payload jsonb,                                     -- {summary, inverse?, ...}
  undo_token text,
  created_at timestamptz default now()
);
create index activity_feed_trip_created_idx on public.activity_feed (trip_id, created_at desc);
create unique index activity_feed_undo_token_uidx on public.activity_feed (undo_token) where undo_token is not null;

create table public.member_locations (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision,
  lng double precision,
  heading double precision,
  speed double precision,
  accuracy double precision,
  battery double precision,
  updated_at timestamptz default now(),
  primary key (trip_id, user_id)                     -- solo la última posición
);

-- ---------------------------------------------------------------------------
-- GASTOS
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  leg_id uuid references public.legs(id) on delete set null,
  block_id uuid references public.blocks(id) on delete set null,
  payer_id uuid references public.profiles(id) on delete set null,
  amount numeric,
  currency text,
  amount_base numeric,
  description text,
  receipt_url text,
  split jsonb,                                       -- [{user_id, share}]
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index expenses_trip_idx on public.expenses (trip_id, created_at desc);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_user uuid references public.profiles(id) on delete set null,
  to_user uuid references public.profiles(id) on delete set null,
  amount_base numeric,
  settled_at timestamptz default now()
);
create index settlements_trip_idx on public.settlements (trip_id);

-- ---------------------------------------------------------------------------
-- TOURS Y CONTENIDO
-- ---------------------------------------------------------------------------

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  kind text check (kind in ('companion','local')),
  name text,
  city text,
  style text,
  voice text,
  system_prompt text
);

create table public.place_library (
  id uuid primary key default gen_random_uuid(),
  google_place_id text,
  osm_id text,
  wikidata_id text,
  name text,
  lat double precision,
  lng double precision,
  geo extensions.geography(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  city text,
  country text,
  tier text check (tier in ('curated','researched')),
  facts jsonb,                                       -- [{text, source_url, verified:bool}]
  base_lang text,
  embedding extensions.vector(1024),
  updated_at timestamptz default now()
);
create index place_library_geo_gist on public.place_library using gist (geo);
create index place_library_google_place_idx on public.place_library (google_place_id);
create index place_library_embedding_hnsw on public.place_library
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.tours (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete set null,
  owner_user_id uuid references public.profiles(id) on delete cascade,
  mode text check (mode in ('planned','spontaneous','explorer')),
  title text,
  persona_id uuid references public.personas(id) on delete set null,
  storyline text,
  duration_min int,
  start_lat double precision,
  start_lng double precision,
  end_point jsonb,
  status text default 'generating' check (status in ('generating','ready','active','done','failed')),
  created_at timestamptz default now(),
  route jsonb,                                       -- v1.1: {polyline, total_walk_m, est_duration_min}
  progress jsonb                                     -- v1.1: {current_stop_id, visited:[...], skipped:[], started_at, ends_at}
);
create index tours_trip_idx on public.tours (trip_id);
create index tours_owner_idx on public.tours (owner_user_id);

alter table public.blocks
  add constraint blocks_tour_id_fkey foreign key (tour_id) references public.tours(id) on delete set null;

create table public.tour_stops (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  place_id uuid references public.place_library(id) on delete set null,
  sort_order int,
  geofence_radius_m int default 35,
  look_at text,
  narration_short text,
  narration_more text,
  narration_secret text,
  myth_vs_fact text,
  photo_spot text,
  kid_mission text,
  transition_to_next text,
  nav_to_next text,
  sources jsonb,
  dwell_min int default 4                            -- v1.1
);
create index tour_stops_tour_idx on public.tour_stops (tour_id, sort_order);

create table public.place_error_reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.place_library(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  text text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- VOZ Y MEMORIA
-- ---------------------------------------------------------------------------

create table public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  tour_id uuid references public.tours(id) on delete set null,
  mode text check (mode in ('chat','tour')),
  participants uuid[],
  persona_id uuid references public.personas(id) on delete set null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  summary text,
  transcript jsonb,
  purpose text check (purpose in ('onboarding','translator'))   -- v1.1 (null = normal)
);
create index voice_sessions_participants_gin on public.voice_sessions using gin (participants);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  scope text check (scope in ('personal','trip')),
  user_id uuid references public.profiles(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  kind text,
  text text,
  source_session_id uuid references public.voice_sessions(id) on delete set null,
  created_at timestamptz default now(),
  deleted_at timestamptz
);
create index memories_user_idx on public.memories (user_id);
create index memories_trip_idx on public.memories (trip_id);

create table public.content_told (
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id uuid not null references public.place_library(id) on delete cascade,
  layer text not null,
  told_at timestamptz default now(),
  primary key (user_id, place_id, layer)
);

-- ---------------------------------------------------------------------------
-- DIARIO Y FOTOS
-- ---------------------------------------------------------------------------

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,  -- v1.1: nullable (tour espontáneo sin viaje)
  user_id uuid default auth.uid() references public.profiles(id) on delete cascade,
  url text,
  lat double precision,
  lng double precision,
  taken_at timestamptz,
  kind text check (kind in ('camera','gallery','receipt','generated')),
  caption text,
  place_id uuid references public.place_library(id) on delete set null,  -- v1.1
  heading double precision                                              -- v1.1
);
create index photos_trip_idx on public.photos (trip_id);
create index photos_user_idx on public.photos (user_id);

create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,  -- null = versión del grupo
  content jsonb,
  photo_ids uuid[],
  created_at timestamptz default now()
);
create index diary_entries_trip_idx on public.diary_entries (trip_id, day_id);

-- ---------------------------------------------------------------------------
-- INFRA
-- ---------------------------------------------------------------------------

create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text,
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  status text default 'queued',
  progress jsonb default '[]'::jsonb,                -- [{at, text}]
  result jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index agent_jobs_user_idx on public.agent_jobs (user_id, created_at desc);
create index agent_jobs_trip_idx on public.agent_jobs (trip_id, created_at desc);

create table public.device_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text check (platform in ('ios','android','ios_voip')),
  updated_at timestamptz default now(),
  primary key (user_id, token)
);

-- v1.1 · PRD 17
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  category text,
  urgency text,
  channel text check (channel in ('call','push','feed')),
  title text,
  body text,
  data jsonb,
  status text default 'queued' check (status in ('queued','sent','bundled','suppressed')),
  send_after timestamptz,
  sent_at timestamptz,
  created_at timestamptz default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_queue_idx on public.notifications (status, send_after);

-- v1.1 · PRD 24
create table public.trip_recaps (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  kind text check (kind in ('wrapped','postcard','podcast','quiz')),
  content jsonb,
  media_url text,
  created_at timestamptz default now()
);
create index trip_recaps_trip_idx on public.trip_recaps (trip_id);
