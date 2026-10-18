// Hoja "Tour acá, ahora" con las dos formas de armar un tour:
//  · Rápido: lo mínimo (cuánto tiempo + "algo en especial", opcional) y se arma ya; en el tour se ajusta con el Scout
//    (saltear, seguir, contar más).
//  · Detallado: abre "Nuevo tour" (entrevista con repreguntas + recorridos para elegir), como el planificador de viajes.
import { SCOUT } from '@build101/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../ui/Button';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { NEARBY_DURATIONS, startNearbyTour } from './nearbyTour';

const durationLabel = (m: number) => (m === 60 ? '1 hora' : m === 90 ? '1 h 30' : m === 120 ? '2 horas' : `${m} min`);

export function TourSetupSheet({
  visible,
  here,
  tripId,
  onClose,
}: {
  visible: boolean;
  here: { lat: number; lng: number } | null;
  tripId?: string;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState<number>(60);
  const [wish, setWish] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const quick = async () => {
    if (!here) return;
    setSubmitting(true);
    setError(null);
    // El texto libre va como pedido: el generador saca de ahí lugares que no te querés perder, temas y qué evitar.
    const res = await startNearbyTour({ lat: here.lat, lng: here.lng, trip_id: tripId, duration_min: duration, ...(wish.trim() ? { notes: wish.trim().slice(0, 500) } : {}) });
    setSubmitting(false);
    if (res.ok) {
      setWish('');
      onClose();
    } else setError(res.message);
  };

  const detailed = () => {
    onClose();
    router.push({ pathname: '/tours/new', params: { ...(tripId ? { tripId } : {}), ...(here ? { lat: String(here.lat), lng: String(here.lng) } : {}) } });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.head}>
          <ScoutAvatar size={44} state="idle" />
          <View style={styles.flex}>
            <Text style={styles.kicker}>TOUR ACÁ, AHORA</Text>
            <Text style={styles.title}>¿Cómo lo armamos?</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.option}>
            <Text style={styles.optionTitle}>Rápido</Text>
            <Text style={styles.optionText}>Te lo armo ya con lo mínimo. Durante el tour lo ajustamos sobre la marcha: salteamos, seguimos o te cuento más.</Text>
            <Text style={styles.section}>¿Cuánto tiempo tenés?</Text>
            <View style={styles.chips}>
              {NEARBY_DURATIONS.map((m) => (
                <Chip key={m} label={durationLabel(m)} selected={duration === m} onPress={() => setDuration(m)} />
              ))}
            </View>
            <Text style={styles.section}>¿Algo en especial? (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Un lugar que no te quieras perder, un tema, con quién vas…"
              placeholderTextColor={colors.textMuted}
              value={wish}
              onChangeText={setWish}
              multiline
              maxLength={500}
              accessibilityLabel="Algo en especial para el tour"
            />
            <Button label={`Armar tour rápido de ${durationLabel(duration)}`} onPress={() => void quick()} loading={submitting} disabled={!here || submitting} />
          </View>

          <View style={[styles.option, styles.optionAlt]}>
            <Text style={styles.optionTitle}>Detallado</Text>
            <Text style={styles.optionText}>
              {SCOUT.name} te hace unas preguntas (y repreguntas) para entender qué querés, y te muestra 2 o 3 recorridos posibles para que elijas.
            </Text>
            <Button label="Armar uno detallado" variant="secondary" onPress={detailed} disabled={!here} />
          </View>

          {!here ? <Text style={styles.muted}>Necesito tu ubicación para armar el tour desde donde estás.</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Cancelar" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingBottom: space.sm },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.scout },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  option: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.scout, padding: space.lg, gap: space.sm },
  optionAlt: { borderColor: colors.border },
  optionTitle: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  optionText: { fontSize: font.small, color: colors.textMuted },
  section: { fontSize: font.body, fontWeight: '700', color: colors.text, marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    minHeight: MIN_TOUCH * 1.5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    padding: space.md,
    fontSize: font.body,
    color: colors.text,
    textAlignVertical: 'top',
  },
  muted: { fontSize: font.small, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
});
