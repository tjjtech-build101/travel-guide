// Tipos de filas de las tablas que usan la API y la app hoy (Contratos). Se amplían con cada PRD.
import type {
  BlockStatus,
  BlockType,
  FeedKind,
  LocationSharing,
  PlanVariant,
  ProposalStatus,
  TimeFlex,
  TransferMode,
  TripRole,
} from './constants';

export type Uuid = string;

export interface ProfileRow {
  id: Uuid;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  home_currency: string | null;
  interests: Record<string, number> | null;
  pace: 'relaxed' | 'balanced' | 'intense' | null;
  chronotype: 'early' | 'normal' | 'night' | null;
  budget_level: 'low' | 'mid' | 'high' | 'no_limit' | null;
  dietary: string[] | null;
  mobility: unknown | null;
  languages: string[] | null;
  travel_style: 'planned' | 'mixed' | 'spontaneous' | null;
  avoid: string[] | null;
  guide_name: string | null;
  guide_voice: string | null;
  guide_style: string | null;
  /** Forma en profile.ts (QuietHours / NotificationPrefs). */
  quiet_hours: unknown | null;
  notification_prefs: unknown | null;
  inferred_traits: unknown | null;
  onboarded_at: string | null;
}

export interface TripRow {
  id: Uuid;
  title: string;
  cover_url: string | null;
  base_currency: string;
  budget_mode: 'limited' | 'unlimited';
  status: 'planning' | 'active' | 'finished';
  start_date: string | null;
  end_date: string | null;
  invite_code: string;
  share_id: string | null;
  created_by: Uuid;
  created_at: string;
}

export interface TripMemberRow {
  trip_id: Uuid;
  user_id: Uuid;
  role: TripRole;
  joined_at: string;
  trip_prefs: Record<string, unknown> | null;
  location_sharing: LocationSharing;
  ghost_until: string | null;
  share_location_with_followers: boolean;
  language: string | null;
}

export interface LegRow {
  id: Uuid;
  trip_id: Uuid;
  city: string;
  country: string;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string;
  end_date: string;
  sort_order: number;
}

export interface DayRow {
  id: Uuid;
  leg_id: Uuid;
  date: string;
  weather: Record<string, unknown> | null;
  briefing: string | null;
}

export interface BlockTransfer {
  from?: string;
  to?: string;
  mode: TransferMode;
  duration_min?: number;
  /** Traslados dentro del día: detalle de transporte público (ver Transfer en tools/schemas). */
  lines?: {
    name: string;
    vehicle: 'bus' | 'subway' | 'train' | 'tram' | 'ferry' | 'other';
    from_stop?: string;
    to_stop?: string;
    departure?: string;
    arrival?: string;
    headsign?: string;
    stops?: number;
  }[];
  walk_min?: number;
  summary?: string;
  maps_url?: string;
  estimated?: boolean;
}

export interface BlockAlert {
  kind: 'closes' | 'late' | 'rain' | 'diet' | string;
  text: string;
}

export interface BlockRow {
  id: Uuid;
  trip_id: Uuid;
  leg_id: Uuid;
  day_id: Uuid | null;
  type: BlockType;
  title: string;
  description: string | null;
  google_place_id: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  start_time: string | null;
  end_time: string | null;
  time_flex: TimeFlex;
  duration_min: number | null;
  is_private: boolean;
  status: BlockStatus;
  plan_variant: PlanVariant;
  cost_estimate: number | null;
  cost_currency: string | null;
  booking_url: string | null;
  notes: string | null;
  transfer: BlockTransfer | null;
  alerts: BlockAlert[] | null;
  sources: unknown[] | null;
  tour_id: Uuid | null;
  sort_order: number;
  /** PRD 31: bloques con el mismo choice_group son opciones de un mismo lugar del día ("elegí 1"). */
  choice_group?: Uuid | null;
  created_by: Uuid | null;
  created_by_agent: boolean;
  created_at: string;
  updated_at: string;
}

/** Fila de la vista blocks_visible: privados ajenos enmascarados. */
export interface BlockVisibleRow extends BlockRow {
  masked: boolean;
}

export type ProposalOp =
  | { op: 'add'; block: Record<string, unknown> }
  | { op: 'update'; block_id: Uuid; patch: Record<string, unknown> }
  | { op: 'move'; block_id: Uuid; patch: Record<string, unknown> }
  | { op: 'remove'; block_id: Uuid };

export interface AgentProposalRow {
  id: Uuid;
  trip_id: Uuid;
  leg_id: Uuid | null;
  day_id: Uuid | null;
  created_by: Uuid | null;
  by_agent: boolean;
  summary: string;
  reason: string | null;
  ops: ProposalOp[];
  status: ProposalStatus;
  decided_by: Uuid | null;
  decided_at: string | null;
  created_at: string;
}

export interface ActivityFeedRow {
  id: Uuid;
  trip_id: Uuid;
  actor_user_id: Uuid | null;
  actor_agent: boolean;
  kind: FeedKind | string;
  payload: { summary: string; inverse?: unknown[]; [k: string]: unknown };
  undo_token: string | null;
  created_at: string;
}

export interface AgentJobRow {
  id: Uuid;
  kind: string;
  trip_id: Uuid | null;
  user_id: Uuid;
  status: 'queued' | 'running' | 'done' | 'failed' | string;
  progress: { at: string; text: string }[] | null;
  result: unknown;
  error: string | null;
  /** Código de packages/shared/src/errors.ts (o uno de dominio: skeleton_failed, not_enough_candidates, …). */
  error_code: string | null;
  /** Proveedor que falló, si fue un provider_*. */
  error_provider: string | null;
  created_at: string;
  updated_at: string;
}
