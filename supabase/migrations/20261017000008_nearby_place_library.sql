-- PRD 06: candidatos de place_library cerca de un punto. PostgREST no filtra geography por ST_DWithin
-- directo desde la URL, así que lo exponemos como RPC (mismo estilo que place_library.geo: schema extensions).
create or replace function public.nearby_place_library(center_lat double precision, center_lng double precision, radius_m double precision)
returns setof public.place_library
language sql stable
as $$
  select *
  from public.place_library
  where extensions.st_dwithin(
    geo,
    extensions.st_setsrid(extensions.st_makepoint(center_lng, center_lat), 4326)::extensions.geography,
    radius_m
  )
$$;

grant execute on function public.nearby_place_library(double precision, double precision, double precision) to anon, authenticated, service_role;
