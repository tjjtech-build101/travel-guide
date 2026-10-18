// Brief del tour (tour director): TODO el contexto del grupo y del momento en un solo objeto, que leen la
// entrevista (tour_brief), el optimizador de ruta, el director, los escritores y el crítico.
// - Personas: perfiles completos (intereses, avoid, dieta, ritmo, movilidad, estilo de guía, rasgos confirmados),
//   trip_prefs del viaje y memorias.
// - Historial: content_told (qué ya escucharon), tours anteriores del viaje, bloques del itinerario (qué ya
//   vieron y qué van a ver), lugares guardados.
// - Momento y lugar: hora local, clima en la ventana del tour, puesta del sol, barrio y ciudad.
// - Respuestas de la entrevista (campos opcionales de generate_tour).
import { combineInterestWeights, SCOUT, type InferredTrait, type InterestTag, type ToolInput } from '@build101/shared';
import type { ReverseGeo } from '../google/osm';
import type { TourWeather } from '../google/openMeteo';
import type { Db } from '../supabase';

export type Member = {
  id: string;
  name: string | null;
  interests: Record<string, number> | null;
  avoid: string[];
  dietary: string[];
  pace: 'relaxed' | 'balanced' | 'intense' | null;
  budget_level: 'low' | 'mid' | 'high' | 'no_limit' | null;
  step_free: boolean;
  max_walk_km: number | null;
  mobility_notes: string | null;
  languages: string[];
  guide_style: string | null;
  traits: string[];
  trip_goal: string | null;
  trip_must: string[];
  trip_avoid: string[];
  companions: string | null;
};

export type ItineraryItem = { title: string; place_name: string | null; lat: number | null; lng: number | null; when: 'past' | 'today' | 'future'; date: string | null };

export type TourAnswers = Pick<
  ToolInput<'generate_tour'>,
  'themes' | 'energy' | 'familiarity' | 'food_stop' | 'include_paid_entries' | 'kids' | 'indoor' | 'finish' | 'must_include' | 'notes'
>;

export type TourBrief = {
  members: Member[];
  memories: string[];
  /** place_library.id → capas que ya escuchó al menos un participante. */
  told: Map<string, Set<string>>;
  /** place_library.id de paradas de otros tours de este viaje. */
  previousTourPlaceIds: Set<string>;
  itinerary: ItineraryItem[];
  saved: { name: string; lat: number | null; lng: number | null; note: string | null }[];
  start: Date;
  durationMin: number;
  /** Hora local de inicio: día (0=domingo) y minutos desde medianoche. */
  local: { day: number; minutes: number; text: string; date: string };
  weather: TourWeather | null;
  place: ReverseGeo | null;
  answers: TourAnswers;
};

/** Perfil combinado del grupo: lo que manda en las decisiones duras. */
export type GroupProfile = {
  weights: Record<string, number>;
  avoid: string[];
  stepFree: boolean;
  /** Menor max_walk_km declarado (km), o null. */
  maxWalkKm: number | null;
  /** El ritmo del más lento manda; energy de la entrevista lo pisa. */
  pace: 'relaxed' | 'balanced' | 'intense';
  dietary: string[];
  budget: 'low' | 'mid' | 'high' | 'no_limit' | null;
  hasKids: boolean;
  guideStyle: string | null;
  firstTime: boolean;
  indoor: 'outdoor' | 'mixed' | 'indoor';
  paidEntries: boolean;
  themes: string[];
};

