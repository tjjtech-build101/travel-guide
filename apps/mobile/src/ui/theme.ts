// Tokens visuales mínimos. Tipografía grande y botones ≥ 44pt (una mano, modo exterior).

export const colors = {
  bg: '#F6F4EF',
  surface: '#FFFFFF',
  surfaceMuted: '#ECE9E2',
  text: '#1B1B1A',
  textMuted: '#5F5D57',
  border: '#DDD8CE',
  primary: '#1F6FEB',
  primaryText: '#FFFFFF',
  danger: '#C2362B',
  dangerBg: '#FBE9E7',
  warningBg: '#2B2A27',
  warningText: '#FFFFFF',
  skeleton: '#E4E0D7',
  masked: '#8A877F',
  // Plan: propuestas pendientes (tarjeta fantasma y diff).
  ghost: '#2F7D4A',
  success: '#1E6B34',
  successBg: '#E3F2E6',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const font = {
  title: 28,
  h2: 22,
  h3: 18,
  body: 17,
  small: 15,
  tiny: 13,
} as const;

export const MIN_TOUCH = 48;
