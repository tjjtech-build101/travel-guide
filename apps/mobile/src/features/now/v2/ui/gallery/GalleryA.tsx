// Galería del carril uia (Ahora v2): cada componente chico en todos sus estados, con datos fijos.
// Para sacar capturas: montala en una ruta dev (p. ej. app/(app)/dev/gallery-a.tsx → <GalleryA />).
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../../../../../ui/Text';
import { colors, font, space } from '../../../../../ui/theme';
import type { DayRailItem, NoticeKind, WeatherSummary } from '../../types';
import { Countdown } from '../Countdown';
import { DayRail } from '../DayRail';
import { GroupFaces, type GroupFacesPerson } from '../GroupFaces';
import { InlineNotice } from '../InlineNotice';
import { ScoutLine } from '../ScoutLine';
import { WeatherChip } from '../WeatherChip';

const noop = () => {};

const RAIL_NOW: DayRailItem[] = [
  { id: 'b1', title: 'Desayuno', type: 'meal', start: 8 * 60, end: 9 * 60, status: 'done' },
  { id: 'b2', title: 'Ciudad Vieja a pie', type: 'tour', start: 9 * 60 + 30, end: 12 * 60, status: 'done' },
  { id: 'b3', title: 'Almuerzo en el Mercado del Puerto', type: 'meal', start: 12 * 60 + 30, end: 14 * 60, status: 'now' },
  { id: 'b4', title: 'Museo Torres García', type: 'activity', start: 15 * 60, end: 16 * 60, status: 'next' },
  { id: 'b5', title: 'Rambla al atardecer', type: 'activity', start: 18 * 60, end: 19 * 60, status: 'later' },
  { id: 'b6', title: 'Cena', type: 'meal', start: null, end: null, status: 'later' },
];
const RAIL_GAP: DayRailItem[] = RAIL_NOW.map((i) => (i.status === 'now' ? { ...i, status: 'done' } : i));
const RAIL_DONE: DayRailItem[] = RAIL_NOW.map((i) => ({ ...i, status: 'done' }));

const W = (icon: WeatherSummary['icon'], temp_c: number | null, summary: string): WeatherSummary => ({
  icon,
  temp_c,
  summary,
  rainSoon: icon === 'rain' || icon === 'storm',
  rainFrom: icon === 'rain' ? '15:00' : null,
});

const PEOPLE: GroupFacesPerson[] = [
  { id: 'u1', display_name: 'Ana Pérez', avatar_url: null, distance_m: 300 },
  { id: 'u2', display_name: 'Leo Gómez', avatar_url: null, distance_m: 20 },
  { id: 'u3', display_name: 'Caro', avatar_url: null, distance_m: 1450 },
  { id: 'u4', display_name: 'Juan', avatar_url: null, distance_m: null },
  { id: 'u5', display_name: 'Sofi', avatar_url: null },
];

const NOTICES: NoticeKind[] = [
  { kind: 'offline', minutesAgo: 4 },
  { kind: 'offline', minutesAgo: 0 },
  { kind: 'rain', plan: { blockId: 'b5', blockTitle: 'Rambla al atardecer', at: '15:00', hasRainVariant: true } },
  { kind: 'rain', plan: { blockId: 'b5', blockTitle: 'Rambla al atardecer', at: '15:30', hasRainVariant: false } },
  { kind: 'proposals', count: 3 },
  { kind: 'proposals', count: 1 },
];


export function GalleryA() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Galería A · piezas de Ahora</Text>

      <Section title="DayRail · con bloque en curso">
        <DayRail items={RAIL_NOW} onPress={noop} />
      </Section>
      <Section title="DayRail · entre bloques (marcador)">
        <DayRail items={RAIL_GAP} onPress={noop} />
      </Section>
      <Section title="DayRail · día terminado">
        <DayRail items={RAIL_DONE} onPress={noop} />
      </Section>
      <Section title="DayRail · vacío (no renderiza)">
        <DayRail items={[]} onPress={noop} />
      </Section>

      <Section title="Countdown · ok / soon / late">
        <View style={styles.stack}>
          <Countdown text="Salí en 25 min" urgency="ok" sub="A pie · 12 min" />
          <Countdown text="6:30" urgency="soon" sub="A pie · 8 min" />
          <Countdown text="Vas 5 min tarde" urgency="late" sub="En transporte · 15 min aprox." />
          <Countdown text="Salí ya" urgency="late" />
        </View>
      </Section>


      <Section title="WeatherChip · todos los íconos">
        <View style={styles.wrapRow}>
          <WeatherChip weather={W('sun', 18, 'Soleado')} />
          <WeatherChip weather={W('cloud', 14.6, 'Nublado')} />
          <WeatherChip weather={W('rain', 12, 'Lluvia')} />
          <WeatherChip weather={W('storm', 21, 'Tormenta')} />
          <WeatherChip weather={W('snow', -2, 'Nieve')} />
          <WeatherChip weather={W('fog', 9, 'Niebla')} />
          <WeatherChip weather={W('cloud', null, 'Sin temperatura')} />
          <WeatherChip weather={null} />
        </View>
      </Section>

      <Section title="GroupFaces · con distancias / sin / uno solo">
        <View style={styles.stack}>
          <GroupFaces people={PEOPLE} />
          <GroupFaces people={PEOPLE.map((p) => ({ ...p, distance_m: null }))} />
          <GroupFaces people={PEOPLE.slice(0, 1)} />
          <GroupFaces people={[]} />
        </View>
      </Section>

      <Section title="ScoutLine · cargando / reglas → Claude (fade) / larga">
        <View style={styles.stack}>
          <ScoutLine text="" loading onPress={noop} />
          <ScoutLineSwap />
          <ScoutLine
            text="Tenés 45 minutos libres antes del museo: el Mercado del Puerto queda a 6 cuadras y a esta hora no hay cola, ideal para un café."
            onPress={noop}
          />
        </View>
      </Section>

      <Section title="InlineNotice · cada tipo">
        <View style={styles.stack}>
          {NOTICES.map((n, i) => (
            <InlineNotice key={i} notice={n} onPress={noop} onDismiss={n.kind === 'offline' ? undefined : noop} />
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}

/** Alterna el texto cada 3 s para ver el fundido. */
function ScoutLineSwap() {
  const texts = ['Salí en 8 min para el museo.', 'Arrancá ya: el museo queda a 8 min a pie y cierra la sala grande a las 16.'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % texts.length), 3000);
    return () => clearInterval(t);
  }, [texts.length]);
  return <ScoutLine text={texts[i]} onPress={noop} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 80, gap: space.xl },
  h1: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  h2: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted, marginBottom: space.sm, textTransform: 'uppercase' },
  section: {},
  stack: { gap: space.md },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
