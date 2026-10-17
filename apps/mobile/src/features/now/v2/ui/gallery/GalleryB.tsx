// Galería del carril B de Ahora v2: todas las tarjetas protagonistas, NextRow, LateSheet y DockV2 en
// todos sus estados, con datos de mentira (sin red). Los slots del carril A van con placeholders.
import type { BlockAlert } from '@build101/shared';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../../../../ui/Button';
import { FlagIcon } from '../../../../../ui/icons';
import { Text } from '../../../../../ui/Text';
import { colors, font, radius, space } from '../../../../../ui/theme';
import type { ScoutState } from '../../../../../voice/useScout';
import type { GapSuggestion } from '../../types';
import { DockIcon, DockV2 } from '../DockV2';
import { HeroCurrent } from '../HeroCurrent';
import { HeroFree, type AddState } from '../HeroFree';
import { HeroLeave } from '../HeroLeave';
import { HeroState, PreviewChip } from '../HeroState';
import { HeroTour } from '../HeroTour';
import { LateSheet } from '../LateSheet';
import { NextRow } from '../NextRow';

const noop = () => {};

// ───────────────────────── Fixtures

export const FIX_SUGGESTIONS: GapSuggestion[] = [
  {
    id: 's1',
    source: 'place',
    title: 'Café Brasilero',
    place_name: 'Ituzaingó 1447',
    lat: -34.907,
    lng: -56.203,
    walk_min: 4,
    why: 'Abierto hasta las 19 · 4 min a pie',
  },
  {
    id: 's2',
    source: 'idea',
    title: 'Mercado del Puerto',
    place_name: 'Rambla 25 de Agosto',
    lat: -34.906,
    lng: -56.212,
    walk_min: 12,
    why: 'Lo tenías guardado · 12 min a pie',
    block_id: 'b-idea-1',
  },
  {
    id: 's3',
    source: 'event',
    title: 'Candombe en Barrio Sur',
    place_name: 'Isla de Flores',
    lat: null,
    lng: null,
    walk_min: null,
    why: 'Hoy a las 18:30',
    start_time: '18:30',
  },
];

const FIX_ALERTS: BlockAlert[] = [
  { kind: 'closes', text: 'Cierra a las 17' },
  { kind: 'rain', text: 'Lluvia a las 16' },
];

// ───────────────────────── Placeholders de los slots del carril A

function Slot({ label, height = 40 }: { label: string; height?: number }) {
  return (
    <View style={[styles.slot, { height }]}>
      <Text style={styles.slotText}>{label}</Text>
    </View>
  );
}

function FakeCountdown({ text, color = colors.text }: { text: string; color?: string }) {
  return <Text style={[styles.countdown, { color }]}>{text}</Text>;
}

// ───────────────────────── Galería

