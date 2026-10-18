// Valores enumerados de Contratos (docs/CONTRACTS.md). Cambiar acá = cambiar la migración también.

export const BLOCK_TYPES = ['activity', 'meal', 'tour', 'transfer', 'lodging', 'free', 'meetup'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const TIME_FLEX = ['fixed', 'morning', 'afternoon', 'evening', 'any'] as const;
export type TimeFlex = (typeof TIME_FLEX)[number];

export const BLOCK_STATUS = ['idea', 'proposed', 'confirmed', 'booked'] as const;
export type BlockStatus = (typeof BLOCK_STATUS)[number];

export const PLAN_VARIANTS = ['main', 'rain', 'closed'] as const;
export type PlanVariant = (typeof PLAN_VARIANTS)[number];

export const TRANSFER_MODES = ['walk', 'transit', 'bus', 'ferry', 'flight', 'car'] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

export const TRIP_ROLES = ['organizer', 'traveler', 'follower'] as const;
export type TripRole = (typeof TRIP_ROLES)[number];

export const LOCATION_SHARING = ['always', 'shared_only', 'never'] as const;
export type LocationSharing = (typeof LOCATION_SHARING)[number];

export const PROPOSAL_STATUS = ['pending', 'accepted', 'rejected', 'expired', 'applied_urgent'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const ROUTE_MODES = ['walk', 'transit', 'car'] as const;
export type RouteMode = (typeof ROUTE_MODES)[number];

// Valores de activity_feed.kind (PRD 00). Los PRDs siguientes agregan los suyos acá.
export const FEED_KINDS = [
  'block_added',
  'block_updated',
  'block_moved',
  'block_removed',
  'proposal_created',
  'undo',
  'busy_changed',
  'trip_planned',
  'member_joined',
  'member_left',
  'member_role_changed',
  'member_legs_changed',
  'tour_generated', // PRD 06
  'days_composed', // PRD 31
  'option_chosen', // PRD 31
  'running_late', // Ahora v2 (report_late)
] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

// Tablas que la app escucha por Realtime (Contratos). days / trip_members / leg_members no se publican.
export const REALTIME_TABLES = [
  'blocks',
  'block_participants',
  'legs',
  'agent_proposals',
  'polls',
  'activity_feed',
  'member_locations',
  'expenses',
  'agent_jobs',
  'leg_options', // PRD 31
  'leg_option_reactions', // PRD 31
] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];
/** PRD 31: van en un canal aparte, así si la migración no está aplicada no tumban el canal principal. */
export const PLANNER_REALTIME_TABLES: readonly RealtimeTable[] = ['leg_options', 'leg_option_reactions'];

export const ACTOR_HEADER = 'x-actor';
export type Actor = 'user' | 'agent';
