// Escrituras del Plan: siempre por la API de herramientas (actor 'user'). Optimistas con rollback.
import type { BlockFieldsInput, ToolInput } from '@build101/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';

import { callToolOrThrow, ToolCallError } from '../../lib/api';
import { describeError, errorLine, type ErrorView } from '../../lib/errors';
import { planKeys } from './queries';
import type { PlanBlock } from './selectors';
import { showErrorToast, showToast } from './store';

type ApplyResult = { mode: 'applied' | 'proposed'; block?: PlanBlock; proposal_id?: string };

// PRD 11 (decide_proposal) y conflictos: el servidor manda un texto en español para mostrar tal cual.
const SERVER_TEXT_CODES = new Set([
  'forbidden',
  'invalid_input',
  'not_found',
  'already_undone',
  'proposal_decided',
  'apply_failed',
  'booked',
  'trip_not_empty',
  'job_running',
]);

const serverText = (e: unknown): string | null =>
  e instanceof ToolCallError && SERVER_TEXT_CODES.has(e.code) && e.message.trim() ? e.message : null;

/** Error descripto (lib/errors), pero con el texto del servidor tal cual en los conflictos legibles. */
export function toolErrorView(e: unknown, doing: string): ErrorView {
  const v = describeError(e, { doing });
  const text = serverText(e);
  return text ? { ...v, title: `No pude ${doing}`, body: text, hint: undefined } : v;
}

/**
 * Mensaje legible de un error de herramienta (una línea, para formularios).
 * Conflictos con texto propio del servidor → ese texto; el resto → la causa real (lib/errors).
 * `doing` en infinitivo: "guardar el bloque", "mover el bloque".
 */
export function toolErrorMessage(e: unknown, doing = 'guardar'): string {
  return serverText(e) ?? errorLine(e, { doing });
}

/** Toast de error: conflictos legibles con el texto del servidor; el resto con la causa real. */
export function showToolErrorToast(e: unknown, doing: string) {
  const text = serverText(e);
  if (text) return showToast({ tone: 'error', title: `No pude ${doing}`, text }, 6000);
  showErrorToast(e, doing);
}

function snapshot(qc: QueryClient, tripId: string) {
  return qc.getQueryData<PlanBlock[]>(planKeys.blocks(tripId));
}

function patchCache(qc: QueryClient, tripId: string, fn: (blocks: PlanBlock[]) => PlanBlock[]) {
  qc.setQueryData<PlanBlock[]>(planKeys.blocks(tripId), (old) => (old ? fn(old) : old));
}

function normTime(t: string | undefined): string | undefined {
  return t && t.length === 5 ? `${t}:00` : t;
}

function haptic(kind: 'ok' | 'error') {
  void Haptics.notificationAsync(
    kind === 'ok' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

function proposedToast(res: ApplyResult) {
  if (res.mode === 'proposed') showToast({ text: 'Quedó como propuesta para el grupo', tone: 'info' });
}

// ───────────────────────── update_block

export type UpdateVars = {
  blockId: string;
  patch: Partial<BlockFieldsInput>;
  reason?: string;
  /** El que llama muestra el error (p. ej. el formulario del bloque): no tostear para no duplicar. */
  silentError?: boolean;
};

export function useUpdateBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockId, patch, reason }: UpdateVars) =>
      (await callToolOrThrow<'update_block', ApplyResult>('update_block', { block_id: blockId, patch, reason })).data,
    onMutate: async ({ blockId, patch }) => {
      await qc.cancelQueries({ queryKey: planKeys.blocks(tripId) });
      const prev = snapshot(qc, tripId);
      const { participant_ids, start_time, end_time, ...rest } = patch;
      patchCache(qc, tripId, (blocks) =>
        blocks.map((b) =>
          b.id === blockId
            ? {
                ...b,
                ...(rest as Partial<PlanBlock>),
                ...(start_time !== undefined ? { start_time: normTime(start_time) ?? null } : {}),
                ...(end_time !== undefined ? { end_time: normTime(end_time) ?? null } : {}),
                ...(participant_ids ? { participant_ids } : {}),
              }
            : b,
        ),
      );
      return { prev };
    },
    onError: (e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(planKeys.blocks(tripId), ctx.prev);
      haptic('error');
      if (!vars.silentError) showToolErrorToast(e, 'guardar el cambio');
    },
    onSuccess: (res) => {
      haptic('ok');
      proposedToast(res);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) }),
  });
}

