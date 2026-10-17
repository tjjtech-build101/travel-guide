-- PRD-00 · Realtime: exactamente las tablas de Contratos.
-- days / trip_members / leg_members NO se publican (la app refresca el overview).

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

-- replica identity full: los UPDATE/DELETE llegan con la fila vieja completa (incluye trip_id,
-- necesario para el filtro trip_id=eq.<id> del canal y para invalidar el día correcto).
alter table public.blocks             replica identity full;
alter table public.block_participants replica identity full;
alter table public.legs               replica identity full;
alter table public.agent_proposals    replica identity full;
alter table public.polls              replica identity full;
alter table public.activity_feed      replica identity full;
alter table public.member_locations   replica identity full;
alter table public.expenses           replica identity full;
alter table public.agent_jobs         replica identity full;

alter publication supabase_realtime add table
  public.blocks,
  public.block_participants,
  public.legs,
  public.agent_proposals,
  public.polls,
  public.activity_feed,
  public.member_locations,
  public.expenses,
  public.agent_jobs;
