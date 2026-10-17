// "Armame la tarde" (docs/AHORA-V2.md): plan_day. El agente propone (agent_proposals), nunca aplica solo:
// la propuesta aparece en el aviso "Scout propone N cambios" por Realtime.
import type { PlanDayOutput } from '@build101/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ToolCallError } from '../../../../lib/api';
import { planKeys } from '../../../plan/queries';
import { callNowTool } from './nowApi';

export type PlanDayVars = {
  tripId: string;
  dayId: string;
  /** Hora local HH:MM desde la que llenar. */
  fromTime: string;
  toTime?: string;
  here?: { lat: number; lng: number } | null;
  reason?: string;
};

/** Mensaje en español para mostrar si falla. */
export function planDayErrorText(e: unknown): string {
  if (e instanceof ToolCallError) {
    if (e.code === 'network_error') return 'Sin conexión: no pude armar la tarde.';
    // La API ya manda el texto amable ("Scout no está disponible ahora.").
    if (e.code === 'scout_unavailable' && e.message) return e.message;
    if (e.code === 'empty_plan') return 'No encontré nada que entre en ese rato.';
    if (e.code === 'forbidden') return 'No podés proponer cambios en este viaje.';
    if (e.code === 'not_found') return 'No encontré el día.';
    if (e.code === 'unauthenticated') return 'Tu sesión venció. Volvé a entrar.';
  }
  return 'No pude armar la tarde. Probá de nuevo.';
}

export function usePlanDay() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (v: PlanDayVars): Promise<PlanDayOutput> => {
      const res = await callNowTool<'plan_day', PlanDayOutput>('plan_day', {
        trip_id: v.tripId,
        day_id: v.dayId,
        from_time: v.fromTime.slice(0, 5),
        ...(v.toTime ? { to_time: v.toTime.slice(0, 5) } : {}),
        ...(v.here ? { lat: v.here.lat, lng: v.here.lng } : {}),
        ...(v.reason ? { reason: v.reason } : {}),
      });
      if (!res.ok) throw new ToolCallError(res.error.code, res.error.message, res.error.issues);
      return res.data;
    },
    onSuccess: (_res, v) => qc.invalidateQueries({ queryKey: planKeys.proposals(v.tripId) }),
  });
  return { ...m, errorText: m.error ? planDayErrorText(m.error) : null };
}
