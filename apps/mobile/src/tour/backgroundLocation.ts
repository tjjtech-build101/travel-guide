// Ubicación en segundo plano para el tour en vivo con GPS real (PRD 07, Notas técnicas).
// - La task se define a nivel de módulo (no dentro de un componente): este archivo se importa desde el layout raíz.
// - La task corre sin React: escribe cada muestra en el store del tour (Zustand vanilla) y en `backgroundFixes`,
//   que el RealLocationProvider reemite para el mapa y lo demás. El store descarta muestras repetidas.
// - Permiso "siempre" en el momento justo (al empezar el primer tour), con una pantalla previa (BackgroundPermissionSheet).
// Config nativa ya presente en app.config.ts (expo-location con isIosBackgroundLocationEnabled, expo-task-manager,
// UIBackgroundModes location+audio, FOREGROUND_SERVICE_LOCATION): no hace falta recompilar el dev build.
import type { LocationFix } from '@build101/shared';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { backgroundFixes } from '../location/backgroundFixes';
import { useTourStore } from './store';

export const TOUR_LOCATION_TASK = 'tour-location';

export { backgroundFixes };

function toFix(loc: Location.LocationObject): LocationFix {
  return {
    t: loc.timestamp,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    heading: loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
    speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
    accuracy: loc.coords.accuracy ?? 0,
  };
}

if (!TaskManager.isTaskDefined(TOUR_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(TOUR_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[tour] task de ubicación', error.message);
      return;
    }
    for (const loc of data?.locations ?? []) {
      const fix = toFix(loc);
      backgroundFixes.emit(fix);
      useTourStore.getState().onFix(fix);
    }
    // iOS no corre timers de JS en segundo plano: el reloj del tour avanza con cada muestra.
    useTourStore.getState().tick();
  });
}

export type BackgroundPermission = 'granted' | 'denied' | 'undetermined';

export async function backgroundPermission(): Promise<BackgroundPermission> {
  try {
    const p = await Location.getBackgroundPermissionsAsync();
    return p.status as BackgroundPermission;
  } catch {
    return 'denied';
  }
}

/** Foreground ("mientras se usa") y después background ("siempre"). */
export async function requestAlwaysLocation(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.status === 'granted';
  } catch (e) {
    console.warn('[tour] permiso siempre', e);
    return false;
  }
}

export async function startBackgroundUpdates(): Promise<boolean> {
  try {
    if ((await backgroundPermission()) !== 'granted') return false;
    if (await Location.hasStartedLocationUpdatesAsync(TOUR_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(TOUR_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      activityType: Location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Tour en curso',
        notificationBody: 'Tu guía te avisa al llegar a cada parada',
      },
    });
    return true;
  } catch (e) {
    console.warn('[tour] no pude arrancar la ubicación en segundo plano', e);
    return false;
  }
}

export async function stopBackgroundUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TOUR_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(TOUR_LOCATION_TASK);
    }
  } catch {
    // no estaba corriendo
  }
}
