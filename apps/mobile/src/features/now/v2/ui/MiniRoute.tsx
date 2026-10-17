// Mapita no interactivo (Ahora v2, protagonista "leave"): vos (punto azul) → destino (pin) con línea punteada.
// Encuadra a los dos. Sin token de Mapbox no se muestra; sin "from", solo el destino.
import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { env } from '../../../../lib/env';
import { colors, radius } from '../../../../ui/theme';
import vintageStyle from '../../../map/vintageStyle.json';

export type LatLng = { lat: number; lng: number };

const VINTAGE_STYLE = JSON.stringify(vintageStyle);
const ME = '#1F6FEB';
let tokenSet = false;

type Props = { from: LatLng | null; to: LatLng; height?: number };

export function MiniRoute({ from, to, height = 120 }: Props) {
  const [failed, setFailed] = useState(false);
  if (!env.mapboxToken || failed) return null;
  if (!tokenSet) {
    void Mapbox.setAccessToken(env.mapboxToken);
    tokenSet = true;
  }
  return <MapInner from={from} to={to} height={height} onFail={() => setFailed(true)} />;
}

function MapInner({ from, to, height, onFail }: Required<Omit<Props, 'from'>> & Pick<Props, 'from'> & { onFail: () => void }) {
  const camera = useRef<Camera>(null);

  const line = useMemo(
    () =>
      from
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
          }
        : null,
    [from, to],
  );
  const dest = useMemo(
    () => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [to.lng, to.lat] } }),
    [to],
  );
  const me = useMemo(
    () => (from ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [from.lng, from.lat] } } : null),
    [from],
  );

  // Encuadre a vos + destino; se recalcula solo si te moviste bastante (~100 m) para no saltar con cada muestra.
  const boundsKey = from ? `${from.lat.toFixed(3)},${from.lng.toFixed(3)}|${to.lat},${to.lng}` : `${to.lat},${to.lng}`;
  useEffect(() => {
    if (!from) return;
    const t = setTimeout(
      () =>
        camera.current?.fitBounds(
          [Math.max(from.lng, to.lng), Math.max(from.lat, to.lat)],
          [Math.min(from.lng, to.lng), Math.min(from.lat, to.lat)],
          [24, 32, 24, 32],
          0,
        ),
      60,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  return (
    <View
      style={[styles.box, { height }]}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={from ? 'Mapa: vos y el destino' : 'Mapa del destino'}
    >
      <MapView
        style={styles.flex}
        styleJSON={VINTAGE_STYLE}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        scaleBarEnabled={false}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        onDidFailLoadingMap={onFail}
      >
        <Camera ref={camera} defaultSettings={{ centerCoordinate: [to.lng, to.lat], zoomLevel: 15 }} />
        {line ? (
          <ShapeSource id="mini-route-line" shape={line}>
            <LineLayer id="mini-route-line-l" style={{ lineColor: colors.primary, lineWidth: 3, lineDasharray: [1.5, 1.5], lineCap: 'round' }} />
          </ShapeSource>
        ) : null}
        <ShapeSource id="mini-route-dest" shape={dest}>
          <CircleLayer
            id="mini-route-dest-c"
            style={{ circleColor: colors.primary, circleRadius: 9, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }}
          />
        </ShapeSource>
        {me ? (
          <ShapeSource id="mini-route-me" shape={me}>
            <CircleLayer id="mini-route-me-halo" style={{ circleColor: ME, circleOpacity: 0.2, circleRadius: 14 }} />
            <CircleLayer id="mini-route-me-dot" style={{ circleColor: ME, circleRadius: 6, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
          </ShapeSource>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
});
