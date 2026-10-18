// Abre el recorrido de la pantalla la primera vez que la ves (al enfocarla, con un respiro para que se dibuje).
// Si el estado de la guía todavía no cargó de AsyncStorage, espera a que cargue. Al salir de la pantalla se cierra.
// Pruebas en simulador: build101:///?guide=welcome&step=2 (cualquier pantalla con su recorrido).
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';

import type { GuideFlowId } from './flows';
import { useGuideStore } from './store';

const DELAY_MS = 700;

export function useGuide(flow: GuideFlowId, enabled = true) {
  // Deep link de pruebas (solo dev): ?guide=<recorrido>&step=<n> abre ese paso aunque ya lo hayas visto; ?guide=off cierra.
  const link = useLocalSearchParams<{ guide?: string; step?: string }>();
  useEffect(() => {
    if (!__DEV__ || !link.guide) return;
    if (link.guide === 'off') return void useGuideStore.setState({ active: null });
    if (link.guide !== flow) return;
    const t = setTimeout(() => {
      useGuideStore.setState({ active: null });
      if (useGuideStore.getState().start(flow, { force: true })) useGuideStore.setState({ active: { flow, index: Number(link.step) || 0 } });
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [flow, link.guide, link.step]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      // Si te vas de la pantalla con su recorrido abierto, se cierra sin marcarse como visto (vuelve la próxima vez).
      const leave = () => {
        if (timer) clearTimeout(timer);
        if (useGuideStore.getState().active?.flow === flow) useGuideStore.setState({ active: null });
      };
      const schedule = () => {
        timer = setTimeout(() => useGuideStore.getState().start(flow), DELAY_MS);
      };
      if (useGuideStore.getState().loaded) {
        schedule();
        return leave;
      }
      const unsub = useGuideStore.subscribe((s) => {
        if (s.loaded) {
          unsub();
          schedule();
        }
      });
      return () => {
        unsub();
        leave();
      };
    }, [flow, enabled]),
  );
}

export { useGuideStore } from './store';
export { GuideTarget, useVirtualTarget } from './targets';
