-- PRD-00 · RLS según la "Matriz RLS (MVP)".
-- service_role hace bypass de RLS: "solo service role" = sin policy de escritura para authenticated.

alter table public.profiles            enable row level security;
alter table public.saved_places        enable row level security;
alter table public.trips               enable row level security;
alter table public.trip_members        enable row level security;
alter table public.legs                enable row level security;
alter table public.leg_members         enable row level security;
alter table public.days                enable row level security;
alter table public.blocks              enable row level security;
alter table public.block_participants  enable row level security;
alter table public.agent_proposals     enable row level security;
alter table public.polls               enable row level security;
alter table public.poll_votes          enable row level security;
alter table public.activity_feed       enable row level security;
alter table public.member_locations    enable row level security;
alter table public.expenses            enable row level security;
alter table public.settlements         enable row level security;
alter table public.personas            enable row level security;
alter table public.place_library       enable row level security;
alter table public.tours               enable row level security;
alter table public.tour_stops          enable row level security;
alter table public.place_error_reports enable row level security;
alter table public.voice_sessions      enable row level security;
alter table public.memories            enable row level security;
alter table public.content_told        enable row level security;
alter table public.photos              enable row level security;
alter table public.diary_entries       enable row level security;
alter table public.agent_jobs          enable row level security;
alter table public.device_tokens       enable row level security;
alter table public.notifications       enable row level security;
alter table public.trip_recaps         enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: uno mismo + co-miembros · update: uno mismo
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- saved_places / device_tokens: propio
create policy saved_places_own on public.saved_places for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy device_tokens_own on public.device_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- trips: select miembro · insert created_by = auth.uid() · update/delete organizer
-- (el creador también ve su fila: insert ... returning corre antes del trigger de membresía)
-- ---------------------------------------------------------------------------
create policy trips_select on public.trips for select to authenticated
  using (public.is_trip_member(id) or created_by = auth.uid());
