-- PRD-00 · Vista blocks_visible.
-- Owner por defecto (NO security_invoker): ve los privados ajenos y los enmascara.
-- Filtra por membresía con auth.uid().
create view public.blocks_visible with (security_barrier = true) as
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
  m.masked
from public.blocks b
cross join lateral (select (b.is_private and not public.is_block_participant(b.id)
  and b.created_by is distinct from auth.uid()) as masked) m
where public.is_trip_member(b.trip_id);

revoke all on public.blocks_visible from anon;
grant select on public.blocks_visible to authenticated;
