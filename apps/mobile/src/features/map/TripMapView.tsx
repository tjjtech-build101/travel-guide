// Mapa 2D con @rnmapbox/maps (PRD 03). Solo se monta si hay EXPO_PUBLIC_MAPBOX_TOKEN (ver map.tsx).
// Pines y líneas con ShapeSource + CircleLayer/SymbolLayer/LineLayer (nada de vistas nativas por pin).
// Mi posición: puck propio alimentado por el LocationProvider (funciona igual con el simulado), no el nativo.
// Estilo "mapa viejo": Mapbox Streets recoloreado en sepia (vintageStyle.json, `pnpm map:vintage`).
// Pines con estado (hechos en gris, "ahora" con halo que late), nombre solo en el elegido y ahora/próximo,
// línea punteada de mi posición al próximo y el ▶ "Ver el día": el Scout camina de parada en parada.
import Mapbox, { Camera, CircleLayer, LineLayer, MapView, MarkerView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { env } from '../../lib/env';
import { useLocationFix } from '../../location/LocationContext';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { colors, space } from '../../ui/theme';
import { bearing, linesGeoJSON, type MapModel, type MapPoint, type PointStatus, pointsGeoJSON } from './model';
import vintageStyle from './vintageStyle.json';

const VINTAGE_STYLE = JSON.stringify(vintageStyle);
const FLY_MS = 1800;

/**
 * Falla al bajar el estilo o las teselas. Mapbox no dice por qué (onDidFailLoadingMap sin argumentos): casi siempre es
 * la conexión, y si no, el token. Se explica con ErrorNotice (lo usa también el mapa chico del tour).
 */
export const MAP_LOAD_ERROR = {
  code: 'map_load_failed',
  message: 'No pude bajar el mapa; casi siempre es la conexión. Revisá el wifi o los datos y reintentá.',
  detail: 'onDidFailLoadingMap (Mapbox no da la causa: red o EXPO_PUBLIC_MAPBOX_TOKEN)',
};

let tokenSet = false;
function ensureToken() {
  if (tokenSet || !env.mapboxToken) return;
  void Mapbox.setAccessToken(env.mapboxToken);
  tokenSet = true;
}

type LngLat = [number, number];

type Props = {
  model: MapModel;
  selectedId: string | null;
  onSelect: (p: MapPoint) => void;
  /** Tocar el mapa fuera de un pin: suelta el elegido. */
  onDeselect?: () => void;
  onLongPress: (lat: number, lng: number) => void;
  /** Alto (pt) que tapa la hoja de la lista desde abajo: encuadra y centra arriba de ella. */
  bottomInset?: number;
  /** Estado del día de hoy (terminado / ahora / próximo) para pintar los pines. */
  status?: Map<string, PointStatus>;
  /** Próximo lugar: línea punteada desde mi posición. */
  next?: MapPoint | null;
  /** Cada cambio centra el mapa en mi posición (o encuadra todo si no hay). */
  recenterTick?: number;
  /** ▶ "Ver el día": activo y la parada a la que vuela ahora (null = la intro, encuadre general). */
  preview?: { target: MapPoint | null } | null;
};

export function TripMapView({
  model,
  selectedId,
  onSelect,
  onDeselect,
  onLongPress,
  bottomInset = 0,
  status,
  next,
  recenterTick = 0,
  preview,
}: Props) {
  ensureToken();
  const camera = useRef<Camera>(null);
  const fix = useLocationFix();
  const [loadError, setLoadError] = useState(false);
  // Reintentar = volver a montar el MapView (vuelve a pedir estilo y teselas).
  const [mapKey, setMapKey] = useState(0);
  const lastSelectAt = useRef(0);

  const points = useMemo(() => pointsGeoJSON(model.points, status, selectedId), [model.points, status, selectedId]);
  const lines = useMemo(() => linesGeoJSON(model.lines), [model.lines]);
  const byId = useMemo(() => new Map(model.points.map((p) => [p.id, p])), [model.points]);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const padding = () => ({ paddingTop: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: inset.current });

  const fitAll = (duration = 500) => {
    const b = model.bounds;
    if (!b) return;
    if (b.ne[0] === b.sw[0] && b.ne[1] === b.sw[1])
      camera.current?.setCamera({ centerCoordinate: b.ne, zoomLevel: 15, pitch: 0, heading: 0, padding: padding(), animationDuration: duration });
    else camera.current?.fitBounds(b.ne, b.sw, [64, 48, 48 + inset.current, 48], duration);
  };

  // Encuadrar todo al cambiar de alcance.
  useEffect(() => {
    if (preview) return;
    const t = setTimeout(() => fitAll(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.bounds]);

  // Centrar en el elemento elegido desde la lista.
  useEffect(() => {
    const p = selectedId ? byId.get(selectedId) : null;
    if (p && !preview) camera.current?.setCamera({ centerCoordinate: [p.lng, p.lat], padding: padding(), animationDuration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, byId]);

  // Botón "mi ubicación".
  useEffect(() => {
    if (!recenterTick) return;
    if (fix) camera.current?.setCamera({ centerCoordinate: [fix.lng, fix.lat], zoomLevel: 16, padding: padding(), animationDuration: 600 });
    else fitAll(600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTick]);

  // "Ahora" late: el halo crece y se apaga con la transición del estilo (sin animar en JS a 60 fps).
  const hasNow = useMemo(() => [...(status?.values() ?? [])].includes('now'), [status]);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!hasNow) return;
    const t = setInterval(() => setPulse((x) => !x), 900);
    return () => clearInterval(t);
  }, [hasNow]);

  // ── ▶ Ver el día: el Scout camina hasta cada parada y la cámara lo sigue ──
  const [scoutAt, setScoutAt] = useState<LngLat | null>(null);
  const scoutRef = useRef<LngLat | null>(null);
  scoutRef.current = scoutAt;
  const active = !!preview;
  const target = preview?.target ?? null;

  useEffect(() => {
    if (!active) {
      if (!scoutRef.current) return; // al montar: ya encuadra el efecto de alcance
      setScoutAt(null);
      // Volver a plano (sin inclinación ni giro) y encuadrar el día.
      camera.current?.setCamera({ pitch: 0, heading: 0, animationDuration: 400 });
      const t = setTimeout(() => fitAll(800), 420);
      return () => clearTimeout(t);
    }
    // Arranca donde estoy yo (o en el primer lugar del día).
    const first = model.points.find((p) => p.kind === 'block');
    setScoutAt(fix ? [fix.lng, fix.lat] : first ? [first.lng, first.lat] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (!target) {
      fitAll(900);
      return;
    }
    const from = scoutRef.current ?? [target.lng, target.lat];
    const to: LngLat = [target.lng, target.lat];
    const heading = from[0] === to[0] && from[1] === to[1] ? 0 : bearing({ lng: from[0], lat: from[1] }, target);
    camera.current?.setCamera({
      centerCoordinate: to,
      zoomLevel: 16.2,
      pitch: 55,
      heading,
      padding: padding(),
      animationDuration: FLY_MS,
      animationMode: 'flyTo',
    });
    // El Scout camina en línea recta (ruta aproximada), ~30 fps.
    let raf = 0;
    let last = 0;
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / FLY_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (Date.now() - last > 33 || k === 1) {
        last = Date.now();
        setScoutAt([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
      }
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, target?.id]);

  const puck = useMemo(
    () =>
      fix
        ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [fix.lng, fix.lat] } }
        : null,
    [fix],
  );
  const toNext = useMemo(
    () =>
      fix && next && !active
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: [[fix.lng, fix.lat], [next.lng, next.lat]] },
          }
        : null,
    [fix, next, active],
  );

  if (loadError) {
    return (
      <View style={[styles.flex, styles.error]}>
        <ErrorNotice
          error={MAP_LOAD_ERROR}
          doing="cargar el mapa"
          onRetry={() => {
            setLoadError(false);
            setMapKey((k) => k + 1);
          }}
          style={styles.errorNotice}
        />
      </View>
    );
  }

  return (
    <MapView
      key={mapKey}
      style={styles.flex}
      styleJSON={VINTAGE_STYLE}
      pitchEnabled={false}
      scaleBarEnabled={false}
      logoEnabled
      onDidFailLoadingMap={() => setLoadError(true)}
      onPress={() => {
        // El toque en un pin también llega acá: no soltarlo enseguida.
        if (Date.now() - lastSelectAt.current > 400) onDeselect?.();
      }}
      onLongPress={(f) => {
        const [lng, lat] = (f.geometry as { coordinates: number[] }).coordinates;
        onLongPress(lat, lng);
      }}
    >
      <Camera ref={camera} defaultSettings={{ centerCoordinate: [-56.19, -34.9], zoomLevel: 12 }} />
      <ShapeSource id="lines" shape={lines}>
        <LineLayer
          id="lines-solid"
          filter={['==', ['get', 'dashed'], 0]}
          style={{ lineColor: ['get', 'color'], lineWidth: 3, lineOpacity: 0.7, lineCap: 'round', lineJoin: 'round' }}
        />
        <LineLayer
          id="lines-dashed"
          filter={['==', ['get', 'dashed'], 1]}
          style={{ lineColor: ['get', 'color'], lineWidth: 3, lineDasharray: [2, 2], lineOpacity: 0.55 }}
        />
      </ShapeSource>
      {toNext ? (
        <ShapeSource id="to-next" shape={toNext}>
          <LineLayer id="to-next-line" style={{ lineColor: colors.primary, lineWidth: 2.5, lineDasharray: [0.6, 1.6], lineCap: 'round', lineOpacity: 0.9 }} />
        </ShapeSource>
      ) : null}
      <ShapeSource
        id="points"
        shape={points}
        onPress={(e) => {
          const id = e.features[0]?.properties?.id as string | undefined;
          const p = id ? byId.get(id) : undefined;
          if (p) {
            lastSelectAt.current = Date.now();
            onSelect(p);
          }
        }}
        hitbox={{ width: 32, height: 32 }}
      >
        <CircleLayer
          id="points-halo"
          filter={['==', ['get', 'status'], 'now']}
          style={{
            circleColor: ['get', 'color'],
            circleRadius: pulse ? 28 : 17,
            circleRadiusTransition: { duration: 900, delay: 0 },
            circleOpacity: pulse ? 0.05 : 0.35,
            circleOpacityTransition: { duration: 900, delay: 0 },
          }}
        />
        <CircleLayer
          id="points-circle"
          style={{
            circleColor: ['get', 'color'],
            circleRadius: ['case', ['==', ['get', 'id'], selectedId ?? ''], 16, ['==', ['get', 'kind'], 'stop'], 6, 13],
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: ['case', ['==', ['get', 'kind'], 'stop'], 1.5, 2],
            circleOpacity: ['case', ['==', ['get', 'kind'], 'stop'], 0.85, 1],
          }}
        />
        <SymbolLayer
          id="points-number"
          filter={['!=', ['get', 'order'], '']}
          style={{ textField: ['get', 'order'], textColor: '#FFFFFF', textSize: 12, textAllowOverlap: true, textIgnorePlacement: true }}
        />
        <SymbolLayer
          id="points-label"
          filter={['!=', ['get', 'label'], '']}
          style={{
            textField: ['get', 'label'],
            textSize: 13,
            textColor: colors.text,
            textHaloColor: colors.surface,
            textHaloWidth: 2,
            textAnchor: 'left',
            textOffset: [1.5, 0],
            textMaxWidth: 12,
          }}
        />
      </ShapeSource>
      {puck ? (
        <ShapeSource id="me" shape={puck}>
          <CircleLayer id="me-halo" style={{ circleColor: colors.primary, circleOpacity: 0.18, circleRadius: 18 }} />
          <CircleLayer id="me-dot" style={{ circleColor: colors.primary, circleRadius: 7, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 3 }} />
        </ShapeSource>
      ) : null}
      {active && scoutAt ? (
        <MarkerView coordinate={scoutAt} anchor={{ x: 0.5, y: 0.85 }} allowOverlap>
          <View style={styles.scoutPin} pointerEvents="none">
            <ScoutAvatar size={40} state="speaking" />
          </View>
        </MarkerView>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, padding: space.lg },
  errorNotice: { alignSelf: 'stretch' },
  scoutPin: {
    backgroundColor: colors.surface,
    borderRadius: 40,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
