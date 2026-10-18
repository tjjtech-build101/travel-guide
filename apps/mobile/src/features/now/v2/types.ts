// Tipos compartidos entre los carriles de Ahora v2 (docs/AHORA-V2.md). Selectores → hooks → componentes → pantalla.
import type { GapSuggestion } from '@build101/shared';

import type { PlanBlock } from '../../plan/selectors';
import type { NowCurrent, NowNext } from '../selectors';
import type { Eta } from '../useEta';

export type { GapSuggestion };

/** Lo que elige pickHero (selectors.ts). Exactamente uno por pantalla. */
export type HeroMode =
  | { kind: 'leave'; next: NowNext; eta: Eta; leaveIn: number; urgency: 'ok' | 'soon' | 'late' }
  | { kind: 'tour'; block: PlanBlock; when: 'current' | 'next'; inMin: number }
  | { kind: 'current'; current: NowCurrent }
  | { kind: 'free'; gapMin: number | null; until: NowNext | null }
  | { kind: 'state'; state: 'before' | 'after' | 'noLegs' | 'noDay'; daysUntil?: number };

export type DayRailItem = {
  id: string;
  title: string;
  type: PlanBlock['type'];
  /** Minutos desde 00:00 (null = sin hora: va al final). */
  start: number | null;
  end: number | null;
  status: 'done' | 'now' | 'next' | 'later';
};

export type WeatherSummary = {
  temp_c: number | null;
  /** Código corto para elegir ícono. */
  icon: 'sun' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog';
  summary: string;
  /** Lluvia ≥ 60 % en las próximas 3 h. */
  rainSoon: boolean;
  /** Hora local "15:00" desde la que llueve, si rainSoon. */
  rainFrom: string | null;
};

/** Plan B por lluvia: bloque al aire libre afectado y si existe variante rain del día. */
export type RainPlanB = { blockId: string; blockTitle: string; at: string; hasRainVariant: boolean };

export type GroupPosition = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  lat: number;
  lng: number;
  updated_at: string;
  /** Distancia a mí en metros (null si no tengo fix). */
  distance_m: number | null;
};

/** Una sola noticia arriba del dock, por prioridad (offline > rain > proposals). */
export type NoticeKind =
  | { kind: 'offline'; minutesAgo: number }
  | { kind: 'rain'; plan: RainPlanB }
  | { kind: 'proposals'; count: number };
