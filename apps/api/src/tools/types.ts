import type { Actor, ToolInput, ToolName } from '@build101/shared';
import type { Db } from '../supabase';

/** Contexto de una ejecución de herramienta (HTTP o agente Claude interno). */
export type ToolCtx = {
  userId: string;
  /** 'user' = lo decidió una persona; 'agent' = lo decidió un agente (voz con x-actor: agent, o Claude interno). */
  actor: Actor;
  /** Cliente con el JWT del usuario (RLS). Lecturas visibles para el usuario. */
  db: Db;
  /** Cliente service role. Escrituras después de la policy y lecturas internas de permisos. */
  admin: Db;
  /**
   * Solo dentro de un job plan_trip (PRD 01, excepción de Contratos v1.1): add_block sobre un tramo que
   * tenía 0 bloques al empezar el job aplica directo (sin propuesta ni fila de feed por bloque); el job
   * deja una sola fila trip_planned con el undo_token de todo el plan. Nunca viene de HTTP.
   */
  plan?: PlanScope;
};

export type PlanScope = {
  jobId: string;
  /** Tramos sin bloques al empezar el job. */
  emptyLegIds: ReadonlySet<string>;
  /** Tramos donde este runner puede escribir (uno por runner). */
  allowedLegIds: ReadonlySet<string>;
  /** Avisa al job de cada bloque aplicado (progreso + ids para el undo). */
  onBlockAdded: (block: { id: string; leg_id: string; day_id: string | null; title: string; type: string }) => void;
};

export type ToolOk<T = unknown> = { ok: true; data: T; undo_token?: string; feed_id?: string };

/** Un handler recibe el input ya validado por Zod y devuelve { ok:true, ... } o tira ToolFailure. */
export type Handler<N extends ToolName> = (input: ToolInput<N>, ctx: ToolCtx) => Promise<ToolOk>;