// ───────────────────────── Puro

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function localClock(start: Date, utcOffsetS: number): TourBrief['local'] {
  const local = new Date(start.getTime() + utcOffsetS * 1000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return { day: local.getUTCDay(), minutes, text: `${WEEKDAYS[local.getUTCDay()]} ${hh}:${mm}`, date: local.toISOString().slice(0, 10) };
}

const PACE_RANK = { relaxed: 0, balanced: 1, intense: 2 } as const;
const KIDS_RE = /\b(niñ[oa]s?|hij[oa]s?|chic[oa]s|nen[ea]s?|beb[eé]s?|kids?|children|familia)\b/i;

export function groupProfile(brief: Pick<TourBrief, 'members' | 'answers' | 'told' | 'previousTourPlaceIds' | 'weather'>): GroupProfile {
  const { members, answers } = brief;
  const weights = combineInterestWeights(members.map((m) => m.interests));
  // Los temas de la entrevista mandan: suben a 5 (y "curiosidades"/"para_chicos" los usa el score aparte).
  for (const t of answers.themes ?? []) if (t !== 'curiosidades' && t !== 'para_chicos') weights[t] = 5;
  const avoid = [...new Set(members.flatMap((m) => [...m.avoid, ...m.trip_avoid]).map((a) => a.trim()).filter(Boolean))];
  const paces = members.map((m) => m.pace).filter((p): p is NonNullable<Member['pace']> => !!p);
  let pace: GroupProfile['pace'] = paces.length ? paces.reduce((a, b) => (PACE_RANK[a] <= PACE_RANK[b] ? a : b)) : 'balanced';
  if (answers.energy === 'tranqui') pace = 'relaxed';
  else if (answers.energy === 'normal') pace = 'balanced';
  else if (answers.energy === 'a_full') pace = 'intense';
  const walks = members.map((m) => m.max_walk_km).filter((x): x is number => typeof x === 'number' && x > 0);
  const budgets = members.map((m) => m.budget_level).filter((b): b is NonNullable<Member['budget_level']> => !!b);
  const BUDGET_RANK = { low: 0, mid: 1, high: 2, no_limit: 3 } as const;
  const budget = budgets.length ? budgets.reduce((a, b) => (BUDGET_RANK[a] <= BUDGET_RANK[b] ? a : b)) : null;
  const hasKids =
    (answers.kids?.length ?? 0) > 0 ||
    (answers.themes ?? []).includes('para_chicos') ||
    (answers.kids === undefined && members.some((m) => m.guide_style === 'kids' || KIDS_RE.test(m.companions ?? '')));
  const styles = members.map((m) => m.guide_style).filter(Boolean) as string[];
  const rainy = (brief.weather?.max_precip_prob ?? 0) >= 60;
  return {
    weights,
    avoid,
    stepFree: members.some((m) => m.step_free),
    maxWalkKm: walks.length ? Math.min(...walks) : null,
    pace,
    dietary: [...new Set(members.flatMap((m) => m.dietary))],
    budget,
    hasKids,
    guideStyle: hasKids ? 'kids' : (styles[0] ?? null),
    firstTime: answers.familiarity ? answers.familiarity === 'first_time' : brief.told.size === 0 && brief.previousTourPlaceIds.size === 0,
    indoor: answers.indoor ?? (rainy ? 'indoor' : 'mixed'),
    paidEntries: answers.include_paid_entries ?? (budget === 'high' || budget === 'no_limit'),
    themes: answers.themes ?? [],
  };
}

const KIDS_LABEL: Record<string, string> = { menores_5: 'menores de 5', '5_a_9': 'de 5 a 9', '10_a_13': 'de 10 a 13', adolescentes: 'adolescentes' };
const ENERGY_LABEL = { relaxed: 'tranqui (pocas paradas, pausas)', balanced: 'normal', intense: 'a full (muchas paradas, poco descanso)' };

function topInterests(interests: Record<string, number> | null, n = 3): string[] {
  return Object.entries(interests ?? {})
    .filter(([, w]) => w >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, w]) => `${k.replace('_', ' ')} (${w}/5)`);
}

function weatherLine(w: TourWeather | null): string | null {
  if (!w) return null;
  const parts: string[] = [];
  if (w.temp_c != null) parts.push(`${Math.round(w.temp_c)} °C`);
  if (w.max_precip_prob >= 60) parts.push(`lluvia probable (${w.max_precip_prob}%)`);
  else if (w.max_precip_prob >= 30) parts.push(`puede llover (${w.max_precip_prob}%)`);
  else parts.push('sin lluvia');
  if (w.sunset) parts.push(`puesta del sol ${w.sunset}`);
  return parts.join(', ');
}

