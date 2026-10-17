// Herramientas de tour cuando las llama el Scout (PRD 07). Siguen yendo al backend (POST /tools/:name, actor agent),
// pero el celu se entera para que el motor local no quede desfasado:
//  - start_tour: arranca el motor (el tour por voz: "dale, arrancamos").
//  - tour_status: manda el estado local como verdad (progress) y la última posición (ETA a la próxima).
//  - skip_stop: la saltea también en el motor.
//  - get_stop_content: marca la capa como contada (el próximo dwell no la ofrece de nuevo).
// Se registran con registerLocalTool de PRD 05 (toolBridge): mismo camino, sin tocar la voz.
import { engineProgress, type StartTourResult, type StopContentResult, type StopLayer, type ToolResponse } from '@build101/shared';

import { callTool } from '../lib/api';
import { registerLocalTool } from '../voice/toolBridge';
import { useVoiceStore } from '../voice/store';
import { useTourStore } from './store';

let registered = false;

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

export function registerTourVoiceTools() {
  if (registered) return;
  registered = true;

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

  registerLocalTool('get_stop_content', async (input) => {
    const res = (await callTool('get_stop_content', input as never, { actor: 'agent' })) as ToolResponse<StopContentResult>;
    if (res.ok && res.data.text) useTourStore.getState().markTold(res.data.stop_id, res.data.layer as StopLayer);
    return res;
  });
}
