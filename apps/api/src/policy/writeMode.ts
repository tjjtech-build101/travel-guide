// Regla de escritura (PRD 00, "Regla de escritura"). ÚNICO lugar donde se decide apply / propose / forbidden.
// decideWriteMode es PURA (sin I/O, testeable); loadPolicyFacts hace las lecturas necesarias.
import type { Actor, TripRole } from '@build101/shared';
import type { Db } from '../supabase';
import { dbError } from '../errors';

export type WriteMode = 'apply' | 'propose' | 'forbidden';

/** Estado de un bloque (participantes y privacidad) antes o después del cambio. */
export type BlockShape = {
  participant_ids: string[];
  is_private: boolean;
  created_by?: string | null;
};

export type PolicyFacts = {
  actorId: string;
  actor: Actor;
  /** Rol del actor en el viaje; null = no es miembro. */
  role: TripRole | null;
  /** El actor es leg_member del tramo del bloque (o del tramo destino en add_block). */
  isLegMember: boolean;
  /** Bloque antes del cambio (undefined en add_block). */
  before?: BlockShape;
  /** Bloque resultante (en remove_block = before). */
  after: BlockShape;
  /**
   * Excepción de plan_trip: el agente escribe dentro de un job de plan sobre un tramo que tenía 0 bloques
   * al empezar el job (el pedido explícito del organizer es la aprobación). Solo add_block lo usa.
   */
  planEmptyLeg?: boolean;
};

export type WriteDecision = {
  mode: WriteMode;
  /** true si el bloque (antes y después) es personal del actor. */
  personal: boolean;
  reason: string;
};

const uniq = (ids: string[]) => [...new Set(ids)];

/** Personal del actor: los participantes son exactamente [actor] (o es privado sin participantes y lo creó el actor). */
export function isPersonalOf(shape: BlockShape, userId: string): boolean {
  const ids = uniq(shape.participant_ids);
  if (ids.length === 1 && ids[0] === userId) return true;
  return shape.is_private && ids.length === 0 && shape.created_by === userId;
}

/** Personal de otra persona: un único participante que no es el actor, o privado donde el actor no participa. */
export function isPersonalOfOther(shape: BlockShape, userId: string): boolean {
  const ids = uniq(shape.participant_ids);
  if (ids.length === 1 && ids[0] !== userId) return true;
  if (shape.is_private && !ids.includes(userId) && shape.created_by !== userId) return true;
  return false;
}

export function decideWriteMode(f: PolicyFacts): WriteDecision {
  // 1. Seguidor / no miembro → 403.
  if (f.role === null) return { mode: 'forbidden', personal: false, reason: 'No sos miembro de este viaje.' };
  if (f.role === 'follower') return { mode: 'forbidden', personal: false, reason: 'Los seguidores no pueden editar el plan.' };

  // 2. Permiso base: organizer, o viajero que es leg_member del tramo.
  if (f.role !== 'organizer' && !f.isLegMember) {
    return { mode: 'forbidden', personal: false, reason: 'No estás en este tramo del viaje.' };
  }

  // Un bloque privado ajeno solo se ve como "Ocupado": nadie (ni el organizer ni el agente) lo edita.
  if (f.before && f.before.is_private && !f.before.participant_ids.includes(f.actorId) && f.before.created_by !== f.actorId) {
    return { mode: 'forbidden', personal: false, reason: 'Es un bloque privado de otra persona.' };
  }

  // 3. Personal = participantes resultantes == [actor] (y, si ya existía, también antes).
  const shapes = f.before ? [f.before, f.after] : [f.after];
  const personal = shapes.every((s) => isPersonalOf(s, f.actorId));
  const otherPersonal = shapes.some((s) => isPersonalOfOther(s, f.actorId));

  // 4. Humanos editan directo.
  if (f.actor === 'user') return { mode: 'apply', personal, reason: 'Edición de una persona.' };

  // Excepción de plan_trip (Contratos v1.1): tramo vacío dentro del job → aplica directo.
  if (f.planEmptyLeg) return { mode: 'apply', personal, reason: 'Plan del viaje: tramo vacío, aplica directo.' };

  // 5. Agente + personal del actor → aplica. Agente sobre personal de otro → 403.
  if (personal) return { mode: 'apply', personal, reason: 'Bloque personal: el agente aplica.' };
  if (otherPersonal) {
    return { mode: 'forbidden', personal: false, reason: 'El asistente no puede tocar el plan personal de otra persona.' };
  }

  // 6. Agente + compartido → propuesta.
  return { mode: 'propose', personal: false, reason: 'Bloque compartido: el asistente lo deja como propuesta.' };
}

// ---------- I/O: cargar los hechos para la policy ----------

export async function loadMembership(
  admin: Db,
  tripId: string,
  legId: string,
  userId: string,
): Promise<{ role: TripRole | null; isLegMember: boolean }> {
  const [{ data: member, error: e1 }, { data: legMember, error: e2 }] = await Promise.all([
    admin.from('trip_members').select('role').eq('trip_id', tripId).eq('user_id', userId).maybeSingle(),
    admin.from('leg_members').select('user_id').eq('leg_id', legId).eq('user_id', userId).maybeSingle(),
  ]);
  if (e1) throw dbError(e1, 'trip_members');
  if (e2) throw dbError(e2, 'leg_members');
  return { role: (member?.role as TripRole | undefined) ?? null, isLegMember: !!legMember };
}

export async function loadTripRole(admin: Db, tripId: string, userId: string): Promise<TripRole | null> {
  const { data, error } = await admin
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw dbError(error, 'trip_members');
  return (data?.role as TripRole | undefined) ?? null;
}
