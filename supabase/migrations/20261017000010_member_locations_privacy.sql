-- Ahora v2 (docs/AHORA-V2.md) + PRD 13: privacidad de member_locations.
-- · select: mi fila siempre; las de otros solo si su dueño comparte (location_sharing <> 'never') y no está en
--   modo fantasma (ghost_until nulo o vencido). Seguidores: además share_location_with_followers = true.
-- · delete: solo la propia fila (la app la borra al dejar de compartir).
-- insert/update ya eran "solo la fila propia" (20261017000004_rls.sql).

create or replace function public.member_location_visible(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    p_user_id = auth.uid()
    or exists (
      select 1
      from public.trip_members owner
      join public.trip_members viewer
        on viewer.trip_id = owner.trip_id and viewer.user_id = auth.uid()
      where owner.trip_id = p_trip_id
        and owner.user_id = p_user_id
        and coalesce(owner.location_sharing, 'shared_only') <> 'never'
        and (owner.ghost_until is null or owner.ghost_until <= now())
        and (viewer.role <> 'follower' or owner.share_location_with_followers)
    );
$$;

drop policy if exists member_locations_select on public.member_locations;
create policy member_locations_select on public.member_locations for select to authenticated
  using (public.is_trip_member(trip_id) and public.member_location_visible(trip_id, user_id));

drop policy if exists member_locations_delete on public.member_locations;
create policy member_locations_delete on public.member_locations for delete to authenticated
  using (user_id = auth.uid());
