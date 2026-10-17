import { router, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { errorDetail, useTrip } from '../../../../features/trips/queries';
import { TripIdProvider } from '../../../../features/trips/TripContext';
import { FEATURES } from '../../../../lib/features';
import { useTripRealtime } from '../../../../realtime/useTripRealtime';
import { ScheduleWatcher } from '../../../../schedule/ScheduleWatcher';
import { Button } from '../../../../ui/Button';
import { Text } from '../../../../ui/Text';
import { BackIcon, BookIcon, MapIcon, MoneyIcon, NowIcon, PlanIcon } from '../../../../ui/icons';
import { ErrorState, Skeleton } from '../../../../ui/States';
import { colors, font, fonts, MIN_TOUCH, space } from '../../../../ui/theme';
import { VoiceSlot } from '../../../../voice/VoiceSlot';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function TripLayout() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const trip = useTrip(tripId);

  if (trip.isPending) return <HeaderSkeleton />;

  if (trip.isError) {
    return (
      <SafeAreaView style={styles.flex}>
        <ErrorState message="No pudimos cargar el viaje" detail={errorDetail(trip.error)} onRetry={() => trip.refetch()} />
        <Button label="Volver" variant="ghost" onPress={goBack} style={styles.back} />
      </SafeAreaView>
    );
  }

  if (!trip.data) {
    return (
      <SafeAreaView style={[styles.flex, styles.center]}>
        <Text style={styles.noAccess}>No tenés acceso a este viaje</Text>
        <Button label="Volver" onPress={goBack} style={styles.back} />
      </SafeAreaView>
    );
  }

  return <TripShell tripId={tripId} title={trip.data.title} />;
}

function TripShell({ tripId, title }: { tripId: string; title: string }) {
  useTripRealtime(tripId);

  return (
    <TripIdProvider tripId={tripId}>
      <View style={styles.flex}>
        <Tabs
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTitleAlign: 'center',
            headerTitle: () => (
              <Pressable onLongPress={() => router.push('/dev')} /* menú dev oculto */ delayLongPress={600} hitSlop={12} accessibilityRole="header">
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {title}
                </Text>
              </Pressable>
            ),
            headerLeft: () => (
              <Pressable
                onPress={goBack}
                accessibilityRole="button"
                accessibilityLabel="Volver al inicio"
                style={styles.headerBtn}
              >
                <BackIcon color={colors.text} />
              </Pressable>
            ),
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: font.tiny, fontFamily: fonts.bodySemi },
            sceneStyle: { backgroundColor: colors.bg },
          }}
        >
          {/* 3 vistas del viaje (decisiones del sábado): Planificación · Mapa · Ahora. */}
          <Tabs.Screen name="index" options={{ title: 'Planificación', tabBarIcon: ({ color }) => <PlanIcon color={color} /> }} />
          <Tabs.Screen name="map" options={{ title: 'Mapa', tabBarIcon: ({ color }) => <MapIcon color={color} /> }} />
          <Tabs.Screen name="now" options={{ title: 'Ahora', tabBarIcon: ({ color }) => <NowIcon color={color} /> }} />
          {/* Menú colaborativo del tramo (PRD 31): pantalla del viaje fuera de la barra de tabs. */}
          <Tabs.Screen
            name="menu"
            options={{
              title: 'Menú',
              href: null,
              tabBarStyle: { display: 'none' },
              headerLeft: () => (
                <Pressable
                  onPress={() => router.navigate({ pathname: '/trip/[tripId]', params: { tripId } })}
                  accessibilityRole="button"
                  accessibilityLabel="Volver al plan"
                  style={styles.headerBtn}
                >
                  <BackIcon color={colors.text} />
                </Pressable>
              ),
            }}
          />
          {/* Grupo salió de las tabs (multiplayer fuera del MVP): ahora es /group/[tripId], desde el "⋯" de Planificación. */}
          <Tabs.Screen
            name="expenses"
            options={{
              title: 'Gastos',
              href: FEATURES.expenses ? undefined : null,
              tabBarIcon: ({ color }) => <MoneyIcon color={color} />,
            }}
          />
          <Tabs.Screen
            name="diary"
            options={{
              title: 'Diario',
              href: FEATURES.diary ? undefined : null,
              tabBarIcon: ({ color }) => <BookIcon color={color} />,
            }}
          />
        </Tabs>
        {/* Botón flotante de voz (PRD 05): global a todas las tabs del viaje. */}
        <VoiceSlot tripId={tripId} />
        {/* Vigilante de horarios: "salí ya / vas tarde / por empezar" (notificación local o el Scout en llamada). */}
        <ScheduleWatcher tripId={tripId} />
      </View>
    </TripIdProvider>
  );
}

function HeaderSkeleton() {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.skeletonHeader}>
        <Skeleton width={28} height={28} style={{ borderRadius: 14 }} />
        <Skeleton width="50%" height={22} />
        <View style={{ width: 28 }} />
      </View>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Skeleton height={20} width="40%" />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  noAccess: { fontSize: font.h3, fontWeight: '600', color: colors.text, textAlign: 'center' },
  back: { marginTop: space.lg, alignSelf: 'stretch', marginHorizontal: space.xl },
  headerTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, maxWidth: 260 },
  headerBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    height: 52,
  },
});
