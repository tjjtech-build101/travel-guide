// Traslados dentro del día (plan_transfers): "Calcular traslados" desde el menú del viaje o de un día.
import type { QueryClient } from '@tanstack/react-query';

import { callTool } from '../../lib/api';
import { planKeys } from './queries';
import { showToast } from './store';

type Result = { days: number; added: number; estimated: number };

export async function calculateTransfers(qc: QueryClient, tripId: string, dayId?: string) {
  showToast({ text: 'Calculando cómo moverte entre lugares…', tone: 'info' }, 4000);
  const res = await callTool<'plan_transfers', Result>('plan_transfers', { trip_id: tripId, ...(dayId ? { day_id: dayId } : {}) });
  if (!res.ok) {
    showToast({ text: `No pude calcular los traslados: ${res.error.message}`, tone: 'error' });
    return;
  }
  const { added, estimated } = res.data;
  showToast(
    {
      text: added
        ? `Agregué ${added} ${added === 1 ? 'traslado' : 'traslados'}${estimated ? ` (${estimated} estimados, sin datos de transporte)` : ''}`
        : 'Todo queda cerca: no hizo falta agregar traslados',
      tone: 'info',
    },
    4000,
  );
  void qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) });
}
