import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { errorDetail, useMyTrips, type TripCard } from '../../features/trips/queries';
import { formatDateRange } from '../../lib/format';
import { AvatarStack } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, LoadingList } from '../../ui/States';
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
      <EmptyState title="Todavía no tenés viajes" subtitle="Armá uno nuevo o sumate al de tu grupo con el código de invitación.">
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
      renderItem={({ item }) => <TripCardView trip={item} />}
    />
  );
}

function TripCardView({ trip }: { trip: TripCard }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${trip.title}`}
      onPress={() => router.push({ pathname: '/trip/[tripId]', params: { tripId: trip.id } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.title}>{trip.title}</Text>
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
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  dates: { fontSize: font.body, color: colors.textMuted, marginTop: space.xs },
  destinations: { fontSize: font.body, color: colors.text, marginTop: space.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg },
  count: { fontSize: font.small, color: colors.textMuted },
});
