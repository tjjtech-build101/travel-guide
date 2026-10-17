// Contrato interno del planificador colaborativo (PRD 31). Lo comparten tres módulos que se escriben en paralelo:
// - catalog.ts   (catálogo del destino: investigar, resolver en Places, cachear, puntuar y armar el menú)
// - compose.ts   (armar los días con lo elegido: zonas → días → orden → comidas → opciones) + check.ts (chequeo)
// - orquestación (planTrip.ts, compose_days, trip_brief, trip_shapes, react_option, choose_option)
// Todo lo puro es testeable sin red; lo que va a la red entra por deps inyectadas.
import type {
  BlockFieldsInput,
  CatalogItem,
  LegOptionRow,
  OptionReaction,
  OptionSection,
  PlanCoverage,
} from '@build101/shared';
import type { PlaceSummary } from '../../google/places';
import type { Usage } from '../schemas';

// ───────────────────────── Grupo

export type PlannerMember = {
  user_id: string;
  name: string;
  /** profiles.interests (+ trip_prefs.interests si hay), pesos 1-5. */
  interests: Record<string, number>;
  avoid: string[];
  must: string[];
  dietary: string[];
  pace: 'relaxed' | 'balanced' | 'intense' | null;
  chronotype: 'early' | 'normal' | 'night' | null;
  budget: 'low' | 'mid' | 'high' | 'no_limit' | null;
  step_free: boolean;
  max_walk_km: number | null;
};

export type PlannerGroup = {
  members: PlannerMember[];
  /** Pesos combinados (combineInterestWeights) + intereses de la conversación (TripUnderstanding.interests). */
  weights: Record<string, number>;
  avoid: string[];
  must: string[];
  dietary: string[];
  /** El más lento manda; la conversación lo pisa. */
  pace: 'relaxed' | 'balanced' | 'intense';
  chronotype: 'early' | 'normal' | 'night';
  budget: 'low' | 'mid' | 'high' | 'no_limit' | null;
  hasKids: boolean;
  firstTime: boolean;
  stepFree: boolean;
};

// ───────────────────────── Catálogo (catalog.ts)

export type CityRef = { city: string; country: string | null; lat: number | null; lng: number | null };

export type CatalogDeps = {
  /** Investigación con Claude + web_search (captureViaTool). Devuelve candidatos SIN resolver en Places. */
  research: (args: { city: CityRef; mode: 'generate' | 'review'; known: string[]; signal?: AbortSignal }) => Promise<{
    items: RawCatalogItem[];
    lodging_zones: { zone: string; why: string }[];
    usage: Usage;
  }>;
  /** search_places (Google o OSM). */
  searchPlaces: (args: { query: string; near?: { lat: number; lng: number }; radius_m?: number; max_results?: number }) => Promise<PlaceSummary[]>;
  /** Horarios + popularidad de un lugar (Places rich). null si no hay datos. */
  placeHours: (googlePlaceId: string) => Promise<{ periods: CatalogItem['periods']; rating_count: number | null } | null>;
  now: () => Date;
};

/** Lo que devuelve el investigador antes de resolver en Places. */
export type RawCatalogItem = {
  name: string;
  /** Consulta para search_places ("Cementerio de la Recoleta, Buenos Aires"). */
  query: string;
  category: CatalogItem['category'];
  tier: CatalogItem['tier'];
  zone: string | null;
  duration_min: number;
  best_time: CatalogItem['best_time'];
  indoor: boolean;
  booking: CatalogItem['booking'];
  cost_hint: CatalogItem['cost_hint'];
  interests: string[];
  why: string;
  tip: string | null;
  closed_days: number[];
  sources: { url: string; title?: string | null }[];
};

export type CatalogResult = {
  items: CatalogItem[];
  lodging_zones: { zone: string; why: string; lat: number | null; lng: number | null }[];
  cached: boolean;
  usage: Usage;
};

