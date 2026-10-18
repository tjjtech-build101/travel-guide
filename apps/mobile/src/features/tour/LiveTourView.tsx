// Ahora con un tour activo (PRD 07 dentro de la vista Ahora, DECISIONES-SABADO): mapa chico con la ruta y el puntito,
// próxima parada + distancia + minutos, chip de tiempo restante, tarjeta del plan B (sin llamada) y los botones
// grandes de siempre: Hablar con el Scout, cámara, Saltar parada, Terminar.
import { engineView, SCOUT, type StopLayer } from '@build101/shared';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useLocationFix, useLocationProvider } from '../../location/LocationContext';
import { requestAlwaysLocation } from '../../tour/backgroundLocation';
import { useTourStore, type LiveTour, type TourCard } from '../../tour/store';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { CameraIcon, FlagIcon, RouteIcon } from '../../ui/icons';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { camera } from '../../voice/camera/cameraStore';
import { useScout } from '../../voice/useScout';
import { openDirections, OUTDOOR, ScoutDock, Tile } from '../now/components';
import { TourMiniMap } from './TourMiniMap';

const DOCK_HEIGHT = 190;
const KEEP_AWAKE_TAG = 'live-tour';

export function LiveTourView() {
  const live = useTourStore((s) => s.live);
  const phase = useTourStore((s) => s.phase);
  const card = useTourStore((s) => s.card);
  const background = useTourStore((s) => s.background);
  const fix = useLocationFix();
  const { kind } = useLocationProvider();
  const scout = useScout();
  const [, setClock] = useState(0);

  // El chip de minutos se actualiza aunque no haya muestras nuevas.
  useEffect(() => {
    const t = setInterval(() => setClock((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Pantalla encendida solo con la vista del tour en primer plano.
  useEffect(() => {
    if (phase !== 'live') return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => void deactivateKeepAwake(KEEP_AWAKE_TAG);
  }, [phase]);

  if (!live) return null;
  const store = useTourStore.getState();
  const v = engineView(live.tour, live.engine, fix, Date.now());
  const inside = v.inside;
  const next = v.next;
  const done = phase === 'done';

  const onTalk = () => {
    if (scout.inCall) void scout.endScoutCall();
    else void store.askScout(inside?.stop_id ?? null);
  };

  const onSkip = () => {
    const target = inside ?? next;
    if (!target) return;
    Alert.alert('Saltar parada', `¿Salteamos ${target.name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Saltar', style: 'destructive', onPress: () => store.skip(target.stop_id) },
    ]);
  };

  const onFinish = () =>
    Alert.alert('Terminar el tour', 'Vas a cerrar el tour. Lo que visitaste queda guardado.', [
      { text: 'Seguir', style: 'cancel' },
      { text: 'Terminar', style: 'destructive', onPress: () => void store.finish() },
    ]);

  // PRD 08: la cámara a pedido (con llamada, el scout narra el resultado; sin llamada, alcanza la tarjeta).
  const onCamera = () => camera.open({ source: 'tour' });

  const statusText = done
    ? 'Tour terminado'
    : v.status === 'waiting'
      ? 'Esperando en el punto de inicio'
      : v.status === 'off_route'
        ? 'Te alejaste de la ruta'
        : inside
          ? `Estás en ${inside.name}`
          : 'En camino';

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: DOCK_HEIGHT + space.xl }]}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.kicker}>TOUR EN VIVO</Text>
            {!done ? (
              <View style={[styles.chip, v.remainingMin <= 10 && styles.chipWarn]} accessibilityLabel={`Quedan ${v.remainingMin} minutos`}>
                <Text style={[styles.chipText, v.remainingMin <= 10 && styles.chipWarnText]}>Quedan {v.remainingMin} min</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {live.title}
          </Text>
          <Text style={styles.status}>
            {statusText} · {v.visited}/{v.total} paradas{v.skipped ? ` · ${v.skipped} salteada${v.skipped > 1 ? 's' : ''}` : ''}
          </Text>
        </View>

        {kind === 'real' && background === 'foreground_only' && !done ? (
          <Pressable style={styles.banner} onPress={() => void Linking.openSettings()} accessibilityRole="button">
            <Text style={styles.bannerText}>
              Mantené la app abierta: sin el permiso de ubicación “siempre”, te aviso de las paradas solo con la pantalla prendida.
            </Text>
            <Text style={styles.bannerLink}>Abrir Ajustes</Text>
          </Pressable>
        ) : null}

        <TourMiniMap tour={live.tour} engine={live.engine} fix={fix} nextId={next?.stop_id ?? null} />

        {card ? <TourCardView card={card} live={live} /> : null}

        {!done ? (
          <View style={[styles.card, styles.nextCard]}>
            {inside ? (
              <>
                <Text style={[styles.kicker, { color: colors.success }]}>ESTÁS EN</Text>
                <Text style={styles.cardTitle}>
                  {inside.sort_order}. {inside.name}
                </Text>
                {next ? <Text style={styles.body}>Después: {next.name}</Text> : <Text style={styles.body}>Es la última parada.</Text>}
                {!scout.inCall && card?.kind !== 'narration' ? (
                  <Button label={`Que me lo cuente ${SCOUT.name}`} onPress={() => void store.askScout(inside.stop_id)} style={styles.cardBtn} />
                ) : null}
              </>
            ) : next ? (
              <>
                <Text style={[styles.kicker, { color: colors.scout }]}>{v.status === 'waiting' ? 'CAMINÁ HASTA LA PRIMERA PARADA' : 'PRÓXIMA PARADA'}</Text>
                <Text style={styles.cardTitle}>
                  {next.sort_order}. {next.name}
                </Text>
                <Text style={styles.big}>
                  {v.distanceM != null ? `${formatMeters(v.distanceM)} · ${v.walkMin} min a pie` : 'Buscando tu ubicación…'}
                </Text>
                <Pressable onPress={() => openDirections({ lat: next.lat, lng: next.lng, place_name: next.name })} accessibilityRole="link">
                  <Text style={styles.link}>Cómo llego</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.body}>No quedan paradas pendientes.</Text>
            )}
          </View>
        ) : null}

        <StopsList live={live} nextId={next?.stop_id ?? null} />
        {__DEV__ && !done ? <DevClock /> : null}
      </ScrollView>

      <ScoutDock
        scoutState={scout.state}
        onTalk={onTalk}
        onNearbyTour={() => {}}
        tourAvailable
        onCamera={onCamera}
        onDirections={null}
        tiles={
          done ? (
            <Tile label="Cerrar tour" onPress={() => store.close()} icon={<FlagIcon color={colors.text} />} />
          ) : (
            <>
              <Tile label="Cámara" onPress={onCamera} icon={<CameraIcon color={colors.text} />} />
              <Tile label="Saltar parada" onPress={onSkip} icon={<RouteIcon color={colors.text} />} hint="Saltea la parada actual o la próxima" />
              <Tile label="Terminar" onPress={onFinish} icon={<FlagIcon color={colors.text} />} />
            </>
          )
        }
      />
      <BackgroundPermissionSheet />
    </View>
  );
}

function formatMeters(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`;
}

const LAYER_LABEL: Record<StopLayer, string> = {
  short: 'LLEGASTE',
  more: 'TE CUENTO MÁS',
  secret: 'UN SECRETO',
  myth: 'MITO O VERDAD',
  photo: 'PARA LA FOTO',
  kid: 'MISIÓN',
  transition: 'EN CAMINO',
};

function TourCardView({ card, live }: { card: TourCard; live: LiveTour }) {
  const store = useTourStore.getState();
  const [showSources, setShowSources] = useState(false);
  switch (card.kind) {
    case 'narration':
      return (
        <View style={[styles.card, styles.planB]} accessibilityLiveRegion="polite">
          <View style={styles.planBHead}>
            <ScoutAvatar size={40} />
            <View style={styles.flex}>
              <Text style={[styles.kicker, { color: colors.scout }]}>{LAYER_LABEL[card.layer]}</Text>
              <Text style={styles.cardTitle}>{card.name}</Text>
            </View>
          </View>
          {card.loading ? (
            <View style={{ gap: space.xs }}>
              <Skeleton height={18} />
              <Skeleton height={18} width="85%" />
              <Skeleton height={18} width="60%" />
            </View>
          ) : card.error ? (
            <ErrorNotice
              error={card.error}
              doing="traer la historia de esta parada"
              onRetry={() => void useTourStore.getState().showLayer(card.stopId, card.layer)}
            />
          ) : card.text && !/^PENDIENTE/i.test(card.text) ? (
            <Text style={styles.narration}>{card.text}</Text>
          ) : (
            <Text style={styles.body}>Todavía no tengo la historia verificada de esta parada. Mirá a tu alrededor: ¡llegaste!</Text>
          )}
          {card.alreadyTold ? <Text style={styles.muted}>Esto ya te lo había contado.</Text> : null}
          {card.sources.length ? (
            <Pressable onPress={() => setShowSources((x) => !x)} accessibilityRole="button">
              <Text style={styles.link}>Fuentes ({card.sources.length})</Text>
            </Pressable>
          ) : null}
          {showSources
            ? card.sources.map((s) => (
                <Pressable key={s.url} onPress={() => void Linking.openURL(s.url).catch(() => {})} accessibilityRole="link">
                  <Text style={styles.source} numberOfLines={1}>
                    {s.title ? `${s.title} · ` : ''}
                    {s.url}
                  </Text>
                </Pressable>
              ))
            : null}
          <Button label={`Que me lo cuente ${SCOUT.name}`} onPress={() => void store.askScout(card.stopId)} style={styles.cardBtn} />
          <Button label="Listo" variant="ghost" onPress={store.dismissCard} />
        </View>
      );
    case 'dwell':
      return (
        <View style={[styles.card, styles.planB]}>
          <Text style={[styles.kicker, { color: colors.scout }]}>SEGUÍS ACÁ</Text>
          <Text style={styles.cardTitle}>¿Te cuento algo más de {card.name}?</Text>
          <Button label={card.offer === 'secret' ? 'Contame un secreto' : 'Contame más'} onPress={() => void store.showLayer(card.stopId, card.offer)} style={styles.cardBtn} />
          <Button label={`Que me lo cuente ${SCOUT.name}`} variant="secondary" onPress={() => void store.askScout(card.stopId)} />
          <Button label="No, gracias" variant="ghost" onPress={store.dismissCard} />
        </View>
      );
    case 'left_route': {
      const n = card.payload.nearest_pending_stop;
      const stop = n ? live.tour.stops.find((s) => s.stop_id === n.stop_id) : null;
      return (
        <View style={[styles.card, styles.planBWarn]}>
          <Text style={[styles.kicker, { color: colors.bronzeText }]}>TE ALEJASTE DE LA RUTA</Text>
          <Text style={styles.cardTitle}>Estás a {formatMeters(card.payload.distance_m)} del recorrido</Text>
          {n ? <Text style={styles.body}>La parada pendiente más cercana es {n.name}, a {formatMeters(n.distance_m)}.</Text> : null}
          {stop ? (
            <Button label="Volver" onPress={() => openDirections({ lat: stop.lat, lng: stop.lng, place_name: stop.name })} style={styles.cardBtn} />
          ) : null}
          <Button label="Explorar un rato" variant="ghost" onPress={store.dismissCard} />
        </View>
      );
    }
    case 'time_warning': {
      const p = card.payload;
      return (
        <View style={[styles.card, styles.planBWarn]}>
          <Text style={[styles.kicker, { color: colors.bronzeText }]}>OJO CON EL TIEMPO</Text>
          <Text style={styles.cardTitle}>Quedan {p.remaining_min} min</Text>
          <Text style={styles.body}>
            Te {p.pending_stops === 1 ? 'falta 1 parada' : `faltan ${p.pending_stops} paradas`} (~{p.est_needed_min} min).
            {p.suggest_skip.length ? ' Para llegar, podés saltear:' : ''}
          </Text>
          {p.suggest_skip.map((s) => (
            <View key={s.stop_id} style={styles.skipRow}>
              <Text style={[styles.body, styles.flex]}>
                {s.name} <Text style={styles.muted}>(ahorrás {s.saves_min} min)</Text>
              </Text>
              <Button label="Saltear" variant="secondary" onPress={() => store.skip(s.stop_id)} />
            </View>
          ))}
          <Button label="Seguir igual" variant="ghost" onPress={store.dismissCard} />
        </View>
      );
    }
    case 'done':
      return (
        <View style={[styles.card, styles.planB]}>
          <Text style={[styles.kicker, { color: colors.success }]}>¡TERMINASTE EL TOUR!</Text>
          <Text style={styles.cardTitle}>{live.title}</Text>
          <Text style={styles.body}>
            Visitaste {card.visited} de {card.total} paradas{card.skipped ? ` y salteaste ${card.skipped}` : ''} en {card.minutes} min.
          </Text>
          <Button label="Volver a Ahora" onPress={() => store.close()} style={styles.cardBtn} />
        </View>
      );
  }
}

function StopsList({ live, nextId }: { live: LiveTour; nextId: string | null }) {
  const eng = live.engine;
  const ordered = [...live.stops].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Paradas</Text>
      {ordered.map((s) => {
        const skipped = eng.skipped.includes(s.stop_id);
        const here = eng.insideStopId === s.stop_id;
        const visited = !!eng.visited[s.stop_id];
        const isNext = s.stop_id === nextId;
        return (
          <View key={s.stop_id} style={styles.stopRow}>
            <View style={[styles.dot, visited && styles.dotVisited, skipped && styles.dotSkipped, isNext && styles.dotNext, here && styles.dotHere]}>
              <Text style={styles.dotText}>{s.sort_order}</Text>
            </View>
            <Text style={[styles.stopName, (visited || skipped) && !here && styles.stopDone, skipped && styles.stopSkipped]} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={styles.muted}>{here ? 'acá' : skipped ? 'salteada' : visited ? '✓' : isNext ? 'próxima' : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Pantalla previa al permiso "siempre" (primer tour con GPS real). */
function BackgroundPermissionSheet() {
  const { kind } = useLocationProvider();
  const background = useTourStore((s) => s.background);
  const phase = useTourStore((s) => s.phase);
  const [busy, setBusy] = useState(false);
  const visible = kind === 'real' && phase === 'live' && background == null;
  const answer = async (allow: boolean) => {
    setBusy(true);
    const ok = allow ? await requestAlwaysLocation() : false;
    setBusy(false);
    useTourStore.getState().setBackground(ok ? 'always' : 'foreground_only');
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void answer(false)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScoutAvatar size={72} />
          <Text style={styles.sheetTitle}>Guardate el celu tranquilo</Text>
          <Text style={styles.sheetBody}>
            Para avisarte cuando llegás a cada parada aunque tengas la pantalla bloqueada, {SCOUT.name} necesita tu ubicación “siempre”
            mientras dura el tour. Cuando termina, deja de usarla.
          </Text>
          <Button label="Permitir siempre" loading={busy} onPress={() => void answer(true)} style={styles.sheetBtn} />
          <Button label="Solo con la app abierta" variant="ghost" onPress={() => void answer(false)} style={styles.sheetBtn} />
        </View>
      </View>
    </Modal>
  );
}

/** Solo en desarrollo: adelantar el reloj del tour para ver los avisos de tiempo sin esperar. */
function DevClock() {
  return (
    <View style={styles.devRow}>
      <Text style={styles.muted}>Dev · reloj del tour:</Text>
      <Pressable onPress={() => useTourStore.getState().devShiftClock(-10)} accessibilityRole="button">
        <Text style={styles.link}>−10 min</Text>
      </Pressable>
      <Pressable onPress={() => useTourStore.getState().devShiftClock(10)} accessibilityRole="button">
        <Text style={styles.link}>+10 min</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.md },
  header: { gap: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.textMuted },
  title: { fontSize: OUTDOOR.title, fontWeight: '800', color: colors.text },
  status: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  chip: { backgroundColor: colors.khakiLight, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
  chipWarn: { backgroundColor: colors.dangerBg },
  chipText: { fontSize: font.small, fontWeight: '800', color: colors.khakiText, fontVariant: ['tabular-nums'] },
  chipWarnText: { color: colors.danger },
  banner: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: space.md, gap: 4 },
  bannerText: { color: colors.warningText, fontSize: font.small, fontWeight: '600' },
  bannerLink: { color: colors.khaki, fontSize: font.small, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.xs },
  nextCard: { borderColor: colors.primary, borderWidth: 2 },
  planB: { borderColor: colors.scout, borderWidth: 2 },
  planBWarn: { borderColor: colors.bronze, borderWidth: 2 },
  planBHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  cardTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  big: { fontSize: font.h3, fontWeight: '800', color: colors.text, marginTop: 2 },
  body: { fontSize: OUTDOOR.body, color: colors.text, lineHeight: 24 },
  narration: { fontSize: OUTDOOR.body, color: colors.text, lineHeight: 25 },
  muted: { fontSize: font.small, color: colors.textMuted },
  link: { fontSize: font.small, color: colors.primary, fontWeight: '800', marginTop: space.xs },
  source: { fontSize: font.tiny, color: colors.primary },
  cardBtn: { marginTop: space.sm },
  skipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 36 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dotVisited: { backgroundColor: '#A89A86' },
  dotSkipped: { backgroundColor: '#C9BBA2' },
  dotNext: { backgroundColor: colors.scout },
  dotHere: { backgroundColor: colors.success },
  dotText: { color: '#FFFFFF', fontSize: font.tiny, fontWeight: '800' },
  stopName: { flex: 1, fontSize: font.body, color: colors.text },
  stopDone: { color: colors.textMuted },
  stopSkipped: { textDecorationLine: 'line-through' },
  devRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.xl },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: space.md },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, textAlign: 'center' },
  sheetBody: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 23 },
  sheetBtn: { alignSelf: 'stretch' },
});
