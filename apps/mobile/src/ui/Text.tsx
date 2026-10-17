// Text de la app: igual al de react-native, pero con la tipografía de la marca. Elige la familia según
// fontWeight y fontSize (títulos ≥ h3 y semibold → Fredoka; el resto → Nunito Sans) y saca el
// fontWeight, porque cada peso es su propia familia. Las negritas van un escalón más livianas que
// el peso pedido (700 → SemiBold, 600 → Medium) para que no se vean tan fuertes.
// Un fontFamily explícito (p. ej. Menlo) se respeta.
// Si las fuentes no cargaron, queda la del sistema.
import { createContext, useContext } from 'react';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { font, fonts } from './theme';

let fontsReady = false;
/** Lo llama app/_layout.tsx cuando useFonts terminó bien. */
export function setFontsReady(ready: boolean) {
  fontsReady = ready;
}

const InsideText = createContext(false);

function weightOf(w: TextStyle['fontWeight']): number {
  if (w === 'bold') return 700;
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? n : 400;
}

function familyFor(weight: TextStyle['fontWeight'], size: number | undefined): string {
  const w = weightOf(weight);
  if ((size ?? 0) >= font.h3 && w >= 600) return w >= 700 ? fonts.display : fonts.displayMedium;
  if (w >= 800) return fonts.bodyBold;
  if (w >= 700) return fonts.bodySemi;
  if (w >= 500) return fonts.bodyMedium;
  return fonts.body;
}

export function Text({ style, ...props }: TextProps) {
  const inside = useContext(InsideText);
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  let next = style;
  // Un Text anidado sin peso ni tamaño propio hereda la familia del de afuera.
  if (fontsReady && !flat.fontFamily && (!inside || flat.fontWeight != null || flat.fontSize != null)) {
    const { fontWeight, ...rest } = flat;
    next = { ...rest, fontFamily: familyFor(fontWeight, flat.fontSize) };
  }
  return (
    <InsideText.Provider value>
      <RNText {...props} style={next} />
    </InsideText.Provider>
  );
}
