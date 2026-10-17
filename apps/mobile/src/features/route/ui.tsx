// Piezas de la pantalla "Cómo llego": selector de modo, próxima indicación, pasos, transporte, "Abrir en" y llegada.
// Una mano: botones ≥ 48 pt, texto grande, poco ruido.
import type { RouteMode, RouteStepDetail } from '@build101/shared';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../ui/Button';
import {
  BusIcon,
  CarIcon,
  FlagIcon,
  RoundaboutIcon,
  SlightLeftIcon,
  SlightRightIcon,
  StraightIcon,
  TrainIcon,
  TurnLeftIcon,
  TurnRightIcon,
  UTurnIcon,
  WalkIcon,
} from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import {
  EXTERNAL_LABEL,
  externalApps,
  formatDistance,
  formatMin,
  maneuverKind,
  MODE_LABEL,
  rideDetail,
  rideTitle,
  ROUTE_MODE_ORDER,
  toPlace,
  voseo,
  type ExternalApp,
  type ManeuverKind,
  type NextInstruction,
  type TimelineItem,
} from './model';

type IconC = (p: { color: string; size?: number }) => React.JSX.Element;

const MANEUVER_ICON: Record<ManeuverKind, IconC> = {
  left: TurnLeftIcon,
  right: TurnRightIcon,
  slightLeft: SlightLeftIcon,
  slightRight: SlightRightIcon,
  uturn: UTurnIcon,
  straight: StraightIcon,
  roundabout: RoundaboutIcon,
  arrive: FlagIcon,
};

export const MODE_ICON: Record<RouteMode, IconC> = { walk: WalkIcon, transit: BusIcon, car: CarIcon };

// ───────── Selector de modo (segmented)

export type ModeEta = { min: number | null; loading: boolean; failed: boolean };