export function GalleryB() {
  const [lateOpen, setLateOpen] = useState(false);
  const [notify, setNotify] = useState<'idle' | 'busy' | 'done'>('idle');
  const [adds, setAdds] = useState<Record<string, AddState | undefined>>({ s3: 'added' });
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);

  const add = (s: GapSuggestion) => {
    setAdds((a) => ({ ...a, [s.id]: 'adding' }));
    setTimeout(() => setAdds((a) => ({ ...a, [s.id]: 'added' })), 900);
  };
  const doNotify = () => {
    setNotify('busy');
    setTimeout(() => setNotify('done'), 900);
  };
  const pulse = (set: (v: boolean) => void) => {
    set(true);
    setTimeout(() => set(false), 1200);
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Section title="HeroLeave · ok">
        <HeroLeave
          countdown={<FakeCountdown text="Salí en 24 min" />}
          map={<Slot label="MiniRoute" height={96} />}
          faces={<Slot label="GroupFaces" />}
          title="Cena en Café Misterio"
          placeName="Costa Rica 1700"
          startLabel="21:00"
          onDirections={noop}
          onPress={noop}
        />
      </Section>
      <Section title="HeroLeave · soon (con Voy tarde)">
        <HeroLeave
          countdown={<FakeCountdown text="6:30" color={colors.bronzeText} />}
          map={<Slot label="MiniRoute" height={96} />}
          faces={<Slot label="GroupFaces · Ana a 300 m" />}
          title="Museo Torres García"
          placeName="Sarandí 683"
          startLabel="15:00"
          onDirections={noop}
          onLate={() => setLateOpen(true)}
        />
      </Section>
      <Section title="HeroLeave · late, sin mapa ni caras">
        <HeroLeave
          countdown={<FakeCountdown text="Vas 8 min tarde" color={colors.danger} />}
          title="Partido en el Centenario, título largo que ocupa dos líneas"
          placeName={null}
          startLabel="16:00"
          onDirections={noop}
          onLate={() => setLateOpen(true)}
        />
      </Section>

      <Section title="HeroTour · next">
        <HeroTour
          title="Ciudad Vieja a pie"
          when="next"
          startLabel="11:00"
          stopsCount={6}
          durationMin={95}
          distanceKm={2.4}
          stopNames={['Puerta de la Ciudadela', 'Plaza Matriz', 'Teatro Solís']}
          map={<Slot label="TourMiniMap" height={120} />}
          onStart={() => pulse(setStarting)}
          starting={starting}
        />
      </Section>
      <Section title="HeroTour · en curso, sin mapa">
        <HeroTour title="Rambla y Pocitos" when="current" stopsCount={3} durationMin={null} distanceKm={12} onStart={noop} />
      </Section>
      <Section title="HeroTour · error">
        <HeroTour
          title="Ciudad Vieja a pie"
          when="next"
          startLabel="11:00"
          stopsCount={1}
          durationMin={30}
          distanceKm={0.8}
          stopNames={['Plaza Independencia']}
          error="No pude arrancar el tour. Revisá la conexión."
          onStart={noop}
        />
      </Section>

      <Section title="HeroCurrent · con alertas y caras">
        <HeroCurrent
          title="Almuerzo en el Mercado del Puerto"
          placeName="Rambla 25 de Agosto 228"
          progress={0.62}
          remainingMin={30}
          endLabel="17:00"
          faces={<Slot label="GroupFaces" />}
          alerts={FIX_ALERTS}
          onTellMe={noop}
          onPress={noop}
        />
      </Section>
      <Section title="HeroCurrent · sin fin">
        <HeroCurrent title="Playa Pocitos" progress={null} remainingMin={null} onTellMe={noop} />
      </Section>

      <Section title="HeroFree · con sugerencias">
        <HeroFree
          gapMin={45}
          untilLabel="18:00"
          suggestions={FIX_SUGGESTIONS}
          addState={adds}
          onAdd={add}
          onSuggestionPress={noop}
          onPlanDay={() => pulse(setPlanning)}
          planning={planning}
          onNearbyTour={noop}
        />
      </Section>
      <Section title="HeroFree · cargando">
        <HeroFree gapMin={90} untilLabel="19:30" suggestions={[]} loading onAdd={noop} onPlanDay={noop} onNearbyTour={noop} />
      </Section>
      <Section title="HeroFree · vacío (tarde libre)">
        <HeroFree gapMin={null} suggestions={[]} onAdd={noop} onPlanDay={noop} onNearbyTour={noop} />
      </Section>

      <Section title="HeroState · before + PreviewChip">
        <PreviewChip onExit={noop} />
        <HeroState state="before" daysUntil={12} onPreviewDay1={noop} onOpenPlan={noop} />
      </Section>
      <Section title="HeroState · after / noLegs / noDay">
        <HeroState state="after" onOpenPlan={noop} />
        <HeroState state="noLegs" onAddLeg={noop} />
        <HeroState state="noDay" onOpenPlan={noop} />
      </Section>

      <Section title="NextRow">
        <NextRow time="18:00" title="Llamada de laburo" trailing="Salí en 1 h 10" onPress={noop} />
        <NextRow time={null} title="Cena (sin hora)" onPress={noop} />
      </Section>

      <Section title="LateSheet">
        <Button label="Abrir Voy tarde" variant="secondary" onPress={() => setLateOpen(true)} />
      </Section>

      <Section title="DockV2 · estados">
        {(['idle', 'connecting', 'listening', 'speaking', 'error'] as ScoutState[]).map((s) => (
          <DockFrame key={s}>
            <DockV2
              scoutState={s}
              onTalk={noop}
              onNearbyTour={noop}
              tourAvailable={s !== 'error'}
              onCamera={noop}
              onDirections={s === 'speaking' ? null : noop}
            />
          </DockFrame>
        ))}
        <DockFrame>
          <DockV2
            scoutState="idle"
            onTalk={noop}
            onNearbyTour={noop}
            tourAvailable
            onCamera={noop}
            onDirections={noop}
            tiles={
              <>
                <DockIcon label="Saltar parada" onPress={noop} icon={<FlagIcon color={colors.text} size={22} />} />
                <DockIcon label="Terminar" onPress={noop} icon={<FlagIcon color={colors.danger} size={22} />} />
              </>
            }
          />
        </DockFrame>
      </Section>

      <LateSheet
        visible={lateOpen}
        blockTitle="Museo Torres García"
        lateByMin={8}
        onNotify={doNotify}
        notifying={notify === 'busy'}
        notified={notify === 'done'}
        onShift={() => setLateOpen(false)}
        onDirections={() => setLateOpen(false)}
        onClose={() => {
          setLateOpen(false);
          setNotify('idle');
        }}
      />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** El dock es absoluto: le damos un marco con alto fijo. */
function DockFrame({ children }: { children: ReactNode }) {
  return <View style={styles.dockFrame}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { padding: space.lg, gap: space.xl, backgroundColor: colors.bg, paddingBottom: 80 },
  section: { gap: space.md },
  sectionTitle: { fontSize: font.tiny, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  slot: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotText: { fontSize: font.tiny, color: colors.textMuted },
  countdown: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dockFrame: { height: 150, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg },
});
