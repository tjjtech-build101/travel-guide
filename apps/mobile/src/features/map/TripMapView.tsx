// Mapa 2D con @rnmapbox/maps (PRD 03). Solo se monta si hay EXPO_PUBLIC_MAPBOX_TOKEN (ver map.tsx).
// Pines y líneas con ShapeSource + CircleLayer/SymbolLayer/LineLayer (nada de vistas nativas por pin).
// Mi posición: puck propio alimentado por el LocationProvider (funciona igual con el simulado), no el nativo.
// Estilo "mapa viejo": Mapbox Streets recoloreado en sepia (vintageStyle.json, `pnpm map:vintage`).
import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { env } from '../../lib/env';
import { useLocationFix } from '../../location/LocationContext';
import { Text } from '../../ui/Text';
import { colors, font, space } from '../../ui/theme';
import { linesGeoJSON, type MapModel, type MapPoint, pointsGeoJSON } from './model';
import vintageStyle from './vintageStyle.json';

const VINTAGE_STYLE = JSON.stringify(vintageStyle);

let tokenSet = false;
function ensureToken() {
  if (tokenSet || !env.mapboxToken) return;
  void Mapbox.setAccessToken(env.mapboxToken);
  tokenSet = true;
}

type Props = {
  model: MapModel;
  selectedId: string | null;
  onSelect: (p: MapPoint) => void;
  onLongPress: (lat: number, lng: number) => void;
  /** Alto (pt) que tapa la hoja de la lista desde abajo: encuadra y centra arriba de ella. */
  bottomInset?: number;
};

export function TripMapView({ model, selectedId, onSelect, onLongPress, bottomInset = 0 }: Props) {
  ensureToken();
  const camera = useRef<Camera>(null);
  const fix = useLocationFix();
  const [loadError, setLoadError] = useState(false);

  const points = useMemo(() => pointsGeoJSON(model.points), [model.points]);
  const lines = useMemo(() => linesGeoJSON(model.lines), [model.lines]);
  const byId = useMemo(() => new Map(model.points.map((p) => [p.id, p])), [model.points]);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const padding = () => ({ paddingTop: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: inset.current });

  // Encuadrar todo al cambiar de alcance.
  useEffect(() => {
    const b = model.bounds;
    if (!b) return;
    const t = setTimeout(() => {
      if (b.ne[0] === b.sw[0] && b.ne[1] === b.sw[1])
        camera.current?.setCamera({ centerCoordinate: b.ne, zoomLevel: 15, padding: padding(), animationDuration: 500 });
      else camera.current?.fitBounds(b.ne, b.sw, [64, 48, 48 + inset.current, 48], 500);
    }, 50);
    return () => clearTimeout(t);
  }, [model.bounds]);

  // Centrar en el elemento elegido desde la lista.
  useEffect(() => {
    const p = selectedId ? byId.get(selectedId) : null;
    if (p) camera.current?.setCamera({ centerCoordinate: [p.lng, p.lat], padding: padding(), animationDuration: 500 });
  }, [selectedId, byId]);

  const puck = useMemo(
    () =>
      fix
        ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [fix.lng, fix.lat] } }
        : null,
    [fix],
  );

  if (loadError) {
    return (
      <View style={[styles.flex, styles.error]}>
        <Text style={styles.errorText}>No pudimos cargar el mapa</Text>
      </View>
    );
  }

  return (
    <MapView
      style={styles.flex}
      styleJSON={VINTAGE_STYLE}
      pitchEnabled={false}
      scaleBarEnabled={false}
      logoEnabled
      onDidFailLoadingMap={() => setLoadError(true)}
      onLongPress={(f) => {
        const [lng, lat] = f.geometry.coordinates;
        onLongPress(lat, lng);
      }}
    >
      <Camera ref={camera} defaultSettings={{ centerCoordinate: [-56.19, -34.9], zoomLevel: 12 }} />
      <ShapeSource id="lines" shape={lines}>
        <LineLayer id="lines-solid" filter={['==', ['get', 'dashed'], 0]} style={{ lineColor: ['get', 'color'], lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
        <LineLayer
          id="lines-dashed"
          filter={['==', ['get', 'dashed'], 1]}
          style={{ lineColor: ['get', 'color'], lineWidth: 3, lineDasharray: [2, 2], lineOpacity: 0.8 }}
        />
      </ShapeSource>
      <ShapeSource
        id="points"
        shape={points}
        onPress={(e) => {
          const id = e.features[0]?.properties?.id as string | undefined;
          const p = id ? byId.get(id) : undefined;
          if (p) onSelect(p);
        }}
        hitbox={{ width: 32, height: 32 }}
      >
        <CircleLayer
          id="points-circle"
          style={{
            circleColor: ['get', 'color'],
            circleRadius: ['case', ['==', ['get', 'id'], selectedId ?? ''], 16, ['==', ['get', 'kind'], 'stop'], 10, 13],
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="points-number"
          style={{ textField: ['get', 'order'], textColor: '#FFFFFF', textSize: 12, textAllowOverlap: true, textIgnorePlacement: true }}
        />
      </ShapeSource>
      {puck ? (
        <ShapeSource id="me" shape={puck}>
          <CircleLayer id="me-halo" style={{ circleColor: colors.primary, circleOpacity: 0.18, circleRadius: 18 }} />
          <CircleLayer id="me-dot" style={{ circleColor: colors.primary, circleRadius: 7, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
        </ShapeSource>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, padding: space.lg },
  errorText: { fontSize: font.body, color: colors.textMuted },
});
