// Navegación a "Cómo llego" embebido y salida a otras apps de mapas (Apple Maps · Google Maps · Waze, para CarPlay).
import type { RouteMode } from '@build101/shared';
import { router as appRouter } from 'expo-router';
import { Linking } from 'react-native';

import { externalUrls, routeOrigin, type ExternalApp, type RouteOrigin } from './model';

export type RouteTarget = {
  /** Si el destino es un bloque: el encabezado muestra "Salí en X" / "Vas X tarde" como Ahora. Sin bloque: solo "Llegás". */
  block_id?: string | null;
  lat: number;
  lng: number;
  name?: string | null;
};

/**
 * Última tab visible del viaje (Planificación · Mapa · Ahora), la anota el _layout del viaje con `screenListeners`.
 * La ruta es una tab oculta y el "atrás" de las tabs iría siempre a la primera: "Volver" usa esto (param `from`).
 * Sirve también desde los sheets del Plan (detalle de bloque), que se abren encima de la tab de origen.
 */
let lastTab: RouteOrigin = 'now';
export function noteTripTab(name: string) {
  if (name === 'index' || name === 'map' || name === 'now') lastTab = routeOrigin(name);
}

/**
 * Abre la pantalla de ruta (`/trip/[tripId]/route`) desde Ahora, el Mapa o el detalle de un bloque:
 *   openRoute(router, tripId, { block_id: b.id, lat: b.lat, lng: b.lng, name: b.place_name ?? b.title })
 */
export function openRoute(router: Pick<typeof appRouter, 'push'>, tripId: string, target: RouteTarget) {
  router.push({
    pathname: '/trip/[tripId]/route',
    params: {
      tripId,
      lat: String(target.lat),
      lng: String(target.lng),
      from: lastTab,
      ...(target.block_id ? { block_id: target.block_id } : {}),
      ...(target.name ? { name: target.name } : {}),
    },
  });
}

/**
 * Abre el destino en otra app con el modo elegido. Primero el esquema de la app (sin canOpenURL: pediría
 * LSApplicationQueriesSchemes y un rebuild); si no está instalada, el link web (que abre la app o el navegador).
 * Devuelve cómo se abrió ('app' | 'web') o null si no se pudo.
 */
export async function openInApp(app: ExternalApp, mode: RouteMode, dest: { lat: number; lng: number }): Promise<'app' | 'web' | null> {
  const { scheme, web } = externalUrls(app, mode, dest);
  try {
    await Linking.openURL(scheme);
    return 'app';
  } catch {
    try {
      await Linking.openURL(web);
      return 'web';
    } catch {
      return null;
    }
  }
}
