import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { DotsIcon } from '../../features/plan/components/TypeIcon';
import { confirm, showMenu } from '../../features/plan/menu';
import { appNow } from '../../features/now/clock';
import { isTripInProgress } from '../../features/now/selectors';
import { errorDetail, useMyTrips, type TripCard } from '../../features/trips/queries';
import { callTool } from '../../lib/api';
import { formatDateRange } from '../../lib/format';
import { AvatarStack } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, LoadingList } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';

function openNewTrip() {
  router.push('/trips/new');
}

export default function MyTripsScreen() {
  const trips = useMyTrips();

  if (trips.isPending) return <LoadingList count={3} />;

  if (trips.isError) {
    return <ErrorState message="No pudimos cargar tus viajes" detail={errorDetail(trips.error)} onRetry={() => trips.refetch()} />;
  }

  if (trips.data.length === 0) {
    return (
      <EmptyState pose="wave" title="Todavía no tenés viajes" subtitle="Armá uno nuevo o sumate al de tu grupo con el código de invitación.">
        {/* PRD 04 (Unirme con código) */}
        <Button label="Nuevo viaje" onPress={openNewTrip} />
        <Button label="Unirme con código" variant="secondary" disabled accessibilityHint="Próximamente" />
      </EmptyState>
    );
  }

  return (
    <FlashList
      data={trips.data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
      refreshing={trips.isRefetching}
      onRefresh={() => trips.refetch()}
      ListHeaderComponent={<Button label="Nuevo viaje" onPress={openNewTrip} style={styles.newTrip} />}
      renderItem={({ item }) => <TripCardView trip={item} onDeleted={() => void trips.refetch()} />}
    />
  );
}

function TripCardView({ trip, onDeleted }: { trip: TripCard; onDeleted: () => void }) {
  const onMenu = () => {
    showMenu(trip.title, [
      {
        label: 'Borrar viaje',
        destructive: true,
        onPress: () =>
          confirm(
            'Borrar viaje',
            `Se borra "${trip.title}" entero: tramos, días, bloques, tours, gastos. No se puede deshacer.`,
            'Borrar',
            () => {
              void (async () => {
                const res = await callTool('delete_trip', { trip_id: trip.id });
                if (res.ok) onDeleted();
                else Alert.alert('No pude borrar el viaje', res.error.message);
              })();
            },
          ),
      },
    ]);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${trip.title}`}
      // Viaje en curso → abre en Ahora (PRD 19); si no, en Planificación.
      onPress={() =>
        isTripInProgress(trip, appNow())
          ? router.push({ pathname: '/trip/[tripId]/now', params: { tripId: trip.id } })
          : router.push({ pathname: '/trip/[tripId]', params: { tripId: trip.id } })
      }
      onLongPress={onMenu}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{trip.title}</Text>
        <Pressable onPress={onMenu} accessibilityRole="button" accessibilityLabel={`Opciones de ${trip.title}`} hitSlop={8}>
          <DotsIcon color={colors.textMuted} />
        </Pressable>
      </View>
      <Text style={styles.dates}>{formatDateRange(trip.start_date, trip.end_date)}</Text>
      {trip.destinations.length > 0 ? (
        <Text style={styles.destinations} numberOfLines={2}>
          {trip.destinations.join(' · ')}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <AvatarStack people={trip.members} size={34} />
        <Text style={styles.count}>
          {trip.members.length} {trip.members.length === 1 ? 'viajero' : 'viajeros'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg },
  newTrip: { marginBottom: space.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text, flexShrink: 1 },
  dates: { fontSize: font.body, color: colors.textMuted, marginTop: space.xs },
  destinations: { fontSize: font.body, color: colors.text, marginTop: space.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg },
  count: { fontSize: font.small, color: colors.textMuted },
});