/** Ficha del público para los prompts (director, escritores, crítico). Texto compacto, sin ids. */
export function renderBriefCard(brief: TourBrief, group: GroupProfile): string {
  const lines: string[] = [];
  const where = [brief.place?.neighborhood, brief.place?.city, brief.place?.country].filter(Boolean).join(', ');
  lines.push(`Dónde: ${where || 'desconocido'}. Cuándo: ${brief.local.text}, ${brief.durationMin} min.${weatherLine(brief.weather) ? ` Clima: ${weatherLine(brief.weather)}.` : ''}`);
  lines.push(`Grupo (${brief.members.length || 1} ${brief.members.length === 1 ? 'persona' : 'personas'}):`);
  for (const m of brief.members) {
    const bits: string[] = [];
    const ti = topInterests(m.interests);
    if (ti.length) bits.push(`le gusta ${ti.join(', ')}`);
    if (m.avoid.length || m.trip_avoid.length) bits.push(`evita ${[...m.avoid, ...m.trip_avoid].join(', ')}`);
    if (m.dietary.length) bits.push(`dieta ${m.dietary.join(', ')}`);
    if (m.traits.length) bits.push(`rasgos: ${m.traits.slice(0, 3).join('; ')}`);
    if (m.trip_goal) bits.push(`busca en el viaje: ${m.trip_goal}`);
    if (m.trip_must.length) bits.push(`quiere sí o sí: ${m.trip_must.join(', ')}`);
    if (m.mobility_notes) bits.push(`movilidad: ${m.mobility_notes}`);
    lines.push(`- ${m.name ?? 'Viajero'}: ${bits.join('; ') || 'sin preferencias cargadas'}.`);
  }
  const g: string[] = [`ritmo ${ENERGY_LABEL[group.pace]}`];
  if (group.stepFree) g.push('alguien necesita recorrido sin escalones');
  if (group.maxWalkKm) g.push(`caminar como mucho ${group.maxWalkKm} km`);
  if (brief.answers.kids?.length) g.push(`van chicos ${brief.answers.kids.map((k) => KIDS_LABEL[k] ?? k).join(' y ')}`);
  else if (group.hasKids) g.push('van chicos');
  g.push(group.firstTime ? 'primera vez en la zona: lo esencial bien contado' : 'ya conocen la zona: priorizá lo menos conocido');
  if (group.indoor === 'indoor') g.push('prefieren lugares cubiertos');
  g.push(group.paidEntries ? 'pueden entrar a lugares pagos' : 'mejor paradas exteriores o gratuitas');
  if (group.themes.length) g.push(`temas pedidos: ${group.themes.join(', ')}`);
  lines.push(`Para el grupo: ${g.join('; ')}.`);
  if (brief.answers.notes) lines.push(`Pedido textual: "${brief.answers.notes}"`);
  if (brief.answers.must_include?.length) lines.push(`Quieren ver sí o sí: ${brief.answers.must_include.join(', ')}.`);
  const future = brief.itinerary.filter((i) => i.when !== 'past').slice(0, 6);
  if (future.length) lines.push(`Lo que ya tienen en el plan (no lo cuentes entero, a lo sumo un adelanto): ${future.map((i) => i.place_name ?? i.title).join(', ')}.`);
  const past = brief.itinerary.filter((i) => i.when === 'past').slice(-6);
  if (past.length) lines.push(`Ya estuvieron en: ${past.map((i) => i.place_name ?? i.title).join(', ')} (podés hacer referencias).`);
  if (brief.memories.length) lines.push(`Memoria del viaje:\n${brief.memories.slice(0, 8).map((m) => `- ${m}`).join('\n')}`);
  return lines.join('\n');
}

