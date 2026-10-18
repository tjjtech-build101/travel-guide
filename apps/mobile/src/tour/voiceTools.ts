// Herramientas de tour cuando las llama el Scout (PRD 07). Siguen yendo al backend (POST /tools/:name, actor agent),
// pero el celu se entera para que el motor local no quede desfasado:
//  - start_tour: arranca el motor (el tour por voz: "dale, arrancamos").
//  - tour_status: manda el estado local como verdad (progress) y la última posición (ETA a la próxima).
//  - skip_stop: la saltea también en el motor.
//  - get_stop_content: marca la capa como contada (el próximo dwell no la ofrece de nuevo).
//  - at_stop (solo del celu, tour interno): "llegué / estoy frente a X" → marca la llegada en el motor.
//  - next_stop: en el tour interno, además sale de la parada actual (adentro no hay GPS que lo note).
// Se registran con registerLocalTool de PRD 05 (toolBridge): mismo camino, sin tocar la voz.
import { engineProgress, pendingEngineStops, type StartTourResult, type StopContentResult, type StopLayer, type ToolResponse } from '@build101/shared';

import { callTool } from '../lib/api';
import { cameraTourHooks } from '../voice/camera/cameraStore';
import { registerLocalTool } from '../voice/toolBridge';
import { useVoiceStore } from '../voice/store';
import { useTourStore } from './store';

let registered = false;

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ');
const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'en', 'y', 'a', 'al', 'sala', 'frente', 'estoy', 'llegue', 'the']);
const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** La parada que la persona nombró ("la de los juguetes") por palabras en común; null si ninguna coincide. */
export function matchStopByName<S extends { stop_id: string; name: string }>(stops: S[], said: string): S | null {
  const want = new Set(words(said));
  let best: S | null = null;
  let score = 0;
  for (const s of stops) {
    const n = words(s.name).filter((w) => want.has(w)).length;
    if (n > score) {
      best = s;
      score = n;
    }
  }
  return best;
}

export function registerTourVoiceTools() {
  if (registered) return;
  registered = true;

  // Cámara en tour interno: compara contra las paradas del tour en curso y una foto reconocida es una llegada.
  cameraTourHooks.tourId = () => {
    const t = useTourStore.getState();
    return t.phase === 'live' && t.live?.indoor ? t.live.tourId : null;
  };
  cameraTourHooks.onTourStop = (stopId) => {
    if (useTourStore.getState().live?.indoor) useTourStore.getState().arrive(stopId, 'photo');
  };

  registerLocalTool('start_tour', async (input) => {
    const res = (await callTool('start_tour', input as never, { actor: 'agent' })) as ToolResponse<StartTourResult>;
    if (res.ok) {
      useTourStore.getState().startFromResult(res.data, { tripId: useVoiceStore.getState().args?.tripId ?? null });
    }
    return res;
  });

  registerLocalTool('tour_status', async (input) => {
    const live = useTourStore.getState().live;
    const tourId = str(input.tour_id);
    const body: Record<string, unknown> = { ...input };
    if (live && tourId === live.tourId) {
      body.progress = engineProgress(live.tour, live.engine);
      const fix = live.engine.lastFix;
      if (fix && body.lat == null) {
        body.lat = fix.lat;
        body.lng = fix.lng;
      }
    }
    return callTool('tour_status', body as never, { actor: 'agent' });
  });

  registerLocalTool('skip_stop', async (input) => {
    const res = await callTool('skip_stop', input as never, { actor: 'agent' });
    const live = useTourStore.getState().live;
    const stopId = str(input.stop_id);
    if (res.ok && live && stopId && str(input.tour_id) === live.tourId) useTourStore.getState().skip(stopId, { remote: false });
    return res;
  });

  registerLocalTool('at_stop', async (input) => {
    const t = useTourStore.getState();
    const live = t.live;
    if (!live || t.phase !== 'live') return { ok: false, error: { code: 'no_tour', message: 'No hay un tour en curso.' } };
    const byId = str(input.stop_id) ? live.stops.find((s) => s.stop_id === input.stop_id) : undefined;
    const byName = !byId && str(input.name) ? matchStopByName(live.stops, String(input.name)) : null;
    // Sin decir cuál: la próxima pendiente (la que estaban buscando).
    const next = pendingEngineStops(live.tour, live.engine)[0];
    const stop = byId ?? byName ?? (next ? live.stops.find((s) => s.stop_id === next.stop_id) : undefined);
    if (!stop) return { ok: false, error: { code: 'unknown_stop', message: 'No sé a qué parada llegó; preguntale cuál es.' } };
    const payload = t.arrive(stop.stop_id, 'voice');
    const already = !payload && live.engine.insideStopId === stop.stop_id;
    return {
      ok: true,
      data: {
        stop_id: stop.stop_id,
        name: stop.name,
        look_at: stop.look_at,
        already_here: already,
        layers_told: payload?.layers_told ?? live.engine.told[stop.stop_id] ?? [],
        pending_stops: payload?.pending_stops ?? null,
        next: 'Narrala ya con get_stop_content(stop_id, layer:"short") (o la capa que falte), sin preguntar.',
      },
    };
  });

  registerLocalTool('next_stop', async (input) => {
    const res = await callTool('next_stop', input as never, { actor: 'agent' });
    const t = useTourStore.getState();
    if (res.ok && t.live?.indoor && str(input.tour_id) === t.live.tourId) t.leave();
    return res;
  });

  registerLocalTool('get_stop_content', async (input) => {
    const res = (await callTool('get_stop_content', input as never, { actor: 'agent' })) as ToolResponse<StopContentResult>;
    if (res.ok && res.data.text) useTourStore.getState().markTold(res.data.stop_id, res.data.layer as StopLayer);
    return res;
  });
}
