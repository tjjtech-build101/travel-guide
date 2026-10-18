// Anclas de la guía: <GuideTarget id="…"> envuelve el elemento que el Scout señala; useVirtualTarget registra una
// zona calculada (p. ej. una tab de la barra, que no es nuestra). La guía mide en coordenadas de la ventana.
import { useEffect, useRef, type ReactNode } from 'react';
import { View, type HostInstance, type StyleProp, type ViewStyle } from 'react-native';

export type Rect = { x: number; y: number; w: number; h: number };

type Source = { kind: 'view'; ref: { current: HostInstance | null } } | { kind: 'virtual'; rect: () => Rect | null };

const targets = new Map<string, Source>();

export function GuideTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<HostInstance>(null);
  useEffect(() => {
    const src: Source = { kind: 'view', ref };
    targets.set(id, src);
    return () => {
      if (targets.get(id) === src) targets.delete(id);
    };
  }, [id]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

export function useVirtualTarget(id: string, rect: () => Rect | null) {
  const fn = useRef(rect);
  fn.current = rect;
  useEffect(() => {
    const src: Source = { kind: 'virtual', rect: () => fn.current() };
    targets.set(id, src);
    return () => {
      if (targets.get(id) === src) targets.delete(id);
    };
  }, [id]);
}

/** Dónde está el ancla en la ventana; null si no está montada o no se ve. */
export function measureTarget(id: string): Promise<Rect | null> {
  const src = targets.get(id);
  if (!src) return Promise.resolve(null);
  if (src.kind === 'virtual') return Promise.resolve(src.rect());
  const view = src.ref.current;
  if (!view) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 500);
    view.measureInWindow((x, y, w, h) => {
      clearTimeout(timer);
      resolve(w > 0 && h > 0 ? { x, y, w, h } : null);
    });
  });
}