export function ModeSelector({ mode, etas, onChange }: { mode: RouteMode; etas: Record<RouteMode, ModeEta>; onChange: (m: RouteMode) => void }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {ROUTE_MODE_ORDER.map((m) => {
        const on = m === mode;
        const e = etas[m];
        const Icon = MODE_ICON[m];
        const time = e.min != null ? formatMin(e.min) : e.failed ? '—' : null;
        return (
          <Pressable
            key={m}
            onPress={() => onChange(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${MODE_LABEL[m]}${e.min != null ? `, ${formatMin(e.min)}` : ''}`}
            style={({ pressed }) => [styles.segBtn, on && styles.segOn, pressed && styles.pressed]}
          >
            <Icon color={on ? colors.primaryText : colors.text} size={20} />
            <View>
              <Text style={[styles.segLabel, on && styles.segLabelOn]} numberOfLines={1}>
                {MODE_LABEL[m]}
              </Text>
              {time ? (
                <Text style={[styles.segTime, on && styles.segLabelOn]}>{time}</Text>
              ) : (
                <ActivityIndicator size="small" color={on ? colors.primaryText : colors.textMuted} style={styles.segSpin} />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────── Próxima indicación

export function NextInstructionCard({ next }: { next: NextInstruction }) {
  const Icon = MANEUVER_ICON[next.kind];
  return (
    <View style={styles.nextCard} accessibilityRole="summary" accessibilityLiveRegion="polite" accessibilityLabel={next.text}>
      <View style={styles.nextIcon}>
        <Icon color={colors.primaryText} size={36} />
      </View>
      <Text style={styles.nextText}>{next.text}</Text>
    </View>
  );
}

export function StepsList({ steps, current }: { steps: RouteStepDetail[]; current: number }) {
  const [open, setOpen] = useState(false);
  // Un solo paso ya está en la tarjeta grande: la lista sería ruido.
  if (steps.length <= 1) return null;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Ocultar pasos' : `Ver los ${steps.length} pasos`}
        style={({ pressed }) => [styles.stepsToggle, pressed && styles.pressed]}
      >
        <Text style={styles.stepsToggleText}>{open ? 'Ocultar pasos' : `Ver pasos (${steps.length})`}</Text>
      </Pressable>
      {open
        ? steps.map((s, i) => {
            const Icon = MANEUVER_ICON[maneuverKind(s.maneuver, s.instruction)];
            const done = i < current;
            return (
              <View key={i} style={[styles.stepRow, done && styles.stepDone, i === current && styles.stepNow]}>
                <Icon color={done ? colors.textMuted : colors.text} size={22} />
                <Text style={[styles.stepText, done && styles.muted]}>{voseo(s.instruction || 'Seguí derecho')}</Text>
                {s.distance_m > 0 ? <Text style={styles.stepDist}>{formatDistance(s.distance_m)}</Text> : null}
              </View>
            );
          })
        : null}
    </View>
  );
}

// ───────── Transporte: línea de tiempo

export function TransitTimeline({ items, estimatedTimes }: { items: TimelineItem[]; estimatedTimes: boolean }) {
  return (
    <View style={styles.timeline}>
      {estimatedTimes ? <Text style={styles.honest}>Horarios estimados</Text> : null}
      {items.length === 0 ? (
        <Text style={styles.muted}>No encontramos líneas para este trayecto. Probá a pie o abrilo en otra app.</Text>
      ) : (
        items.map((it, i) => {
          const last = i === items.length - 1;
          if (it.kind === 'walk') {
            return (
              <TimelineRow key={i} icon={<WalkIcon color={colors.textMuted} size={22} />} last={last} dashed>
                <Text style={styles.tlTitle}>
                  Caminá {formatMin(it.min)}
                  {it.m > 0 ? ` · ${formatDistance(it.m)}` : ''}
                </Text>
                {it.to ? <Text style={styles.tlSub}>Hasta {it.to}</Text> : null}
              </TimelineRow>
            );
          }
          const Icon = it.vehicle === 'bus' || it.vehicle === 'other' ? BusIcon : TrainIcon;
          const detail = rideDetail(it);
          return (
            <TimelineRow key={i} icon={<Icon color={colors.primary} size={22} />} last={last}>
              <Text style={styles.tlTitle}>
                {rideTitle(it)}
                {it.min > 0 ? ` · ${formatMin(it.min)}` : ''}
              </Text>
              {detail ? <Text style={styles.tlSub}>{detail}</Text> : null}
              {it.to_stop ? <Text style={styles.tlSub}>Bajate en {it.to_stop}</Text> : null}
            </TimelineRow>
          );
        })
      )}
    </View>
  );
}

function TimelineRow({ icon, children, last, dashed }: { icon: React.ReactNode; children: React.ReactNode; last: boolean; dashed?: boolean }) {
  return (
    <View style={styles.tlRow}>
      <View style={styles.tlRail}>
        <View style={styles.tlDot}>{icon}</View>
        {!last ? <View style={[styles.tlLine, dashed && styles.tlLineDashed]} /> : null}
      </View>
      <View style={styles.tlBody}>{children}</View>
    </View>
  );
}

// ───────── Abrir en otra app

export function OpenInRow({ mode, onOpen }: { mode: RouteMode; onOpen: (app: ExternalApp) => void }) {
  const apps = externalApps(Platform.OS);
  return (
    <View style={[styles.openIn, mode === 'car' && styles.openInCar]}>
      {mode === 'car' ? (
        <Text style={styles.carplay}>¿Vas manejando? Abrilo y seguí en CarPlay</Text>
      ) : (
        <Text style={styles.openLabel}>Abrir en</Text>
      )}
      <View style={styles.openRow}>
        {apps.map((a) => (
          <Pressable
            key={a}
            onPress={() => onOpen(a)}
            accessibilityRole="link"
            accessibilityLabel={`Abrir en ${EXTERNAL_LABEL[a]}`}
            style={({ pressed }) => [styles.openBtn, pressed && styles.pressed]}
          >
            <Text style={styles.openBtnText} numberOfLines={1}>
              {EXTERNAL_LABEL[a]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ───────── Llegada

export function ArrivedCard({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <View style={styles.arrived} accessibilityLiveRegion="assertive">
      <FlagIcon color={colors.success} size={36} />
      <Text style={styles.arrivedTitle} accessibilityRole="header">
        Llegaste {toPlace(name)}
      </Text>
      <Button label="Listo" onPress={onDone} style={styles.arrivedBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  muted: { fontSize: font.small, color: colors.textMuted },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  segOn: { backgroundColor: colors.primary },
  segLabel: { fontSize: font.tiny, fontWeight: '600', color: colors.text },
  segLabelOn: { color: colors.primaryText },
  segTime: { fontSize: font.small, fontWeight: '700', color: colors.text },
  segSpin: { alignSelf: 'flex-start', transform: [{ scale: 0.7 }] },

  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  nextIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { flex: 1, fontSize: font.h2, fontWeight: '700', color: colors.primaryText },

  stepsToggle: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  stepsToggleText: { fontSize: font.body, fontWeight: '600', color: colors.primary },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stepDone: { opacity: 0.6 },
  stepNow: { backgroundColor: colors.khakiLight, borderRadius: radius.sm, paddingHorizontal: space.xs },
  stepText: { flex: 1, fontSize: font.body, color: colors.text },
  stepDist: { fontSize: font.small, color: colors.textMuted },

  timeline: { gap: 0 },
  honest: { fontSize: font.small, color: colors.bronzeText, fontWeight: '600', marginBottom: space.sm },
  tlRow: { flexDirection: 'row', gap: space.md, minHeight: 56 },
  tlRail: { width: 32, alignItems: 'center' },
  tlDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlLine: { flex: 1, width: 3, backgroundColor: colors.primary, marginVertical: 2, borderRadius: 2 },
  tlLineDashed: { backgroundColor: colors.border },
  tlBody: { flex: 1, paddingBottom: space.md, paddingTop: 4 },
  tlTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  tlSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },

  openIn: { gap: space.sm, paddingTop: space.sm },
  openInCar: { backgroundColor: colors.khakiLight, borderRadius: radius.md, padding: space.md },
  carplay: { fontSize: font.body, fontWeight: '700', color: colors.khakiText },
  openLabel: { fontSize: font.small, color: colors.textMuted, fontWeight: '600' },
  openRow: { flexDirection: 'row', gap: space.sm },
  openBtn: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  openBtnText: { fontSize: font.small, fontWeight: '700', color: colors.text },

  arrived: {
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.successBg,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  arrivedTitle: { fontSize: font.h2, fontWeight: '700', color: colors.text, textAlign: 'center' },
  arrivedBtn: { alignSelf: 'stretch' },
});
