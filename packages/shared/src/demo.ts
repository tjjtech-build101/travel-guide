// IDs fijos del seed de demo (supabase/seed.sql). Usarlos en tests, menú dev y scripts.

export const DEMO_USERS = {
  juan: '00000000-0000-0000-0000-000000000001',
  ana: '00000000-0000-0000-0000-000000000002',
  leo: '00000000-0000-0000-0000-000000000003',
  sofi: '00000000-0000-0000-0000-000000000004',
} as const;

export const DEMO_USER_EMAILS = {
  juan: 'juan@demo.build101.dev',
  ana: 'ana@demo.build101.dev',
  leo: 'leo@demo.build101.dev',
  sofi: 'sofi@demo.build101.dev',
} as const;

/** Solo para login de demo en __DEV__ y en Supabase local. */
export const DEMO_PASSWORD = 'build101-demo';

export const DEMO_TRIP_ID = '10000000-0000-0000-0000-000000000001';

export const DEMO_LEGS = {
  montevideo: '20000000-0000-0000-0000-000000000001',
  colonia: '20000000-0000-0000-0000-000000000002',
  buenosAiresSofi: '20000000-0000-0000-0000-000000000003',
  buenosAires: '20000000-0000-0000-0000-000000000004',
} as const;

export const DEMO_TOUR_ID = '50000000-0000-0000-0000-000000000001';

export const DEMO_PERSONAS = {
  companion: '40000000-0000-0000-0000-000000000001',
  donJulio: '40000000-0000-0000-0000-000000000002',
} as const;

/** Desfase entre el inicio del video grabado y el inicio del track de GPS (PRD 09). */
export const DEMO_VIDEO_OFFSET_S = 0;
