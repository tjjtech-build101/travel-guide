// Tokens visuales mínimos. Tipografía grande y botones ≥ 44pt (una mano, modo exterior).
// Paleta del uniforme del Scout: beige, caqui y cuero (principal: marrón sombrero). Regla: el rojo
// (`scout`) es solo de lo del Scout (hablar, llamada, sus tours); los errores usan `danger`, más oscuro.

export const colors = {
  bg: '#F3EBDA', // pergamino
  surface: '#FFF9EE',
  surfaceMuted: '#EADFC6',
  text: '#2A1E17', // cuero
  textMuted: '#6E6050',
  border: '#DDCCAA',
  primary: '#8A6236', // marrón sombrero
  primaryText: '#FFFFFF',
  scout: '#D33B2D', // rojo pañuelo
  scoutText: '#FFFFFF',
  khaki: '#CFB077',
  khakiLight: '#EFE3C4',
  khakiText: '#6A4930',
  bronze: '#D6A23C',
  bronzeText: '#8A5A0E',
  danger: '#B42318',
  dangerBg: '#FBE7E3',
  warningBg: '#2A1E17',
  warningText: '#FFFFFF',
  skeleton: '#E7DCC2',
  masked: '#8E8170',
  // Plan: propuestas pendientes (tarjeta fantasma y diff).
  ghost: '#6E7744', // oliva (medias)
  success: '#5F6B35',
  successBg: '#ECEBD2',
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

// Familias cargadas en app/_layout.tsx (useFonts). Títulos y horas: Fredoka; texto: Nunito Sans.
// No hace falta usarlas a mano: ui/Text elige la familia según fontWeight y fontSize.
export const fonts = {
  displayMedium: 'Fredoka_500Medium',
  display: 'Fredoka_600SemiBold',
  body: 'NunitoSans_400Regular',
  bodyMedium: 'NunitoSans_500Medium',
  bodySemi: 'NunitoSans_600SemiBold',
  bodyBold: 'NunitoSans_700Bold',
} as const;

export const MIN_TOUCH = 48;
