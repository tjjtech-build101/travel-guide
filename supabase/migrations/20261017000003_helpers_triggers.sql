-- PRD-00 · Helpers de RLS (security definer, stable) + triggers.

-- ---------------------------------------------------------------------------
-- Helpers (los usan las policies; security definer para no recursar en RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
  );
$$;

create or replace function public.trip_role(p_trip_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.trip_members
  where trip_id = p_trip_id and user_id = auth.uid();
$$;

create or replace function public.is_leg_member(p_leg_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.leg_members
    where leg_id = p_leg_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_block_participant(p_block_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.block_participants
    where block_id = p_block_id and user_id = auth.uid()
  );
$$;

-- Helpers extra (internos, mismos criterios que la Matriz RLS).

create or replace function public.leg_trip_id(p_leg_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select trip_id from public.legs where id = p_leg_id;
$$;

-- organizer del viaje, o viajero que es leg_member del tramo. Seguidor: nunca.
create or replace function public.can_edit_leg(p_leg_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select case public.trip_role(l.trip_id)
             when 'organizer' then true
             when 'traveler' then public.is_leg_member(l.id)
             else false
           end
    from public.legs l
    where l.id = p_leg_id
  ), false);
$$;

-- miembro y (no privado o participante o creador)
create or replace function public.can_see_block(p_block_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select public.is_trip_member(b.trip_id)
       and (not coalesce(b.is_private, false)
            or public.is_block_participant(b.id)
            or b.created_by = auth.uid())
    from public.blocks b
    where b.id = p_block_id
  ), false);
$$;

create or replace function public.can_edit_block(p_block_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((
    select public.can_edit_leg(b.leg_id) from public.blocks b where b.id = p_block_id
  ), false);
$$;

-- ¿auth.uid() comparte algún viaje con p_user_id?
create or replace function public.shares_trip_with(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members me
    join public.trip_members other on other.trip_id = me.trip_id
    where me.user_id = auth.uid() and other.user_id = p_user_id
  );
$$;

create or replace function public.poll_trip_id(p_poll_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select trip_id from public.polls where id = p_poll_id;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- updated_at
create trigger blocks_set_updated_at
  before update on public.blocks
  for each row execute function public.set_updated_at();

create trigger agent_jobs_set_updated_at
  before update on public.agent_jobs
  for each row execute function public.set_updated_at();

create trigger place_library_set_updated_at
  before update on public.place_library
  for each row execute function public.set_updated_at();

create trigger member_locations_set_updated_at
  before update on public.member_locations
  for each row execute function public.set_updated_at();

create trigger device_tokens_set_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();

-- auth.users → profiles (display_name / avatar_url desde la metadata de Google o del seed)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- trips → trip_members(organizer)
create or replace function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.trip_members (trip_id, user_id, role)
    values (new.id, new.created_by, 'organizer')
    on conflict (trip_id, user_id) do update set role = 'organizer';
  end if;
  return new;
end;
$$;

create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- trip_members: un no-organizer no puede cambiar role (service role / postgres sin JWT sí puede).
create or replace function public.trip_members_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and coalesce(public.trip_role(old.trip_id), '') <> 'organizer' then
    raise exception 'Solo un organizer puede cambiar el rol de un miembro'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trip_members_guard_role
  before update on public.trip_members
  for each row execute function public.trip_members_guard_role();

-- trip_members: el viaje no puede quedar con 0 organizers (salvo que se esté borrando el viaje).
create or replace function public.trip_members_keep_organizer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'organizer'
     and exists (select 1 from public.trips where id = old.trip_id)
     and not exists (
       select 1 from public.trip_members where trip_id = old.trip_id and role = 'organizer'
     ) then
    raise exception 'El viaje tiene que tener al menos un organizer'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger trip_members_keep_organizer
  after update or delete on public.trip_members
  for each row execute function public.trip_members_keep_organizer();
