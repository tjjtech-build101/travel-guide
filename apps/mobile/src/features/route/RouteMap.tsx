// Mapa de "Cómo llego": la ruta (polilínea; punteada si es estimada), mi posición en vivo (del LocationProvider, así
// el GPS simulado funciona) y el destino. Encuadra la ruta al abrir y después te sigue; si movés el mapa con el dedo
// deja de seguirte y aparece "Recentrar". Sin token de Mapbox: un fondo con el aviso (el resto de la pantalla anda igual).
import type { LocationFix, RouteMode } from '@build101/shared';
import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { env } from '../../lib/env';
import { LocateIcon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import vintageStyle from '../map/vintageStyle.json';

const VINTAGE_STYLE = JSON.stringify(vintageStyle);
const ME = '#1F6FEB';
/** Encuadre de la ruta antes de pasar a seguirte (ms). */
const FIT_THEN_FOLLOW_MS = 3500;
const FOLLOW_ZOOM: Record<RouteMode, number> = { walk: 17, car: 16, transit: 15 };

let tokenSet = false;

type LatLng = { lat: number; lng: number };
type Props = {
  points: LatLng[];
  estimated: boolean;
  fix: LocationFix | null;
  dest: LatLng;
  mode: RouteMode;
  /** Cambia cuando hay ruta nueva (modo o recálculo): re-encuadra. */
  routeKey: string;
  height: number;
  /** Lugar libre arriba (botón volver) para el encuadre. */
  topInset?: number;
};

export function RouteMap(props: Props) {
  if (!env.mapboxToken) {
    return (
      <View style={[styles.fallback, { height: props.height }]} accessibilityLabel="Mapa no disponible">
        <Text style={styles.muted}>Mapa no disponible</Text>
      </View>
    );
  }
  if (!tokenSet) {
    void Mapbox.setAccessToken(env.mapboxToken);
    tokenSet = true;
  }
  return <MapInner {...props} />;
}

function MapInner({ points, estimated, fix, dest, mode, routeKey, height, topInset = 0 }: Props) {
  const camera = useRef<Camera>(null);
  const [failed, setFailed] = useState(false);
  const [follow, setFollow] = useState(false);

  const line = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: points.map((p) => [p.lng, p.lat]) },
    }),
    [points],
  );
  const destShape = useMemo(
    () => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [dest.lng, dest.lat] } }),
    [dest.lat, dest.lng],
  );
  const puck = fix
    ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [fix.lng, fix.lat] } }
    : null;

  // Encuadre de la ruta (y de mí) cuando llega una ruta nueva; después, seguirme.
  const fixRef = useRef(fix);
  fixRef.current = fix;
  useEffect(() => {
    setFollow(false);
    const all = [...points, dest, ...(fixRef.current ? [fixRef.current] : [])];
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const fit = setTimeout(() => {
      if (all.length < 2) {
        camera.current?.setCamera({ centerCoordinate: [dest.lng, dest.lat], zoomLevel: 16, animationDuration: 400 });
        return;
      }
      camera.current?.fitBounds(
        [Math.max(...lngs), Math.max(...lats)],
        [Math.min(...lngs), Math.min(...lats)],
        [56 + topInset, 40, 40, 40],
        500,
      );
    }, 80);
    const toFollow = setTimeout(() => setFollow(true), FIT_THEN_FOLLOW_MS);
    return () => {
      clearTimeout(fit);
      clearTimeout(toFollow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Siguiéndome: centrar en cada fix.
  useEffect(() => {
    if (!follow || !fix) return;
    camera.current?.setCamera({ centerCoordinate: [fix.lng, fix.lat], zoomLevel: FOLLOW_ZOOM[mode], animationDuration: 600 });
  }, [follow, fix?.lat, fix?.lng, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={styles.muted}>No pudimos cargar el mapa</Text>
      </View>
    );
  }

  return (
    <View style={{ height }}>
      <MapView
        style={styles.flex}
        styleJSON={VINTAGE_STYLE}
        pitchEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled={false}
        onDidFailLoadingMap={() => setFailed(true)}
        onCameraChanged={(s) => {
          if (s.gestures.isGestureActive && follow) setFollow(false);
        }}
        accessibilityLabel="Mapa con la ruta"
      >
        <Camera ref={camera} defaultSettings={{ centerCoordinate: [dest.lng, dest.lat], zoomLevel: 15 }} />
        {points.length >= 2 ? (
          <ShapeSource id="route-line" shape={line}>
            {/* Borde blanco abajo para que la ruta se lea sobre el sepia. */}
            <LineLayer
              id="route-line-casing"
              style={{ lineColor: '#FFFFFF', lineWidth: estimated ? 0 : 9, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.9 }}
            />
            <LineLayer
              id="route-line-l"
              style={
                estimated
                  ? { lineColor: colors.primary, lineWidth: 4, lineDasharray: [1.5, 1.5], lineOpacity: 0.85 }
                  : { lineColor: ME, lineWidth: 6, lineCap: 'round', lineJoin: 'round' }
              }
            />
          </ShapeSource>
        ) : null}
        <ShapeSource id="route-dest" shape={destShape}>
          <CircleLayer id="route-dest-c" style={{ circleColor: colors.scout, circleRadius: 11, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
        </ShapeSource>
        {puck ? (
          <ShapeSource id="route-me" shape={puck}>
            <CircleLayer id="route-me-halo" style={{ circleColor: ME, circleOpacity: 0.2, circleRadius: 18 }} />
            <CircleLayer id="route-me-dot" style={{ circleColor: ME, circleRadius: 7, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
          </ShapeSource>
        ) : null}
      </MapView>
      {!follow && fix ? (
        <Pressable
          onPress={() => setFollow(true)}
          accessibilityRole="button"
          accessibilityLabel="Recentrar en mi ubicación"
          style={({ pressed }) => [styles.recenter, pressed && styles.pressed]}
          hitSlop={8}
        >
          <LocateIcon color={colors.text} />
          <Text style={styles.recenterText}>Recentrar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  muted: { fontSize: font.small, color: colors.textMuted },
  recenter: {
    position: 'absolute',
    right: space.md,
    bottom: space.xl,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  recenterText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.8 },
});