/** Bullets para la hoja "Lo que tengo en cuenta" (y el resumen del tour_brief). */
export function briefContextBullets(brief: TourBrief, group: GroupProfile): string[] {
  const out: string[] = [];
  for (const m of brief.members) {
    const ti = topInterests(m.interests, 2).map((s) => s.replace(/ \(\d\/5\)/, ''));
    const bits = [ti.length ? `le gusta ${ti.join(' y ')}` : null, m.avoid.length ? `evita ${m.avoid.slice(0, 2).join(' y ')}` : null].filter(Boolean);
    if (bits.length) out.push(`${m.name ?? 'Vos'}: ${bits.join(', ')}`);
  }
  if (group.stepFree) out.push('Recorrido sin escalones');
  if (group.dietary.length) out.push(`Dieta: ${group.dietary.join(', ')}`);
  const w = weatherLine(brief.weather);
  if (w) out.push(`Clima: ${w}`);
  if (brief.told.size) out.push(`Ya te conté ${brief.told.size} ${brief.told.size === 1 ? 'lugar' : 'lugares'}: no los repito`);
  const future = brief.itinerary.filter((i) => i.when === 'future').length;
  if (future) out.push(`Tenés ${future} ${future === 1 ? 'plan' : 'planes'} más en el viaje: no los piso`);
  return out;
}

// ───────────────────────── Carga (DB + APIs externas)

type ProfileRow = {
  id: string;
  display_name: string | null;
  interests: Record<string, number> | null;
  avoid: string[] | null;
  dietary: string[] | null;
  pace: Member['pace'];
  budget_level: Member['budget_level'];
  mobility: { step_free?: boolean; max_walk_km?: number | null; notes?: string | null } | null;
  languages: string[] | null;
  guide_style: string | null;
  inferred_traits: InferredTrait[] | null;
};

type TripPrefs = { goal?: string; must?: string[]; avoid?: string[]; companions?: string } | null;

export type LoadBriefArgs = {
  participantIds: string[];
  tripId: string | null;
  excludeTourId?: string;
  start: Date;
  durationMin: number;
  lat: number;
  lng: number;
  answers: TourAnswers;
};

export type BriefDeps = {
  weather: (a: { lat: number; lng: number; start: Date; duration_min: number }) => Promise<TourWeather | null>;
  reverseGeocode: (lat: number, lng: number) => Promise<ReverseGeo | null>;
};

