// "Tour acá, ahora" (PRD 18). STUB del lado de la app: la generación la implementa el PRD 06/18 (Josefina)
// como la herramienta `generate_tour` en la API. Mientras la API no la tenga, la UI muestra "pronto".
//
// Interfaz que usa la app (estable; PRD 18 puede reemplazar el cuerpo):
//   isNearbyTourAvailable(): Promise<boolean>   ¿la API ya expone generate_tour? (lee GET /health → tools)
//   startNearbyTour({ lat, lng, trip_id?, duration_min?, themes? }): Promise<NearbyTourResult>
//      → POST /tools/generate_tour { mode:'spontaneous', ... } → { job_id, tour_id }  (PRD 18, Datos)
import { useQuery } from '@tanstack/react-query';

import { env } from '../../lib/env';
import { supabase } from '../../lib/supabase';

export const NEARBY_TOUR_TOOL = 'generate_tour';

export type StartNearbyTourInput = {
  lat: number;
  lng: number;
  trip_id?: string;
  duration_min?: number;
  themes?: string[];
};

export type NearbyTourResult =
  | { ok: true; job_id: string; tour_id: string }
  | { ok: false; code: 'not_available' | 'no_location' | 'error'; message: string };

/** Herramientas que expone la API (GET /health). Lista vacía si no responde. */
export async function fetchApiTools(): Promise<string[]> {
  if (!env.apiUrl) return [];
  try {
    const res = await fetch(`${env.apiUrl}/health`);
    const json = (await res.json()) as { tools?: unknown };
    return Array.isArray(json.tools) ? json.tools.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function isNearbyTourAvailable(): Promise<boolean> {
  return (await fetchApiTools()).includes(NEARBY_TOUR_TOOL);
}

/** Hook: ¿está la herramienta? (se revisa al montar y cada 5 min; no es polling de datos del viaje). */
export function useNearbyTourAvailable() {
  return useQuery({ queryKey: ['api', 'tools', NEARBY_TOUR_TOOL], queryFn: isNearbyTourAvailable, staleTime: 5 * 60_000 });
}

export async function startNearbyTour(input: StartNearbyTourInput): Promise<NearbyTourResult> {
  if (!(await isNearbyTourAvailable())) {
    return { ok: false, code: 'not_available', message: 'El "Tour acá, ahora" llega muy pronto.' };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, code: 'error', message: 'No hay sesión' };
  try {
    // generate_tour todavía no está en packages/shared (lo agrega PRD 06): llamada cruda.
    const res = await fetch(`${env.apiUrl}/tools/${NEARBY_TOUR_TOOL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'spontaneous', duration_min: 60, ...input }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; data: { job_id: string; tour_id: string } }
      | { ok: false; error: { message: string } }
      | null;
    if (json && json.ok) return { ok: true, job_id: json.data.job_id, tour_id: json.data.tour_id };
    return { ok: false, code: 'error', message: json && !json.ok ? json.error.message : `Error ${res.status}` };
  } catch (e) {
    return { ok: false, code: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
