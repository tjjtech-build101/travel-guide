// Mapa chico del tour en vivo (PRD 07): ruta, paradas numeradas (visitada gris, salteada tachada, próxima resaltada)
// y el puntito dibujado desde el LocationProvider (no el componente de ubicación de Mapbox: no vería el simulado).
// Sin token de Mapbox: lista mínima con distancias (nunca pantalla vacía).
import type { EngineState, EngineTour, LocationFix } from '@build101/shared';
import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { env } from '../../lib/env';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import vintageStyle from '../map/vintageStyle.json';

const VINTAGE_STYLE = JSON.stringify(vintageStyle);
let tokenSet = false;

type Props = { tour: EngineTour; engine: EngineState; fix: LocationFix | null; nextId: string | null; height?: number };

export function TourMiniMap({ tour, engine, fix, nextId, height = 220 }: Props) {
  if (!env.mapboxToken) return null;
  if (!tokenSet) {
    void Mapbox.setAccessToken(env.mapboxToken);
    tokenSet = true;
  }
  return <MapInner tour={tour} engine={engine} fix={fix} nextId={nextId} height={height} />;
}

function MapInner({ tour, engine, fix, nextId, height }: Required<Omit<Props, 'fix' | 'nextId'>> & Pick<Props, 'fix' | 'nextId'>) {
  const camera = useRef<Camera>(null);
  const [failed, setFailed] = useState(false);
  const ordered = useMemo(() => [...tour.stops].sort((a, b) => a.sort_order - b.sort_order), [tour.stops]);

  const line = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: ordered.filter((s) => !engine.skipped.includes(s.stop_id)).map((s) => [s.lng, s.lat]),
      },
    }),
    [ordered, engine.skipped],
  );

  const points = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: ordered.map((s) => {
        const state = engine.skipped.includes(s.stop_id)
          ? 'skipped'
          : engine.insideStopId === s.stop_id
            ? 'here'
            : engine.visited[s.stop_id]
              ? 'visited'
              : s.stop_id === nextId
                ? 'next'
                : 'pending';
        return {
          type: 'Feature' as const,
          properties: { id: s.stop_id, order: String(s.sort_order), state },
          geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        };
      }),
    }),
    [ordered, engine.skipped, engine.visited, engine.insideStopId, nextId],
  );

  // Encuadre: todas las paradas (y vos) al abrir.
  useEffect(() => {
    const lats = ordered.map((s) => s.lat).concat(fix ? [fix.lat] : []);
    const lngs = ordered.map((s) => s.lng).concat(fix ? [fix.lng] : []);
    if (!lats.length) return;
    const t = setTimeout(
      () => camera.current?.fitBounds([Math.max(...lngs), Math.max(...lats)], [Math.min(...lngs), Math.min(...lats)], [28, 28, 28, 28], 400),
      80,
    );
    return () => clearTimeout(t);
    // Solo al montar / cambiar de tour: no perseguir cada muestra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.tour_id]);

  const puck = fix
    ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [fix.lng, fix.lat] } }
    : null;

  if (failed) {
    return (
      <View style={[styles.box, { height }, styles.center]}>
        <Text style={styles.muted}>No pudimos cargar el mapa</Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, { height }]} accessibilityLabel="Mapa del tour">
      <MapView
        style={styles.flex}
        styleJSON={VINTAGE_STYLE}
        pitchEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled={false}
        onDidFailLoadingMap={() => setFailed(true)}
      >
        <Camera ref={camera} defaultSettings={{ centerCoordinate: [ordered[0]?.lng ?? -56.19, ordered[0]?.lat ?? -34.9], zoomLevel: 15 }} />
        <ShapeSource id="tour-line" shape={line}>
          <LineLayer id="tour-line-l" style={{ lineColor: colors.primary, lineWidth: 3, lineDasharray: [2, 1.5], lineOpacity: 0.8 }} />
        </ShapeSource>
        <ShapeSource id="tour-stops" shape={points}>
          <CircleLayer
            id="tour-stops-c"
            style={{
              circleColor: [
                'match',
                ['get', 'state'],
                'visited', '#A89A86',
                'skipped', '#C9BBA2',
                'here', colors.success,
                'next', colors.scout,
                colors.primary,
              ],
              circleRadius: ['match', ['get', 'state'], 'next', 14, 'here', 14, 11],
              circleStrokeColor: '#FFFFFF',
              circleStrokeWidth: 2,
            }}
          />
          <SymbolLayer
            id="tour-stops-n"
            style={{ textField: ['get', 'order'], textColor: '#FFFFFF', textSize: 12, textAllowOverlap: true, textIgnorePlacement: true }}
          />
        </ShapeSource>
        {puck ? (
          <ShapeSource id="tour-me" shape={puck}>
            <CircleLayer id="tour-me-halo" style={{ circleColor: '#1F6FEB', circleOpacity: 0.2, circleRadius: 16 }} />
            <CircleLayer id="tour-me-dot" style={{ circleColor: '#1F6FEB', circleRadius: 6, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
          </ShapeSource>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.lg },
  muted: { fontSize: font.small, color: colors.textMuted },
});