// ───────────────────────── move_block

export type MoveVars = { blockId: string; dayId: string | null; startTime?: string; title?: string; toLabel?: string };

export function useMoveBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockId, dayId, startTime }: MoveVars) =>
      callToolOrThrow<'move_block', ApplyResult>('move_block', {
        block_id: blockId,
        day_id: dayId,
        recompute_times: true,
        ...(startTime ? { start_time: startTime } : {}),
      }),
    onMutate: async ({ blockId, dayId, startTime }) => {
      await qc.cancelQueries({ queryKey: planKeys.blocks(tripId) });
      const prev = snapshot(qc, tripId);
      patchCache(qc, tripId, (blocks) =>
        blocks.map((b) =>
          b.id === blockId
            ? {
                ...b,
                day_id: dayId,
                sort_order: 9999,
                ...(startTime ? { start_time: normTime(startTime) ?? null, end_time: null } : {}),
              }
            : b,
        ),
      );
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(planKeys.blocks(tripId), ctx.prev);
      haptic('error');
      showToolErrorToast(e, 'mover el bloque');
    },
    onSuccess: (res, vars) => {
      haptic('ok');
      if (res.data.mode === 'proposed') return proposedToast(res.data);
      showToast({
        text: vars.toLabel ? `Listo · pasó ${vars.toLabel}` : 'Listo',
        tone: 'success',
        undoToken: res.undo_token,
        tripId,
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) }),
  });
}

// ───────────────────────── remove_block

export function useRemoveBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockId }: { blockId: string; title?: string }) =>
      callToolOrThrow<'remove_block', { mode: 'applied' | 'proposed' }>('remove_block', { block_id: blockId }),
    onMutate: async ({ blockId }) => {
      await qc.cancelQueries({ queryKey: planKeys.blocks(tripId) });
      const prev = snapshot(qc, tripId);
      patchCache(qc, tripId, (blocks) => blocks.filter((b) => b.id !== blockId));
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(planKeys.blocks(tripId), ctx.prev);
      haptic('error');
      showToolErrorToast(e, 'borrar el bloque');
    },
    onSuccess: (res) => {
      haptic('ok');
      if (res.data.mode === 'proposed') return showToast({ text: 'Quedó como propuesta para el grupo', tone: 'info' });
      showToast({ text: 'Listo · lo borraste', tone: 'success', undoToken: res.undo_token, tripId });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) }),
  });
}

// ───────────────────────── add_block / add_idea

export type AddVars =
  | { kind: 'block'; input: ToolInput<'add_block'> }
  | { kind: 'idea'; input: ToolInput<'add_idea'> };

export function useAddBlock(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: AddVars) =>
      vars.kind === 'idea'
        ? callToolOrThrow<'add_idea', ApplyResult>('add_idea', vars.input)
        : callToolOrThrow<'add_block', ApplyResult>('add_block', vars.input),
    onSuccess: (res, vars) => {
      haptic('ok');
      const block = res.data.block;
      if (block) {
        // Lo sumamos al caché ya (Realtime lo confirma después).
        patchCache(qc, tripId, (blocks) =>
          blocks.some((b) => b.id === block.id) ? blocks : [...blocks, { ...block, masked: false }],
        );
      }
      if (res.data.mode === 'proposed') return proposedToast(res.data);
      showToast({
        text: vars.kind === 'idea' ? 'Listo · idea anotada' : 'Listo · bloque agregado',
        tone: 'success',
        undoToken: res.undo_token,
        tripId,
      });
    },
    onError: () => haptic('error'),
    onSettled: () => qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) }),
  });
}

// ───────────────────────── undo

export async function undoAction(qc: QueryClient, tripId: string, undoToken: string) {
  try {
    await callToolOrThrow('undo', { undo_token: undoToken });
    haptic('ok');
    showToast({ text: 'Deshecho', tone: 'info' }, 2500);
  } catch (e) {
    haptic('error');
    showToolErrorToast(e, 'deshacer');
  } finally {
    void qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) });
    void qc.invalidateQueries({ queryKey: planKeys.proposals(tripId) });
  }
}
