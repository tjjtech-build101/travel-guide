-- PRD 31 · Planificador colaborativo. Aditivo: tablas nuevas + 1 columna nullable en blocks.
-- 1) destination_catalog: catálogo global por ciudad (imperdibles, joyas, escapadas…), lo escribe solo la API.
-- 2) leg_options + leg_option_reactions: el menú de cada tramo y las reacciones del grupo (Realtime).
-- 3) blocks.choice_group: bloques "elegí 1 de N" en un mismo lugar del día.

create table if not exists public.destination_catalog (
  id uuid primary key default gen_random_uuid(),
  city_key text not null unique,            -- "buenos aires|argentina" (minúsculas, sin acentos)
  city text not null,
  country text,
  lat double precision,
  lng double precision,
  items jsonb not null default '[]'::jsonb, -- CatalogItem[] (packages/shared/src/planner.ts)
  lodging_zones jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.leg_options (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  leg_id uuid not null references public.legs(id) on delete cascade,
  item jsonb not null,                       -- CatalogItem
  section text not null check (section in ('must','for_you','gems','food','day_trips','events')),
  score real not null default 0,
  for_user_ids uuid[] not null default '{}',
  reason text,
  preselected boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists leg_options_leg_idx on public.leg_options (leg_id, section, sort_order);
create index if not exists leg_options_trip_idx on public.leg_options (trip_id);

create table if not exists public.leg_option_reactions (
  option_id uuid not null references public.leg_options(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('love','no','must')),
  created_at timestamptz default now(),
  primary key (option_id, user_id)
);
create index if not exists leg_option_reactions_trip_idx on public.leg_option_reactions (trip_id);

alter table public.blocks add column if not exists choice_group uuid;
create index if not exists blocks_choice_group_idx on public.blocks (choice_group) where choice_group is not null;

-- La vista suma choice_group al final (create or replace solo admite columnas nuevas al final).
create or replace view public.blocks_visible with (security_barrier = true) as
select b.id, b.trip_id, b.leg_id, b.day_id, b.type,
  case when m.masked then 'Ocupado' else b.title end as title,
  case when m.masked then null else b.description end as description,
  case when m.masked then null else b.google_place_id end as google_place_id,
  case when m.masked then null else b.place_name end as place_name,
  case when m.masked then null else b.lat end as lat,
  case when m.masked then null else b.lng end as lng,
  b.start_time, b.end_time, b.time_flex, b.duration_min, b.is_private, b.status, b.plan_variant,
  case when m.masked then null else b.cost_estimate end as cost_estimate,
  case when m.masked then null else b.cost_currency end as cost_currency,
  case when m.masked then null else b.booking_url end as booking_url,
  case when m.masked then null else b.notes end as notes,
  case when m.masked then null else b.transfer end as transfer,
  case when m.masked then null else b.alerts end as alerts,
  case when m.masked then null else b.sources end as sources,
  b.tour_id, b.sort_order, b.created_by, b.created_by_agent, b.created_at, b.updated_at,
  m.masked,
  b.choice_group
from public.blocks b
cross join lateral (select (b.is_private and not public.is_block_participant(b.id)
  and b.created_by is distinct from auth.uid()) as masked) m
where public.is_trip_member(b.trip_id);

-- RLS
alter table public.destination_catalog enable row level security;
alter table public.leg_options enable row level security;
alter table public.leg_option_reactions enable row level security;

create policy destination_catalog_select on public.destination_catalog for select to authenticated using (true);

create policy leg_options_select on public.leg_options for select to authenticated
  using (public.is_trip_member(trip_id));

create policy leg_option_reactions_select on public.leg_option_reactions for select to authenticated
  using (public.is_trip_member(trip_id));
-- Escrituras: solo la API (service role) después de validar membresía (react_option).

-- Realtime
alter table public.leg_options replica identity full;
alter table public.leg_option_reactions replica identity full;
alter publication supabase_realtime add table public.leg_options, public.leg_option_reactions;
