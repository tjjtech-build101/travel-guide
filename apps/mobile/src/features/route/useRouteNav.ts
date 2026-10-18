// Navegación en vivo sobre la ruta elegida: progreso por fix (routeProgress), recálculo si te vas de la ruta
// (2 fixes a > 50 m, máx. 1 cada 20 s) y llegada (≤ 35 m, con haptic). La posición viene SIEMPRE del LocationProvider.
import {
  decodePolyline,
  INITIAL_REROUTE,
  nextReroute,
  routeProgress,
  type LocationFix,
  type RouteDetail,
  type RouteProgress,
  type RouteMode,
} from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';

type LatLng = { lat: number; lng: number };

/** Puntos de la ruta: la polilínea, o línea recta origen → destino si es estimada. */
export function routePoints(detail: RouteDetail | null | undefined, origin: LatLng | null, dest: LatLng): LatLng[] {
  const pts = decodePolyline(detail?.polyline);
  if (pts.length >= 2) return pts;
  return origin ? [origin, dest] : [dest];
}

export function useRouteNav({
  detail,
  mode,
  origin,
  dest,
  fix,
  onReroute,
}: {
  detail: RouteDetail | null | undefined;
  mode: RouteMode;
  origin: LatLng | null;
  dest: LatLng;
  fix: LocationFix | null;
  onReroute: (here: LatLng) => void;
}): { points: LatLng[]; progress: RouteProgress | null; arrived: boolean; resetArrived: () => void } {
  const points = useMemo(() => routePoints(detail, origin, dest), [detail, origin, dest]);
  const steps = detail?.steps;
  const totalMin = detail?.duration_min;

  const here = fix ? { lat: fix.lat, lng: fix.lng } : null;
  const progress = useMemo(
    () => (here && detail ? routeProgress({ points, steps: mode === 'transit' ? [] : steps, here, totalMin }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fix?.lat, fix?.lng, points, steps, totalMin, mode, !!detail],
  );

  // Llegada: queda fija hasta "Listo" (no parpadea si el GPS salta).
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (progress?.arrived && !arrived) {
      setArrived(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [progress?.arrived, arrived]);

  // Fuera de ruta → recalcular. No en transporte (vas arriba de un vehículo) ni con ruta estimada (línea recta).
  const reroute = useRef(INITIAL_REROUTE);
  const onRerouteRef = useRef(onReroute);
  onRerouteRef.current = onReroute;
  useEffect(() => {
    // Ruta nueva: se reinicia la cuenta pero no la espera entre recálculos.
    reroute.current = { strikes: 0, lastAt: reroute.current.lastAt };
  }, [detail]);
  useEffect(() => {
    if (!progress || !fix || arrived || !detail || detail.estimated || mode === 'transit') return;
    const r = nextReroute(reroute.current, progress.offRouteM, Date.now());
    reroute.current = r.state;
    if (r.reroute) onRerouteRef.current({ lat: fix.lat, lng: fix.lng });
    // Un paso por fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.t]);

  return { points, progress, arrived, resetArrived: () => setArrived(false) };
}
