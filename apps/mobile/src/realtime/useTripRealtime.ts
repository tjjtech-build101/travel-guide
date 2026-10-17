// 1 canal `trip:<id>` con postgres_changes por cada tabla de REALTIME_TABLES.
// Cada evento → invalidateQueries(['trip', id, table]). Nunca polling.
import { REALTIME_TABLES, type RealtimeTable } from '@build101/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../lib/supabase';
import { tripKeys } from '../features/trips/keys';
import { useConnectionStore } from './connectionStore';

/** Tablas sin trip_id: se escuchan sin filtro y RLS recorta. */
const UNFILTERED: readonly RealtimeTable[] = ['block_participants'];

/** Invalidaciones derivadas: days / trip_members / leg_members no se publican (Contratos). */
function invalidateFor(qc: QueryClient, tripId: string, table: RealtimeTable, payload: { new?: unknown }) {
  void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, table) });
  switch (table) {
    case 'block_participants':
      void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'blocks') });
      break;
    case 'legs':
      void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'days') });
      void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'trips') });
      break;
    case 'activity_feed': {
      const kind = (payload.new as { kind?: string } | undefined)?.kind ?? '';
      // Cambios en privados ajenos no llegan por Realtime: el feed avisa con busy_changed.
      if (kind === 'busy_changed' || kind.startsWith('block_') || kind === 'undo' || kind === 'trip_planned') {
        void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'blocks') });
      }
      if (kind.startsWith('member_') || kind === 'trip_planned') {
        void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'trip_members') });
        void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'days') });
        void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'legs') });
      }
      break;
    }
    case 'agent_jobs':
      void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'days') });
      break;
    default:
      break;
  }
}

export function useTripRealtime(tripId: string | undefined) {
  const qc = useQueryClient();
  const setRealtime = useConnectionStore((s) => s.setRealtime);
  // Se incrementa al volver de background para forzar la resuscripción.
  const [generation, setGeneration] = useState(0);
  const wasBackground = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && wasBackground.current) {
        wasBackground.current = false;
        setGeneration((g) => g + 1);
      } else if (state === 'background') {
        wasBackground.current = true;
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!tripId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    setRealtime('connecting');

    (async () => {
      // El socket tiene que tener el JWT actual antes de suscribirse (RLS en postgres_changes).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      // Nombre único por suscripción: removeChannel es asíncrono y supabase.channel() devuelve el canal viejo si el
      // topic coincide (ya suscripto → "cannot add postgres_changes callbacks after subscribe()" al volver de background).
      channel = supabase.channel(`trip:${tripId}:${Math.random().toString(36).slice(2, 8)}`);
      for (const table of REALTIME_TABLES) {
        channel.on(
          'postgres_changes',
          UNFILTERED.includes(table)
            ? { event: '*', schema: 'public', table }
            : { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` },
          (payload) => invalidateFor(qc, tripId, table, payload as { new?: unknown }),
        );
      }
      channel.subscribe((status, err) => {
        if (cancelled) return;
        switch (status) {
          case 'SUBSCRIBED':
            setRealtime('connected');
            // Lo que cambió mientras estábamos desconectados: refrescar todo el viaje una vez.
            if (generation > 0) void qc.invalidateQueries({ queryKey: tripKeys.all(tripId) });
            break;
          case 'CHANNEL_ERROR':
          case 'TIMED_OUT':
            setRealtime('error', err?.message ?? status);
            break;
          case 'CLOSED':
            setRealtime('closed');
            break;
        }
      });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
      setRealtime('idle');
    };
    // generation: resuscribir al volver de background.
  }, [tripId, generation, qc, setRealtime]);
}