/** Junta todo el contexto. Cada fuente es opcional: si una falla, el brief sale igual sin esa parte. */
export async function loadTourBrief(admin: Db, a: LoadBriefArgs, deps: BriefDeps): Promise<TourBrief> {
  const ids = a.participantIds;
  const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      console.warn('[tourContext]', (err as Error).message);
      return fallback;
    }
  };

  const [profilesRes, prefsRes, memoriesRes, toldRes, savedRes, itineraryRes, prevToursRes, weather, place] = await Promise.all([
    safe(
      ids.length
        ? admin.from('profiles').select('id,display_name,interests,avoid,dietary,pace,budget_level,mobility,languages,guide_style,inferred_traits').in('id', ids)
        : Promise.resolve({ data: [] }),
      { data: [] } as { data: unknown[] | null },
    ),
    safe(
      a.tripId && ids.length ? admin.from('trip_members').select('user_id,trip_prefs').eq('trip_id', a.tripId).in('user_id', ids) : Promise.resolve({ data: [] }),
      { data: [] } as { data: unknown[] | null },
    ),
    safe(
      ids.length
        ? admin
            .from('memories')
            .select('text,scope,trip_id,user_id')
            .is('deleted_at', null)
            .or(`user_id.in.(${ids.join(',')})${a.tripId ? `,trip_id.eq.${a.tripId}` : ''}`)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      { data: [] } as { data: unknown[] | null },
    ),
    safe(ids.length ? admin.from('content_told').select('place_id,layer').in('user_id', ids).limit(2000) : Promise.resolve({ data: [] }), { data: [] } as {
      data: unknown[] | null;
    }),
    safe(ids.length ? admin.from('saved_places').select('name,lat,lng,note').in('user_id', ids).limit(30) : Promise.resolve({ data: [] }), { data: [] } as {
      data: unknown[] | null;
    }),
    safe(
      a.tripId
        ? admin.from('blocks').select('title,place_name,lat,lng,type,days(date)').eq('trip_id', a.tripId).not('day_id', 'is', null).limit(200)
        : Promise.resolve({ data: [] }),
      { data: [] } as { data: unknown[] | null },
    ),
    safe(
      a.tripId ? admin.from('tours').select('id,tour_stops(place_id)').eq('trip_id', a.tripId).in('status', ['ready', 'active', 'done']) : Promise.resolve({ data: [] }),
      { data: [] } as { data: unknown[] | null },
    ),
    deps.weather({ lat: a.lat, lng: a.lng, start: a.start, duration_min: a.durationMin }).catch(() => null),
    deps.reverseGeocode(a.lat, a.lng).catch(() => null),
  ]);

  const prefsBy = new Map(((prefsRes.data ?? []) as { user_id: string; trip_prefs: TripPrefs }[]).map((r) => [r.user_id, r.trip_prefs]));
  const members: Member[] = ((profilesRes.data ?? []) as ProfileRow[]).map((p) => {
    const tp = prefsBy.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.display_name,
      interests: p.interests,
      avoid: p.avoid ?? [],
      dietary: p.dietary ?? [],
      pace: p.pace,
      budget_level: p.budget_level,
      step_free: !!p.mobility?.step_free,
      max_walk_km: p.mobility?.max_walk_km ?? null,
      mobility_notes: p.mobility?.notes ?? null,
      languages: p.languages ?? [],
      guide_style: p.guide_style,
      traits: (p.inferred_traits ?? []).filter((t) => t.status === 'confirmed').map((t) => (t.value ? `${t.trait}: ${t.value}` : t.trait)),
      trip_goal: tp?.goal ?? null,
      trip_must: tp?.must ?? [],
      trip_avoid: tp?.avoid ?? [],
      companions: tp?.companions ?? null,
    };
  });
  // Orden estable: el orden de participantIds (el dueño primero).
  members.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));

  const told = new Map<string, Set<string>>();
  for (const r of (toldRes.data ?? []) as { place_id: string; layer: string }[]) {
    const s = told.get(r.place_id) ?? new Set<string>();
    s.add(r.layer);
    told.set(r.place_id, s);
  }

  const local = localClock(a.start, weather?.utc_offset_s ?? -3 * 3600);
  const itinerary: ItineraryItem[] = ((itineraryRes.data ?? []) as { title: string; place_name: string | null; lat: number | null; lng: number | null; type: string; days: { date: string } | null }[])
    .filter((b) => !['transfer', 'lodging', 'free'].includes(b.type))
    .map((b) => {
      const date = b.days?.date ?? null;
      const when: ItineraryItem['when'] = !date ? 'future' : date < local.date ? 'past' : date === local.date ? 'today' : 'future';
      return { title: b.title, place_name: b.place_name, lat: b.lat, lng: b.lng, when, date };
    })
    .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));

  const previousTourPlaceIds = new Set<string>();
  for (const t of (prevToursRes.data ?? []) as { id: string; tour_stops: { place_id: string | null }[] | null }[]) {
    if (t.id === a.excludeTourId) continue;
    for (const s of t.tour_stops ?? []) if (s.place_id) previousTourPlaceIds.add(s.place_id);
  }

  return {
    members,
    memories: ((memoriesRes.data ?? []) as { text: string | null }[]).map((m) => m.text ?? '').filter(Boolean),
    told,
    previousTourPlaceIds,
    itinerary,
    saved: (savedRes.data ?? []) as TourBrief['saved'],
    start: a.start,
    durationMin: a.durationMin,
    local,
    weather,
    place,
    answers: a.answers,
  };
}

/** Nombres propios que el chequeo de datos tolera sin cita: el grupo, el Scout, la ciudad y el barrio. */
export function contextProperNouns(brief: TourBrief): string[] {
  return [
    SCOUT.name,
    ...brief.members.flatMap((m) => (m.name ?? '').split(/\s+/)),
    ...[brief.place?.city, brief.place?.neighborhood, brief.place?.country].flatMap((s) => (s ?? '').split(/\s+/)),
  ].filter((s) => s.length > 1);
}

export type { InterestTag };
