// Pestaña Tours (PRD 06/18): lista los tours generados para este viaje. Reemplaza al placeholder fijo
// apenas haya alguno; "Empezar" arranca el mismo motor que ya usa "Ahora" (useTourStore), no uno nuevo.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { supabase } from '../../lib/supabase';
import { useTourStore } from '../../tour/store';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { ToursPlaceholder } from './sections';

type TourRow = { id: string; title: string | null; status: string; mode: string; duration_min: number | null };

export function ToursTab({ tripId }: { tripId: string }) {
  const [tours, setTours] = useState<TourRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase
      .from('tours')
      .select('id,title,status,mode,duration_min')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (alive) setTours((data as TourRow[] | null) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [tripId]);

  if (tours === null) return null; // evita parpadeo del placeholder mientras carga
  if (tours.length === 0) return <ToursPlaceholder />;

  const onStart = async (tourId: string) => {
    const ok = await useTourStore.getState().start({ tourId, tripId, participants: [] });
    if (ok) router.push(`/trip/${tripId}/now`);
  };

  return (
    <View style={styles.list}>
      {tours.map((t) => (
        <View key={t.id} style={styles.card}>
          <Text style={styles.title}>{t.title ?? 'Tour sin título'}</Text>
          <Text style={styles.meta}>
            {t.status === 'ready' ? 'Listo' : t.status === 'generating' ? 'Armándose…' : t.status === 'failed' ? 'No se pudo armar' : t.status}
            {t.duration_min ? ` · ${t.duration_min} min` : ''}
          </Text>
          {t.status === 'ready' ? <Button label="Empezar" onPress={() => void onStart(t.id)} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  title: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
});