// getCatalog(admin, city, deps, opts?) → CatalogResult      (lee/escribe destination_catalog, TTL 30 días)
// legEvents(city, dates, deps & EventsDeps) → CatalogItem[]  (eventos con fecha del tramo; defaultCatalogDeps trae searchEvents)

/** Una fila de leg_options antes de insertar. */
export type LegOptionDraft = Omit<LegOptionRow, 'id' | 'created_at'>;

// buildLegOptions({ trip_id, leg_id, dates, items, events, group, saved }) → LegOptionDraft[]
//   Secciones: must (todos los imperdibles), for_you (top por afinidad, con for_user_ids + reason),
//   gems, food, day_trips, events. preselected = imperdibles + top por gustos que entran en los días.

// ───────────────────────── Armado de días (compose.ts)

export type PickedItem = {
  option_id: string | null;
  item: CatalogItem;
  section: OptionSection;
  /** Sí o sí de alguien (reacción must o "sí o sí" de la conversación). */
  must: boolean;
  /** Afinidad 0-1 (leg_options.score + reacciones). */
  score: number;
  for_user_ids: string[];
  reason: string | null;
  reactions: { user_id: string; reaction: OptionReaction }[];
};

/** Alternativas que quedan para "elegí 1" (no entraron como principal pero son buenas). */
export type ComposeLeg = {
  id: string;
  trip_id: string;
  city: string;
  country: string | null;
  center: { lat: number; lng: number } | null;
  days: { id: string; date: string }[];
  /** Llegada/salida: minutos del día desde los que se puede arrancar / hasta los que hay tiempo. */
  dayWindows: Record<string, { start_min: number; end_min: number }>;
  /** Pronóstico por fecha (si hay). */
  weather: Record<string, { precip_prob: number | null; temp_max: number | null; sunset_min: number | null }>;
  lodging: { lat: number; lng: number } | null;
  lodgingZones: { zone: string; why: string; lat: number | null; lng: number | null }[];
};

export type ComposeInput = {
  leg: ComposeLeg;
  group: PlannerGroup;
  picks: PickedItem[];
  /** Instrucción libre ("más tranqui", "el martes libre a la tarde"); el composer solo usa lo que entiende. */
  instruction?: string | null;
};

/** Un bloque listo para add_block (sin trip_id/leg_id; los pone la orquestación). */
export type ComposedBlock = Omit<BlockFieldsInput, 'participant_ids' | 'is_private'> & {
  day_id: string | null;
  /** Bloques con la misma choice_key son opciones del mismo lugar del día → mismo blocks.choice_group (uuid nuevo). */
  choice_key: string | null;
  /** Para cobertura: qué ítem del catálogo representa. */
  item_id: string | null;
  option_id: string | null;
};

export type ComposeDeps = {
  /** Restaurantes cerca de un punto (search_places "restaurante"/"parrilla"…). */
  searchPlaces: CatalogDeps['searchPlaces'];
};

export type ComposeOutput = {
  blocks: ComposedBlock[];
  /** Ítems elegidos que no entraron, con motivo legible. */
  unplaced: { item: CatalogItem; option_id: string | null; reason: string }[];
  issues: string[];
};

// composeLeg(input, deps) → Promise<ComposeOutput>        (determinístico salvo searchPlaces para comidas)
// checkPlan(leg, blocks, group, ctx?) → PlanIssue[]                     (check.ts, puro; composeLeg ya lo corre adentro)
// repairPlan(leg, blocks, issues, group, ctx?) → { blocks, issues[] }   (check.ts, puro: mueve/acorta/saca lo mínimo)
// coverageFor(leg, picks|options, blocks, unplaced) → PlanCoverage

export type PlanIssue = {
  kind: 'closed' | 'too_long' | 'too_short' | 'no_meal' | 'far' | 'duplicate' | 'outdoor_rain' | 'late_start' | 'must_missing';
  day_id: string | null;
  /** Índices en el array de bloques afectados. */
  block_idx: number[];
  text: string;
};

export type { PlanCoverage };
