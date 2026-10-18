// Menú colaborativo por tramo (PRD 31): lecturas directas a Supabase (RLS: miembros del viaje) y escrituras por la API.
//   options   → ['trip', id, 'leg_options', 'menu']
//   reactions → ['trip', id, 'leg_option_reactions', 'menu']
// useTripRealtime invalida ambas por tabla (REALTIME_TABLES). Nunca polling.
import type {
  ChooseOptionResult,
  ComposeDaysStart,
  LegOptionReactionRow,
  LegOptionRow,
  OptionReaction,
  ReactOptionResult,
} from '@build101/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { callToolOrThrow } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { toolErrorMessage } from '../plan/mutations';
import { planKeys } from '../plan/queries';
import type { PlanBlock } from '../plan/selectors';
import { showToast } from '../plan/store';
import { tripKeys } from '../trips/keys';
import { applyReaction } from './model';

export const menuKeys = {
  options: (tripId: string) => [...tripKeys.table(tripId, 'leg_options'), 'menu'] as const,
  reactions: (tripId: string) => [...tripKeys.table(tripId, 'leg_option_reactions'), 'menu'] as const,
};

export function useLegOptions(tripId: string) {
  return useQuery({
    queryKey: menuKeys.options(tripId),
    queryFn: async (): Promise<LegOptionRow[]> => {
      const { data, error } = await supabase
        .from('leg_options')
        .select('*')
        .eq('trip_id', tripId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as LegOptionRow[];
    },
  });
}

export function useLegOptionReactions(tripId: string) {
  return useQuery({
    queryKey: menuKeys.reactions(tripId),
    queryFn: async (): Promise<LegOptionReactionRow[]> => {
      const { data, error } = await supabase.from('leg_option_reactions').select('*').eq('trip_id', tripId);
      if (error) throw error;
      return (data ?? []) as LegOptionReactionRow[];
    },
  });
}

function haptic(kind: 'ok' | 'error' | 'tap') {
  if (kind === 'tap') return void Haptics.selectionAsync().catch(() => {});
  void Haptics.notificationAsync(
    kind === 'ok' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

// ───────────────────────── react_option (optimista, revierte con toast)

export type ReactVars = { optionId: string; reaction: OptionReaction | null };

export function useReactOption(tripId: string, me: string) {
  const qc = useQueryClient();
  const key = menuKeys.reactions(tripId);
  return useMutation({
    mutationFn: async ({ optionId, reaction }: ReactVars) =>
      (await callToolOrThrow<'react_option', ReactOptionResult>('react_option', { option_id: optionId, reaction })).data,
    onMutate: async ({ optionId, reaction }) => {
      haptic('tap');
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LegOptionReactionRow[]>(key);
      qc.setQueryData<LegOptionReactionRow[]>(key, (old) =>
        applyReaction(old ?? [], optionId, me, reaction, { trip_id: tripId, created_at: new Date().toISOString() }),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      haptic('error');
      showToast({ text: toolErrorMessage(e, 'No se pudo guardar tu reacción. Probá de nuevo.'), tone: 'error' });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// ───────────────────────── compose_days (job en segundo plano)

export function useComposeDays(tripId: string) {
  return useMutation({
    mutationFn: async (legIds?: string[]) =>
      (await callToolOrThrow<'compose_days', ComposeDaysStart>('compose_days', { trip_id: tripId, ...(legIds?.length ? { leg_ids: legIds } : {}) }))
        .data,
    onError: (e) => {
      haptic('error');
      showToast({ text: toolErrorMessage(e, 'No pude arrancar a armar los días. Probá de nuevo.'), tone: 'error' });
    },
  });
}

// ───────────────────────── choose_option (elegí 1 de N)

export function useChooseOption(tripId: string) {
  const qc = useQueryClient();
  const key = planKeys.blocks(tripId);
  return useMutation({
    mutationFn: async ({ blockId }: { blockId: string; title: string }) =>
      callToolOrThrow<'choose_option', ChooseOptionResult>('choose_option', { block_id: blockId }),
    onMutate: async ({ blockId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PlanBlock[]>(key);
      const chosen = prev?.find((b) => b.id === blockId);
      // Optimista: las otras opciones del lugar pasan al banco de ideas.
      if (chosen?.choice_group) {
        qc.setQueryData<PlanBlock[]>(key, (old) =>
          (old ?? []).map((b) =>
            b.id !== blockId && b.choice_group === chosen.choice_group && b.day_id === chosen.day_id
              ? { ...b, day_id: null, status: 'idea', start_time: null, end_time: null }
              : b,
          ),
        );
      }
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      haptic('error');
      showToast({ text: toolErrorMessage(e, 'No se pudo elegir. Probá de nuevo.'), tone: 'error' });
    },
    onSuccess: (res, vars) => {
      haptic('ok');
      showToast({ text: `Elegiste ${vars.title}`, tone: 'success', undoToken: res.undo_token, tripId });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
