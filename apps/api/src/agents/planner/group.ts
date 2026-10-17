// Perfil del grupo para el planificador colaborativo (PRD 31). Puro y testeable sin red.
// Junta lo que cada miembro tiene en su perfil (profiles) + lo que dijo para este viaje (trip_members.trip_prefs,
// jsonb libre) + lo que entendió la entrevista (TripUnderstanding). Mismo criterio que groupProfile de
// tourContext.ts: el ritmo más lento manda, el presupuesto más bajo manda, la conversación pisa a los perfiles.
import { combineInterestWeights, INTEREST_TAGS, type TripUnderstanding } from '@build101/shared';
import type { PlannerGroup, PlannerMember } from './types';

/** Lo que la orquestación lee de profiles + trip_members para cada miembro del tramo. */
export type GroupMemberInput = {
  user_id: string;
  display_name: string | null;
  interests: Record<string, number> | null;
  avoid: string[] | null;
  dietary: string[] | null;
  pace: PlannerMember['pace'] | string | null;
  chronotype: PlannerMember['chronotype'] | string | null;
  budget_level: PlannerMember['budget'] | string | null;
  /** profiles.mobility: {step_free, max_walk_km, notes} (o null). */
  mobility: unknown;
  /** trip_members.trip_prefs: {goal, budget_per_person, must:[], avoid:[], interests:{}, companions} (jsonb libre). */
  trip_prefs: unknown;
};

const PACE_RANK = { relaxed: 0, balanced: 1, intense: 2 } as const;
const BUDGET_RANK = { low: 0, mid: 1, high: 2, no_limit: 3 } as const;
const CHRONOTYPES = ['early', 'normal', 'night'] as const;
const KIDS_RE = /\b(niñ[oa]s?|hij[oa]s?|chic[oa]s|nen[ea]s?|beb[eé]s?|kids?|children)\b/i;

// ───────────────────────── Lectura defensiva del jsonb

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function strList(v: unknown): string[] {
  if (typeof v === 'string') return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}

/** {"arte": 5} o ["arte", "historia"] (lista sin pesos → 4). Solo tags conocidos, pesos 1-5. */
function weightMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const known = INTEREST_TAGS as readonly string[];
  if (Array.isArray(v)) {
    for (const t of strList(v)) if (known.includes(t)) out[t] = 4;
    return out;
  }
  if (!isObj(v)) return out;
  for (const [k, w] of Object.entries(v)) {
    const n = Number(w);
    if (known.includes(k) && Number.isFinite(n) && n > 0) out[k] = Math.min(5, Math.max(1, Math.round(n)));
  }
  return out;
}

const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (values.includes(v as T) ? (v as T) : null);
const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];

function memberOf(m: GroupMemberInput): PlannerMember & { kids: boolean } {
  const prefs = isObj(m.trip_prefs) ? m.trip_prefs : {};
  const mob = isObj(m.mobility) ? m.mobility : {};
  const walk = Number(mob.max_walk_km);
  const companions = typeof prefs.companions === 'string' ? prefs.companions : '';
  return {
    user_id: m.user_id,
    name: (m.display_name ?? '').trim().split(/\s+/)[0] || 'Alguien',
    // Lo del viaje pisa al perfil (si para este viaje dijo "arte 5", vale 5 aunque el perfil diga 3).
    interests: { ...weightMap(m.interests), ...weightMap(prefs.interests) },
    avoid: uniq([...strList(m.avoid), ...strList(prefs.avoid)]),
    must: uniq(strList(prefs.must)),
    dietary: uniq(strList(m.dietary)),
    pace: oneOf(m.pace, ['relaxed', 'balanced', 'intense'] as const),
    chronotype: oneOf(m.chronotype, CHRONOTYPES),
    budget: oneOf(m.budget_level, ['low', 'mid', 'high', 'no_limit'] as const),
    step_free: mob.step_free === true,
    max_walk_km: Number.isFinite(walk) && walk > 0 ? walk : null,
    kids: KIDS_RE.test(companions),
  };
}

// ───────────────────────── Grupo

export function buildPlannerGroup(args: { members: GroupMemberInput[]; understanding?: TripUnderstanding | null }): PlannerGroup {
  const u = args.understanding ?? null;
  const parsed = args.members.map(memberOf);
  const members: PlannerMember[] = parsed.map(({ kids: _kids, ...m }) => m);

  const weights = combineInterestWeights(members.map((m) => m.interests));
  // La conversación habla por el grupo: un interés que salió ahí vale al menos lo que se dijo.
  for (const [k, w] of Object.entries(weightMap(u?.interests ?? null))) weights[k] = Math.max(weights[k] ?? 0, w);

  const paces = members.map((m) => m.pace).filter((p): p is NonNullable<PlannerMember['pace']> => !!p);
  const slowest = paces.length ? paces.reduce((a, b) => (PACE_RANK[a] <= PACE_RANK[b] ? a : b)) : 'balanced';
  const pace = u?.pace ?? slowest;

  const budgets = members.map((m) => m.budget).filter((b): b is NonNullable<PlannerMember['budget']> => !!b);
  const lowest = budgets.length ? budgets.reduce((a, b) => (BUDGET_RANK[a] <= BUDGET_RANK[b] ? a : b)) : null;

  // Cronotipo: el que más se repite; si hay empate o nadie dijo nada, "normal".
  const counts = CHRONOTYPES.map((c) => members.filter((m) => m.chronotype === c).length);
  const top = Math.max(...counts);
  const chronotype = top > 0 && counts.filter((n) => n === top).length === 1 ? CHRONOTYPES[counts.indexOf(top)] : 'normal';

  return {
    members,
    weights,
    avoid: uniq([...members.flatMap((m) => m.avoid), ...strList(u?.avoid)]),
    must: uniq([...members.flatMap((m) => m.must), ...strList(u?.must)]),
    dietary: uniq(members.flatMap((m) => m.dietary)),
    pace,
    chronotype,
    budget: u?.budget ?? lowest,
    hasKids:
      (u?.kids_ages?.length ?? 0) > 0 ||
      (u?.party === 'family' && KIDS_RE.test([...(u.notes ?? []), ...(u.names ?? [])].join(' '))) ||
      parsed.some((m) => m.kids),
    firstTime: u?.first_time !== false,
    stepFree: members.some((m) => m.step_free),
  };
}
