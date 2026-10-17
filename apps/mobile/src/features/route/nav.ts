// Navegación a "Cómo llego" embebido y salida a otras apps de mapas (Apple Maps · Google Maps · Waze, para CarPlay).
import type { RouteMode } from '@build101/shared';
import { router as appRouter } from 'expo-router';
import { Linking } from 'react-native';

import { externalUrls, type ExternalApp } from './model';

export type RouteTarget = {
  /** Si el destino es un bloque: el encabezado muestra "Salí en X" / "Vas X tarde" como Ahora. */
  block_id?: string | null;
  lat: number;
  lng: number;
  name?: string | null;
};

/**
 * Abre la pantalla de ruta (`/trip/[tripId]/route`). Reemplaza a `openDirections` de Ahora:
 *   onDirections={() => openRoute(router, tripId, { block_id: b.id, lat: b.lat, lng: b.lng, name: b.place_name ?? b.title })}
 */
export function openRoute(router: Pick<typeof appRouter, 'push'>, tripId: string, target: RouteTarget) {
  router.push({
    pathname: '/trip/[tripId]/route',
    params: {
      tripId,
      lat: String(target.lat),
      lng: String(target.lng),
      ...(target.block_id ? { block_id: target.block_id } : {}),
      ...(target.name ? { name: target.name } : {}),
    },
  });
}

/**
 * Abre el destino en otra app con el modo elegido. Primero el esquema de la app (sin canOpenURL: pediría
 * LSApplicationQueriesSchemes y un rebuild); si no está instalada, el link web (que abre la app o el navegador).
 */
export async function openInApp(app: ExternalApp, mode: RouteMode, dest: { lat: number; lng: number }): Promise<boolean> {
  const { scheme, web } = externalUrls(app, mode, dest);
  try {
    await Linking.openURL(scheme);
    return true;
  } catch {
    try {
      await Linking.openURL(web);
      return true;
    } catch {
      return false;
    }
  }
}
