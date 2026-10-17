-- Las filas de activity_feed sobre bloques privados guardan el detalle en payload.inverse (para deshacer).
-- Solo las ve quien las hizo; el resto del viaje se entera por la fila busy_changed (sin detalles).
drop policy if exists activity_feed_select on public.activity_feed;
create policy activity_feed_select on public.activity_feed for select to authenticated
  using (
    public.is_trip_member(trip_id)
    and (coalesce((payload ->> 'private')::boolean, false) = false or actor_user_id = auth.uid())
  );
