// "Nuevo tour" (planificador de tours, como "Nuevo viaje"): Contame → Lo que entendí (tour_interview, 1-4 rondas con
// repreguntas) → Elegí tu recorrido (tour_variants) → generate_tour con la variante elegida. Al arrancar el armado,
// vuelve a Ahora, donde la tarjeta muestra el progreso en vivo.
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { BriefStep } from '../../../features/newTour/BriefStep';
import { useNewTourStore } from '../../../features/newTour/store';
import { TellStep } from '../../../features/newTour/TellStep';
import { VariantsStep } from '../../../features/newTour/VariantsStep';

export default function NewTourScreen() {
  // story / duration: lo que la persona ya le contó al Scout por voz (open_tour_planner), precargado.
  const params = useLocalSearchParams<{ tripId?: string; blockId?: string; lat?: string; lng?: string; story?: string; duration?: string }>();
  const phase = useNewTourStore((s) => s.phase);

  useEffect(() => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const duration = Number(params.duration);
    useNewTourStore.getState().init({
      here: Number.isFinite(lat) && Number.isFinite(lng) && params.lat ? { lat, lng } : null,
      tripId: params.tripId ?? null,
      blockId: params.blockId ?? null,
      story: params.story ?? '',
      ...(Number.isFinite(duration) && duration >= 15 ? { durationMin: Math.min(240, Math.round(duration)) } : {}),
    });
  }, [params.lat, params.lng, params.tripId, params.blockId, params.story, params.duration]);

  // Android: atrás vuelve de paso antes de salir.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = useNewTourStore.getState();
      if (s.phase === 'tell') return false;
      s.back();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Nuevo tour', headerBackButtonDisplayMode: 'minimal' }} />
      {phase === 'brief' ? <BriefStep /> : phase === 'variants' ? <VariantsStep /> : <TellStep />}
    </>
  );
}
