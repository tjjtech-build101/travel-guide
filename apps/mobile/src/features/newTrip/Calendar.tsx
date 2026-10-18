// Calendario de "Nuevo viaje" (PRD 31) como hoja de abajo (Modal de RN, como LateSheet): grilla del mes con la semana
// arrancando el lunes, flechas de mes, tocar "octubre 2027" abre años (actual a +3) y meses; días pasados apagados,
// hoy marcado. Rango opcional: primer toque = llegada, segundo = salida ("N días"). "Listo" devuelve lo elegido.
// La lógica de fechas es pura y vive en calendarModel.ts.
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import {
  canShift,
  initialView,
  inRange,
  isMonthPast,
  isPast,
  MONTH_NAMES,
  MONTH_SHORT,
  monthGrid,
  monthTitle,
  pickYear,
  rangeSummary,
  shiftMonth,
  spokenDay,
  tapDay,
  todayIso,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  yearOptions,
  type DateRange,
  type MonthView,
} from './calendarModel';

type Mode = 'days' | 'years' | 'months';

export function CalendarSheet({
  visible,
  title = '¿Cuándo pensás ir?',
  value,
  onClose,
  onDone,
}: {
  visible: boolean;
  title?: string;
  value: DateRange;
  onClose: () => void;
  /** start null = borró la fecha. */
  onDone: (range: DateRange) => void;
}) {
  const insets = useSafeAreaInsets();
  const today = todayIso();
  const [sel, setSel] = useState<DateRange>(value);
  const [view, setView] = useState<MonthView>(() => initialView(value, today));
  const [mode, setMode] = useState<Mode>('days');

  // Cada vez que se abre arranca de lo que ya estaba elegido.
  useEffect(() => {
    if (!visible) return;
    setSel(value);
    setView(initialView(value, today));
    setMode('days');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const weeks = useMemo(() => monthGrid(view.y, view.m), [view]);
  const years = yearOptions(today);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar calendario" />
        <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>

          <View style={styles.nav}>
            <Arrow dir={-1} disabled={mode !== 'days' || !canShift(view, -1, today)} onPress={() => setView((v) => shiftMonth(v, -1))} />
            <Pressable
              onPress={() => setMode((m) => (m === 'days' ? 'years' : 'days'))}
              accessibilityRole="button"
              accessibilityLabel={`${monthTitle(view)}. Cambiar mes y año`}
              accessibilityState={{ expanded: mode !== 'days' }}
              hitSlop={8}
              style={({ pressed }) => [styles.monthBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.monthText}>{monthTitle(view)}</Text>
              <Text style={styles.caret}>{mode === 'days' ? '▾' : '▴'}</Text>
            </Pressable>
            <Arrow dir={1} disabled={mode !== 'days' || !canShift(view, 1, today)} onPress={() => setView((v) => shiftMonth(v, 1))} />
          </View>

          {mode === 'years' ? (
            <View style={styles.pickGrid}>
              <Text style={styles.pickHint}>Elegí el año</Text>
              <View style={styles.pickRow}>
                {years.map((y) => (
                  <PickCell
                    key={y}
                    label={String(y)}
                    selected={y === view.y}
                    onPress={() => {
                      setView((v) => pickYear(v, y, today));
                      setMode('months');
                    }}
                  />
                ))}
              </View>
            </View>
          ) : mode === 'months' ? (
            <View style={styles.pickGrid}>
              <Text style={styles.pickHint}>Elegí el mes de {view.y}</Text>
              <View style={styles.pickRow}>
                {MONTH_SHORT.map((label, m) => {
                  const past = isMonthPast({ y: view.y, m }, today);
                  return (
                    <PickCell
                      key={label}
                      label={label}
                      accessibilityLabel={`${MONTH_NAMES[m]} ${view.y}`}
                      selected={m === view.m}
                      disabled={past}
                      onPress={() => {
                        setView({ y: view.y, m });
                        setMode('days');
                      }}
                    />
                  );
                })}
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.week}>
                {WEEKDAY_SHORT.map((d, i) => (
                  <Text key={d} style={styles.weekday} accessibilityLabel={WEEKDAY_LONG[i]}>
                    {d}
                  </Text>
                ))}
              </View>
              {weeks.map((w, wi) => (
                <View key={wi} style={styles.week}>
                  {w.map((iso, di) =>
                    iso ? (
                      <Day
                        key={iso}
                        iso={iso}
                        today={iso === today}
                        disabled={isPast(iso, today)}
                        edge={iso === sel.start ? 'start' : iso === sel.end ? 'end' : null}
                        between={inRange(iso, sel)}
                        bridge={!!sel.end}
                        onPress={() => setSel((s) => tapDay(s, iso))}
                      />
                    ) : (
                      <View key={`e${di}`} style={styles.cell} />
                    ),
                  )}
                </View>
              ))}
            </View>
          )}

          <Text style={styles.summary} accessibilityLiveRegion="polite">
            {rangeSummary(sel, today)}
          </Text>
          <View style={styles.actions}>
            <Button
              label="Borrar"
              variant="secondary"
              onPress={() => setSel({ start: null, end: null })}
              disabled={!sel.start}
              style={styles.flex}
            />
            <Button
              label="Listo"
              onPress={() => onDone(sel)}
              style={styles.flex}
              accessibilityHint={sel.start ? rangeSummary(sel, today) : 'Sigue sin fecha'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Arrow({ dir, disabled, onPress }: { dir: 1 | -1; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? 'Mes anterior' : 'Mes siguiente'}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.arrow, disabled && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.arrowText}>{dir < 0 ? '‹' : '›'}</Text>
    </Pressable>
  );
}

function Day({
  iso,
  today,
  disabled,
  edge,
  between,
  bridge,
  onPress,
}: {
  iso: string;
  today: boolean;
  disabled: boolean;
  edge: 'start' | 'end' | null;
  between: boolean;
  /** Hay salida: la llegada y la salida se unen con la franja del medio. */
  bridge: boolean;
  onPress: () => void;
}) {
  const n = Number(iso.slice(8));
  const label = `${spokenDay(iso)}${today ? ', hoy' : ''}${edge === 'start' ? ', llegada' : edge === 'end' ? ', salida' : ''}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: !!edge || between }}
      style={[styles.cell, between && styles.between, bridge && edge === 'start' && styles.betweenStart, bridge && edge === 'end' && styles.betweenEnd]}
    >
      {({ pressed }) => (
        <View style={[styles.dayInner, today && styles.today, edge && styles.edge, pressed && !edge && styles.pressed]}>
          <Text style={[styles.dayText, disabled && styles.dayPast, edge && styles.edgeText]}>{n}</Text>
        </View>
      )}
    </Pressable>
  );
}

function PickCell({
  label,
  selected,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [styles.pick, selected && styles.pickOn, disabled && { opacity: 0.3 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.pickText, selected && styles.pickTextOn]}>{label}</Text>
    </Pressable>
  );
}

const CELL = 44;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(42,30,23,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.xs },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  arrowText: { fontSize: 30, lineHeight: 34, color: colors.primary, fontWeight: '600' },
  monthBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH, paddingHorizontal: space.md },
  monthText: { fontSize: font.body, fontWeight: '800', color: colors.text },
  caret: { fontSize: font.small, color: colors.primary },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: font.tiny, fontWeight: '700', color: colors.textMuted, paddingVertical: space.xs },
  cell: { flex: 1, height: CELL, alignItems: 'center', justifyContent: 'center', marginVertical: 1 },
  between: { backgroundColor: colors.khakiLight },
  betweenStart: { backgroundColor: colors.khakiLight, borderTopLeftRadius: CELL / 2, borderBottomLeftRadius: CELL / 2 },
  betweenEnd: { backgroundColor: colors.khakiLight, borderTopRightRadius: CELL / 2, borderBottomRightRadius: CELL / 2 },
  dayInner: { width: CELL - 4, height: CELL - 4, borderRadius: (CELL - 4) / 2, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.bronze },
  edge: { backgroundColor: colors.primary },
  pressed: { backgroundColor: colors.surfaceMuted },
  dayText: { fontSize: font.body, fontWeight: '600', color: colors.text },
  dayPast: { color: colors.masked, opacity: 0.5 },
  edgeText: { color: colors.primaryText, fontWeight: '800' },
  pickGrid: { gap: space.sm, minHeight: 6 * CELL },
  pickHint: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pick: {
    width: '30%',
    flexGrow: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  pickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  pickTextOn: { color: colors.primaryText },
  summary: { fontSize: font.small, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: space.xs },
  actions: { flexDirection: 'row', gap: space.sm },
});
