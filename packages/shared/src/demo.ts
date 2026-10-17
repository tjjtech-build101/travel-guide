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

/** Paradas del tour curado de Ciudad Vieja (mismas coordenadas que supabase/seed.sql → place_library), en orden. */
export const CIUDAD_VIEJA_STOPS = [
  { name: 'Puerta de la Ciudadela', lat: -34.90674, lng: -56.20125 },
  { name: 'Plaza Independencia', lat: -34.90661, lng: -56.1995 },
  { name: 'Palacio Salvo', lat: -34.90598, lng: -56.1987 },
  { name: 'Teatro Solís', lat: -34.90722, lng: -56.20056 },
  { name: 'Peatonal Sarandí', lat: -34.9069, lng: -56.2025 },
  { name: 'Plaza Matriz', lat: -34.9069, lng: -56.2052 },
  { name: 'Catedral Metropolitana', lat: -34.9066, lng: -56.206 },
  { name: 'Cabildo', lat: -34.90745, lng: -56.20525 },
  { name: 'Museo Torres García', lat: -34.90697, lng: -56.2033 },
  { name: 'Mercado del Puerto', lat: -34.9067, lng: -56.2128 },
] as const;
