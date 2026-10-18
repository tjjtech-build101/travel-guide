// Planificador colaborativo (PRD 31): entrevista (trip_brief) → formas del viaje (trip_shapes) → catálogo del
// destino → menú por tramo con reacciones del grupo (leg_options) → días armados con lugares "elegí 1 de N"
// (blocks.choice_group) → reporte de cobertura de imperdibles. Tipos que comparten la API y la app.
import type { InterestTag } from './profile';

// ───────────────────────── Catálogo del destino (destination_catalog, global por ciudad)

export const CATALOG_TIERS = ['must', 'recommended', 'gem'] as const;
/** must = imperdible (≥2 fuentes o muy notorio) · recommended = muy recomendado · gem = joya local. */
export type CatalogTier = (typeof CATALOG_TIERS)[number];

export const CATALOG_CATEGORIES = [
  'landmark',
  'neighborhood',
  'museum',
  'viewpoint',
  'park',
  'beach',
  'market',
  'food',
  'nightlife',
  'experience',
  'shopping',
  'day_trip',
  'event',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const BEST_TIMES = ['morning', 'midday', 'afternoon', 'sunset', 'evening', 'night', 'any'] as const;
export type BestTime = (typeof BEST_TIMES)[number];

export const BOOKING_NEEDS = ['none', 'recommended', 'required'] as const;
export type BookingNeed = (typeof BOOKING_NEEDS)[number];

export const COST_HINTS = ['free', 'low', 'mid', 'high'] as const;
export type CostHint = (typeof COST_HINTS)[number];

/** regularOpeningHours.periods de Google Places. day: 0=domingo. Sin close = 24 h. */
export type OpeningPeriodLite = {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
};

export type CatalogSource = { url: string; title?: string | null };

export type CatalogItem = {
  /** Slug estable dentro del catálogo de la ciudad (ej. "cementerio-recoleta"). */
  id: string;
  name: string;
  category: CatalogCategory;
  tier: CatalogTier;
  /** Barrio o zona ("Recoleta", "Ciudad Vieja"). Agrupa los días. */
  zone: string | null;
  /** De search_places: nunca inventado. null solo en escapadas sin un lugar puntual. */
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  /** Permanencia típica (min). Escapada de un día: 360-600. */
  duration_min: number;
  best_time: BestTime;
  indoor: boolean;
  booking: BookingNeed;
  cost_hint: CostHint | null;
  interests: InterestTag[];
  /** Una oración: por qué vale la pena. */
  why: string;
  /** Consejo local corto ("Llegá antes de las 10 para evitar la fila"), o null. */
  tip: string | null;
  /** Días de la semana en que cierra (0=domingo). [] si abre todos o no se sabe. */
  closed_days: number[];
  periods: OpeningPeriodLite[] | null;
  /** Solo eventos: fechas YYYY-MM-DD en las que ocurre (dentro del tramo). */
  event_dates: string[] | null;
  /** Hora fija del evento HH:MM, si la hay. */
  event_time: string | null;
  sources: CatalogSource[];
  /** 0-1 (reseñas de Google, sitelinks de Wikidata, cantidad de fuentes). */
  notability: number;
  rating: number | null;
  rating_count: number | null;
};

export type DestinationCatalogRow = {
  id: string;
  /** Normalizado: "buenos aires|argentina". */
  city_key: string;
  city: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
  items: CatalogItem[];
  /** Zonas/barrios recomendados para alojarse, con por qué. */
  lodging_zones: { zone: string; why: string; lat: number | null; lng: number | null }[];
  created_at: string;
  updated_at: string;
};

// ───────────────────────── Menú por tramo (leg_options + leg_option_reactions)

export const OPTION_SECTIONS = ['must', 'for_you', 'gems', 'food', 'day_trips', 'events'] as const;
export type OptionSection = (typeof OPTION_SECTIONS)[number];

export const OPTION_REACTIONS = ['love', 'no', 'must'] as const;
/** love = me copa · no = paso · must = sí o sí. */
export type OptionReaction = (typeof OPTION_REACTIONS)[number];

export type LegOptionRow = {
  id: string;
  trip_id: string;
  leg_id: string;
  item: CatalogItem;
  section: OptionSection;
  /** Afinidad con el grupo del tramo, 0-1. */
  score: number;
  /** Miembros a los que más les va a gustar ("Para vos, Sofi"). */
  for_user_ids: string[];
  /** "A Sofi le va a encantar: arte + arquitectura". */
  reason: string | null;
  /** Entra al armado salvo que alguien lo saque (imperdibles + top por gustos). */
  preselected: boolean;
  sort_order: number;
  created_at: string;
};

export type LegOptionReactionRow = {
  option_id: string;
  trip_id: string;
  user_id: string;
  reaction: OptionReaction;
  created_at: string;
};

/** Decisión de grupo sobre una opción: entra si (preseleccionada o ≥1 love/must) y nadie dijo "no" sin que otro dijera "must". */
export function optionIncluded(o: Pick<LegOptionRow, 'preselected'>, reactions: Pick<LegOptionReactionRow, 'reaction'>[]): boolean {
  const must = reactions.some((r) => r.reaction === 'must');
  if (must) return true;
  const no = reactions.filter((r) => r.reaction === 'no').length;
  const love = reactions.filter((r) => r.reaction === 'love').length;
  if (no > love) return false;
  return o.preselected || love > 0;
}

// ───────────────────────── Entrevista (trip_brief)

/**
 * Dimensiones que la entrevista necesita conocer (v2: entrevista adaptativa en rondas). Cada pregunta cubre una;
 * `coverage` dice cuáles ya se saben. Las preguntas las genera el LLM (no hay lista fija): el id es libre.
 */
export const TRIP_DIMENSIONS = [
  'anchor', // el motivo del viaje: evento, partido, casamiento, recital (fecha/sede/entradas)
  'dates',
  'duration',
  'travelers', // cuántos, quiénes, si alguien se separa o llega después
  'origin', // desde dónde salen (vuelos, jet lag)
  'arrival',
  'departure',
  'lodging',
  'budget',
  'pace',
  'first_time', // primera vez o repetidores (pesa lo canónico vs lo menos conocido)
  'interests',
  'extras', // lo que no es el ancla: escapadas, naturaleza, playas, noche
  'transport', // vuelos internos, auto, campervan, tren
  'food',
  'kids',
  'mobility',
  'must',
  'avoid',
  'other',
] as const;
export type TripDimension = (typeof TRIP_DIMENSIONS)[number];
/** @deprecated v1: usá TripDimension. */
export const TRIP_QUESTION_IDS = TRIP_DIMENSIONS;
/** @deprecated v1: usá TripDimension. */
export type TripQuestionId = TripDimension;

export const TRIP_KINDS = ['event', 'city', 'road_trip', 'beach', 'nature', 'family', 'couple', 'backpacking', 'mixed'] as const;
/** Tipo de viaje: cambia qué se pregunta y cómo se arman los días. */
export type TripKind = (typeof TRIP_KINDS)[number];

export const ANCHOR_KINDS = ['sports', 'concert', 'festival', 'wedding', 'conference', 'other'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/**
 * Ancla del viaje: algo con fecha/lugar que manda sobre todo lo demás (un partido, la final, un recital, un casamiento).
 * En la entrevista sale de lo que dijo el usuario (`researched:false`); trip_shapes investiga el fixture real con web
 * search y las devuelve con fecha, sede, hora y fuentes (`researched:true`). Van como bloques fijos en su día.
 */
export type TripAnchor = {
  id: string;
  /** "Argentina vs Nueva Zelanda (fase de grupos)", "Final del Mundial de Rugby 2027". */
  name: string;
  kind: AnchorKind;
  city: string | null;
  country: string | null;
  date: string | null;
  /** HH:MM local, si se sabe. */
  time: string | null;
  venue: string | null;
  /** have = ya tienen entradas · want = quieren conseguir · watch_out = lo ven afuera (fan zone, bar) · unknown. */
  tickets: 'have' | 'want' | 'watch_out' | 'unknown';
  /** true si la fecha/sede salen de una fuente (no de la memoria del modelo). */
  researched: boolean;
  sources: CatalogSource[];
  /** Una oración: por qué importa o qué ojo tener ("la venta oficial abre…", "a confirmar cuando salga el cruce"). */
  note: string | null;
};

export type TripQuestion = {
  /** Id libre y estable dentro de la entrevista ("team", "phase", "tickets"). Las respuestas se guardan por id. */
  id: string;
  /** Qué dimensión completa (para coverage y para no volver a preguntar). */
  dimension: TripDimension;
  /** Pregunta en voseo, lista para leer o decir. */
  text: string;
  /** Por qué se pregunta (chiquito en la UI). */
  why: string;
  kind: 'single' | 'multi' | 'text' | 'date';
  options: { value: string; label: string }[];
  /** value por defecto (o lista), o null. */
  default: string | string[] | null;
  optional: boolean;
};

export type TripUnderstanding = {
  destinations: { city: string; country: string | null }[];
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  travelers: number | null;
  party: 'solo' | 'couple' | 'friends' | 'family' | null;
  /** Nombres propios mencionados (sin el organizador). */
  names: string[];
  /** Intereses con peso 1-5 (INTEREST_TAGS). */
  interests: Partial<Record<InterestTag, number>>;
  must: string[];
  avoid: string[];
  budget: 'low' | 'mid' | 'high' | 'no_limit' | null;
  pace: 'relaxed' | 'balanced' | 'intense' | null;
  first_time: boolean | null;
  kids_ages: string[];
  /** Texto libre: "llegamos el 24 a las 18 a Ezeiza". */
  arrival: string | null;
  departure: string | null;
  lodging_booked: string | null;
  notes: string[];
  /** v2: tipo de viaje y anclas (eventos con fecha que mandan). */
  trip_kind?: TripKind | null;
  anchors?: TripAnchor[];
  /** v2: ciudad/país de salida ("Buenos Aires"). */
  origin?: string | null;
};

/** data de trip_brief. */
export type TripBriefResult = {
  /** 1-2 frases: lo que entendí. */
  summary: string;
  understood: TripUnderstanding;
  /** Bullets para "Lo que tengo en cuenta" (perfiles del grupo, temporada, eventos, clima). */
  context: string[];
  /** Ordenadas por importancia (máx. 4 por ronda). */
  questions: TripQuestion[];
  /** true = hay lo mínimo para armar (al menos un destino). */
  ready: boolean;
  /** v2: ronda actual (1-3). */
  round?: number;
  /** v2: true = ya sé lo suficiente; la app pasa a las formas del viaje (aunque queden opcionales). */
  done?: boolean;
  /** v2: qué se sabe de cada dimensión (known = lo dijo · assumed = lo supuse · unknown = falta). */
  coverage?: Partial<Record<TripDimension, 'known' | 'assumed' | 'unknown'>>;
};

// ───────────────────────── Formas del viaje (trip_shapes)

export type TripShapeLeg = {
  key: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string;
  includes_organizer: boolean;
  participant_names: string[];
  parallel_with: string[];
  why: string;
};

export type TripShapeTransfer = {
  from_key: string;
  to_key: string;
  date: string;
  mode: 'walk' | 'transit' | 'bus' | 'ferry' | 'flight' | 'car';
  duration_min: number;
  participant_names: string[];
};

export type TripShape = {
  id: string;
  /** "Equilibrado", "Más Buenos Aires + Colonia". */
  label: string;
  /** Una frase de venta. */
  pitch: string;
  /** Pros y contras cortos ("+ 1 día en Colonia", "− menos tiempo en Palermo"). */
  tradeoffs: string[];
  recommended: boolean;
  title: string;
  start_date: string;
  end_date: string;
  legs: TripShapeLeg[];
  transfers: TripShapeTransfer[];
  assumptions: string[];
  /** v2: anclas investigadas (fixture real con fuentes) en las que se apoya esta forma. */
  anchors?: TripAnchor[];
};

/** data de trip_shapes. */
export type TripShapesResult = { variants: TripShape[] };

// ───────────────────────── Cobertura y resultado del armado

export type PlanCoverage = {
  leg_id: string;
  city: string;
  must_total: number;
  must_covered: number;
  /** Imperdibles que quedaron afuera, con el motivo ("cierra los lunes", "no entró en 2 días"). */
  missing: { option_id: string | null; item_id: string; name: string; reason: string }[];
  /** Lugares del día con opciones para elegir. */
  choices: number;
};

/** Respuesta de compose_days (data). */
export type ComposeDaysStart = { job_id: string; trip_id: string };

/** agent_jobs.result de un job kind='compose_days'. */
export type ComposeDaysResult = {
  blocks: number;
  choices: number;
  summary: string;
  coverage: PlanCoverage[];
  /** Avisos del chequeo que quedaron sin resolver ("El martes queda largo: 9 h"). */
  issues: string[];
  undo_token?: string | null;
  failed_legs?: { leg_id: string; city: string; error: string }[];
};

/** data de react_option. */
export type ReactOptionResult = { option_id: string; reaction: OptionReaction | null };

/** data de choose_option. */
export type ChooseOptionResult = { block_id: string; discarded_block_ids: string[] };