create policy trips_insert on public.trips for insert to authenticated
  with check (created_by = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (public.trip_role(id) = 'organizer') with check (public.trip_role(id) = 'organizer');
create policy trips_delete on public.trips for delete to authenticated
  using (public.trip_role(id) = 'organizer');

-- ---------------------------------------------------------------------------
-- trip_members: select miembro del mismo viaje · insert solo service role / trigger
-- update/delete: uno mismo u organizer (triggers protegen role y "≥ 1 organizer")
-- ---------------------------------------------------------------------------
create policy trip_members_select on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_members_update on public.trip_members for update to authenticated
  using (user_id = auth.uid() or public.trip_role(trip_id) = 'organizer')
  with check (user_id = auth.uid() or public.trip_role(trip_id) = 'organizer');
create policy trip_members_delete on public.trip_members for delete to authenticated
  using (user_id = auth.uid() or public.trip_role(trip_id) = 'organizer');

-- ---------------------------------------------------------------------------
-- legs / leg_members / days: select miembro · escritura organizer (days también viajero del tramo)
-- ---------------------------------------------------------------------------
create policy legs_select on public.legs for select to authenticated
  using (public.is_trip_member(trip_id));
create policy legs_write on public.legs for all to authenticated
  using (public.trip_role(trip_id) = 'organizer')
  with check (public.trip_role(trip_id) = 'organizer');

create policy leg_members_select on public.leg_members for select to authenticated
  using (public.is_trip_member(public.leg_trip_id(leg_id)));
create policy leg_members_write on public.leg_members for all to authenticated
  using (public.trip_role(public.leg_trip_id(leg_id)) = 'organizer')
  with check (public.trip_role(public.leg_trip_id(leg_id)) = 'organizer');

create policy days_select on public.days for select to authenticated
  using (public.is_trip_member(public.leg_trip_id(leg_id)));
create policy days_write on public.days for all to authenticated
  using (public.can_edit_leg(leg_id))
  with check (public.can_edit_leg(leg_id));

-- ---------------------------------------------------------------------------
-- blocks / block_participants
-- select: miembro y (no privado o participante o creador)
-- escritura: organizer, o viajero leg_member del tramo del bloque. Seguidor: nada.
-- ---------------------------------------------------------------------------
create policy blocks_select on public.blocks for select to authenticated
  using (
    public.is_trip_member(trip_id)
    and (not coalesce(is_private, false) or public.is_block_participant(id) or created_by = auth.uid())
  );
create policy blocks_insert on public.blocks for insert to authenticated
  with check (public.can_edit_leg(leg_id) and trip_id = public.leg_trip_id(leg_id));
create policy blocks_update on public.blocks for update to authenticated
  using (public.can_edit_leg(leg_id))
  with check (public.can_edit_leg(leg_id) and trip_id = public.leg_trip_id(leg_id));
create policy blocks_delete on public.blocks for delete to authenticated
  using (public.can_edit_leg(leg_id));

create policy block_participants_select on public.block_participants for select to authenticated
  using (public.can_see_block(block_id));
create policy block_participants_insert on public.block_participants for insert to authenticated
  with check (public.can_edit_block(block_id));
create policy block_participants_update on public.block_participants for update to authenticated
  using (public.can_edit_block(block_id)) with check (public.can_edit_block(block_id));
create policy block_participants_delete on public.block_participants for delete to authenticated
  using (public.can_edit_block(block_id));

-- ---------------------------------------------------------------------------
-- agent_proposals: select miembro · insert miembro no seguidor · update organizer
-- ---------------------------------------------------------------------------
create policy agent_proposals_select on public.agent_proposals for select to authenticated
  using (public.is_trip_member(trip_id));
create policy agent_proposals_insert on public.agent_proposals for insert to authenticated
  with check (public.trip_role(trip_id) in ('organizer','traveler'));
create policy agent_proposals_update on public.agent_proposals for update to authenticated
  using (public.trip_role(trip_id) = 'organizer')
  with check (public.trip_role(trip_id) = 'organizer');

-- ---------------------------------------------------------------------------
-- activity_feed: select miembro · insert miembro con actor_user_id = auth.uid() · append-only
-- ---------------------------------------------------------------------------
create policy activity_feed_select on public.activity_feed for select to authenticated
  using (public.is_trip_member(trip_id));
create policy activity_feed_insert on public.activity_feed for insert to authenticated
  with check (public.is_trip_member(trip_id) and actor_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- member_locations: select miembro (PRD 13 refina) · upsert solo la fila propia
-- ---------------------------------------------------------------------------
create policy member_locations_select on public.member_locations for select to authenticated
  using (public.is_trip_member(trip_id));
create policy member_locations_insert on public.member_locations for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy member_locations_update on public.member_locations for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- agent_jobs: select propio o miembro del viaje · escritura service role
-- ---------------------------------------------------------------------------
create policy agent_jobs_select on public.agent_jobs for select to authenticated
  using (user_id = auth.uid() or (trip_id is not null and public.is_trip_member(trip_id)));

-- ---------------------------------------------------------------------------
-- personas / place_library / tour_stops: cualquier autenticado · escritura service role
-- ---------------------------------------------------------------------------
create policy personas_select on public.personas for select to authenticated using (true);
create policy place_library_select on public.place_library for select to authenticated using (true);
create policy tour_stops_select on public.tour_stops for select to authenticated using (true);

-- tours: dueño o miembro del viaje · escritura service role
create policy tours_select on public.tours for select to authenticated
  using (owner_user_id = auth.uid() or (trip_id is not null and public.is_trip_member(trip_id)));

-- voice_sessions: participante · escritura service role
create policy voice_sessions_select on public.voice_sessions for select to authenticated
  using (auth.uid() = any (participants));

-- memories: personal → propio; trip → miembro; siempre no borradas · escritura service role
create policy memories_select on public.memories for select to authenticated
  using (
    deleted_at is null and (
      (scope = 'personal' and user_id = auth.uid())
      or (scope = 'trip' and trip_id is not null and public.is_trip_member(trip_id))
    )
  );

-- ---------------------------------------------------------------------------
-- resto: select miembro (o propio si no hay trip_id) · escritura miembro no seguidor
-- ---------------------------------------------------------------------------
create policy polls_select on public.polls for select to authenticated
  using (public.is_trip_member(trip_id));
create policy polls_write on public.polls for all to authenticated
  using (public.trip_role(trip_id) in ('organizer','traveler'))
  with check (public.trip_role(trip_id) in ('organizer','traveler'));

create policy poll_votes_select on public.poll_votes for select to authenticated
  using (public.is_trip_member(public.poll_trip_id(poll_id)));
create policy poll_votes_write on public.poll_votes for all to authenticated
  using (user_id = auth.uid() and public.trip_role(public.poll_trip_id(poll_id)) in ('organizer','traveler'))
  with check (user_id = auth.uid() and public.trip_role(public.poll_trip_id(poll_id)) in ('organizer','traveler'));

create policy expenses_select on public.expenses for select to authenticated
  using (public.is_trip_member(trip_id));
create policy expenses_write on public.expenses for all to authenticated
  using (public.trip_role(trip_id) in ('organizer','traveler'))
  with check (public.trip_role(trip_id) in ('organizer','traveler'));

create policy settlements_select on public.settlements for select to authenticated
  using (public.is_trip_member(trip_id));
create policy settlements_write on public.settlements for all to authenticated
  using (public.trip_role(trip_id) in ('organizer','traveler'))
  with check (public.trip_role(trip_id) in ('organizer','traveler'));

create policy photos_select on public.photos for select to authenticated
  using (user_id = auth.uid() or (trip_id is not null and public.is_trip_member(trip_id)));
create policy photos_write on public.photos for all to authenticated
  using (
    user_id = auth.uid()
    and (trip_id is null or public.trip_role(trip_id) in ('organizer','traveler'))
  )
  with check (
    user_id = auth.uid()
    and (trip_id is null or public.trip_role(trip_id) in ('organizer','traveler'))
  );

create policy diary_entries_select on public.diary_entries for select to authenticated
  using (public.is_trip_member(trip_id));
create policy diary_entries_write on public.diary_entries for all to authenticated
  using (public.trip_role(trip_id) in ('organizer','traveler'))
  with check (public.trip_role(trip_id) in ('organizer','traveler'));

-- content_told / place_error_reports: sin trip_id → propio
create policy content_told_own on public.content_told for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy place_error_reports_select on public.place_error_reports for select to authenticated
  using (user_id = auth.uid());
create policy place_error_reports_insert on public.place_error_reports for insert to authenticated
  with check (user_id = auth.uid());

-- v1.1: notifications → propio (escritura service role) · trip_recaps → miembro (grupales o propios)
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy trip_recaps_select on public.trip_recaps for select to authenticated
  using (public.is_trip_member(trip_id) and (user_id is null or user_id = auth.uid()));
