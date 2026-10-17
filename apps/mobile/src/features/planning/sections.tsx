// Vista Planificación (decisiones del sábado): pestañas internas Itinerario · Eventos · Tours · Gastos.
// Itinerario es el Plan del PRD 02. Eventos (PRD 16) y Tours (PRD 06/18) son placeholders con estado vacío
// claro hasta que lleguen sus PRDs. Gastos (PRD 23) queda oculto detrás de FEATURES.expenses.
import { SCOUT } from '@build101/shared';
import { StyleSheet, Text, View } from 'react-native';

import { FEATURES } from '../../lib/features';
import { colors, font, radius, space } from '../../ui/theme';
import { Segmented } from '../plan/components/Controls';

export type PlanningSection = 'itinerary' | 'events' | 'tours' | 'expenses';

export function planningSections(features: { expenses: boolean } = FEATURES): { value: PlanningSection; label: string }[] {
  return [
    { value: 'itinerary', label: 'Itinerario' },
    { value: 'events', label: 'Eventos' },
    { value: 'tours', label: 'Tours' },
    ...(features.expenses ? [{ value: 'expenses' as const, label: 'Gastos' }] : []),
  ];
}

/** Lee `?section=` del deep link; cualquier valor desconocido (o Gastos sin flag) cae en Itinerario. */
export function parseSection(raw: string | undefined, features: { expenses: boolean } = FEATURES): PlanningSection {
  const allowed = planningSections(features).map((s) => s.value);
  return allowed.includes(raw as PlanningSection) ? (raw as PlanningSection) : 'itinerary';
}

export function PlanningSectionBar({ value, onChange }: { value: PlanningSection; onChange: (v: PlanningSection) => void }) {
  return (
    <View style={styles.bar}>
      <Segmented options={planningSections()} value={value} onChange={onChange} />
    </View>
  );
}

function Placeholder({ title, body, foot }: { title: string; body: string; foot: string }) {
  return (
    <View style={styles.center}>
      <View style={styles.card}>
        <Text style={styles.soon}>Muy pronto</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Text style={styles.foot}>{foot}</Text>
      </View>
    </View>
  );
}

export function EventsPlaceholder() {
  return (
    <Placeholder
      title="Eventos para tu viaje"
      body={`${SCOUT.name} va a buscar recitales, ferias y muestras de las fechas y ciudades del viaje, según lo que te gusta.`}
      foot="Todavía no hay eventos recomendados."
    />
  );
}

export function ToursPlaceholder() {
  return (
    <Placeholder
      title="Tus tours"
      body={`Acá van a aparecer los tours que te arme ${SCOUT.name}, con paradas verificadas y sus fuentes. Mientras tanto, pedí uno desde Ahora con "Tour acá, ahora".`}
      foot="Todavía no tenés tours armados."
    />
  );
}

export function ExpensesPlaceholder() {
  return (
    <Placeholder
      title="Gastos"
      body="Anotá y dividí los gastos del viaje."
      foot="Todavía no hay gastos."
    />
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: colors.bg },
  center: { flex: 1, padding: space.lg, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.sm,
  },
  soon: {
    alignSelf: 'flex-start',
    fontSize: font.tiny,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: '#E3ECFB',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  body: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  foot: { fontSize: font.small, color: colors.textMuted, marginTop: space.sm },
});
