// "Nuevo viaje" (PRD 01 + PRD 31 · planificador colaborativo): Contame → Lo que entendí (trip_brief, 1-3 rondas) →
// Elegí la forma (trip_shapes) → ¿Cómo lo armamos? → plan_trip (menu | auto) → progreso en vivo.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

import { Building } from '../../../features/newTrip/Building';
import { BriefStep } from '../../../features/newTrip/BriefStep';
import { BuildStep } from '../../../features/newTrip/BuildStep';
import { requestBrief, requestNextRound, requestShapes, startPlan } from '../../../features/newTrip/flow';
import { DEMO_STORY, recommendedShape } from '../../../features/newTrip/model';
import { isoIn } from '../../../features/newTrip/parts';
import { ShapesStep } from '../../../features/newTrip/ShapesStep';
import { useNewTripStore } from '../../../features/newTrip/store';
import { TellStep } from '../../../features/newTrip/TellStep';

let demoConsumed = false;

export default function NewTripScreen() {
  const job = useNewTripStore((s) => s.job);
  const phase = useNewTripStore((s) => s.phase);
  const setJob = useNewTripStore((s) => s.setJob);
  // build101:///trips/new?job_id=…&trip_id=… → retomar el progreso de un job (ej. desde una notificación).
  const params = useLocalSearchParams<{ job_id?: string; trip_id?: string; demo?: string; go?: string }>();
  useEffect(() => {
    if (params.job_id && params.trip_id && job?.job_id !== params.job_id) setJob({ job_id: params.job_id, trip_id: params.trip_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.job_id, params.trip_id]);

  // Android: el botón atrás vuelve de fase antes de salir de la pantalla.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = useNewTripStore.getState();
      if (s.job || s.phase === 'tell') return false;
      s.back();
      return true;
    });
    return () => sub.remove();
  }, []);

  useDemo(params.demo, params.go);

  return (
    <>
      <Stack.Screen options={{ title: 'Nuevo viaje', headerBackButtonDisplayMode: 'minimal' }} />
      {job ? (
        <Building job={job} />
      ) : phase === 'brief' ? (
        <BriefStep />
      ) : phase === 'shapes' ? (
        <ShapesStep />
      ) : phase === 'build' ? (
        <BuildStep />
      ) : (
        <TellStep />
      )}
    </>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Solo dev: build101:///trips/new?demo=1 escribe la frase de prueba, pasa por las rondas de "Lo que entendí" con los
 * defaults y elige la forma recomendada; con &go=1 además toca "Armémoslo juntos".
 */
function useDemo(demo: string | undefined, go: string | undefined) {
  const ran = useRef(false);
  useEffect(() => {
    if (!__DEV__ || demo !== '1' || ran.current || demoConsumed) return;
    ran.current = true;
    demoConsumed = true; // una sola vez por sesión de JS (no re-disparar al volver a montar)
    router.setParams({ demo: undefined, go: undefined });
    (async () => {
      const store = useNewTripStore.getState();
      store.reset();
      store.setStartDate(isoIn(7));
      await wait(300);
      // Como si se tipeara.
      const words = DEMO_STORY.split(' ');
      for (let i = 1; i <= words.length; i += 3) {
        useNewTripStore.getState().setStory(words.slice(0, i).join(' '));
        await wait(40);
      }
      useNewTripStore.getState().setStory(DEMO_STORY);
      await wait(600);
      if (!(await requestBrief())) return;
      await wait(1200);
      // Defaults preseleccionados en cada ronda; "Seguir" hasta que la entrevista diga done (máx. 3 rondas).
      for (let i = 0; i < 3 && useNewTripStore.getState().phase === 'brief'; i++) {
        if (!(await requestNextRound())) return;
        await wait(1200);
      }
      if (useNewTripStore.getState().phase !== 'shapes' && !(await requestShapes())) return;
      await wait(1200);
      const shape = recommendedShape(useNewTripStore.getState().shapes ?? []);
      if (!shape) return;
      useNewTripStore.getState().chooseShape(shape.id);
      useNewTripStore.getState().setPhase('build');
      if (go === '1') {
        await wait(1200);
        await startPlan('menu');
      }
    })();
  }, [demo, go]);
}
