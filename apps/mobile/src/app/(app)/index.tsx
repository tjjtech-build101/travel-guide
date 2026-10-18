// Inicio: saludo, el viaje que importa hoy (en curso → qué toca ahora; si no, cuenta regresiva al próximo),
// accesos rápidos y todos los viajes separados en próximos y anteriores.
// Long-press en el saludo abre el menú dev (también build101:///dev).
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../features/auth/AuthProvider';
import {
  HeroLive,
  HeroSkeleton,
  HeroUpcoming,
  HeroWelcome,
  QuickAction,
  SectionHeader,
  TripRow,
} from '../../features/home/components';
import { firstName, greeting, splitTrips } from '../../features/home/selectors';
import { GuideTarget, useGuide } from '../../features/guide/useGuide';
import { useNow } from '../../features/now/clock';
import { PlusIcon } from '../../features/plan/components/TypeIcon';
import { useMyProfile } from '../../features/profile/queries';
import { tripKeys } from '../../features/trips/keys';
import { useMyTrips } from '../../features/trips/queries';
import { formatDay } from '../../lib/format';
import { localParts } from '../../features/now/selectors';
import { Avatar } from '../../ui/Avatar';
import { GroupIcon, PlanIcon } from '../../ui/icons';
import { ErrorState, SkeletonCard } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, space } from '../../ui/theme';

const PAST_PREVIEW = 3;

function openNewTrip() {
  router.push('/trips/new');
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const trips = useMyTrips();
  const { now } = useNow();
  const [showAllPast, setShowAllPast] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Primera vez: el Scout se presenta y muestra dónde está cada cosa.
  useGuide('welcome', !trips.isPending);

  const onRefresh = async () => {
    setRefreshing(true);
    // Mis viajes + lo que muestra el héroe (plan, bloques, propuestas).
    await Promise.all([trips.refetch(), qc.invalidateQueries({ queryKey: ['trip'] })]).catch(() => {});
    setRefreshing(false);
  };

  const split = trips.data ? splitTrips(trips.data, now) : null;
  const hero = split?.live[0] ?? split?.upcoming[0] ?? null;
  const restLive = split ? split.live.filter((t) => t.id !== hero?.id) : [];
  const restUpcoming = split ? split.upcoming.filter((t) => t.id !== hero?.id) : [];
  const past = split?.past ?? [];
  const shownPast = showAllPast ? past : past.slice(0, PAST_PREVIEW);
  const hasOthers = restLive.length + restUpcoming.length > 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Greeting now={now} />

      {trips.isPending ? (
        <View style={{ gap: space.md }}>
          <HeroSkeleton />
          <SkeletonCard />
        </View>
      ) : trips.isError ? (
        <View style={styles.error}>
          <ErrorState message="No pudimos cargar tus viajes" error={trips.error} doing="cargar tus viajes" onRetry={() => trips.refetch()} />
        </View>
      ) : (
        <>
          <GuideTarget id="home.hero">
            {hero && split?.live[0]?.id === hero.id ? (
              <HeroLive trip={hero} now={now} />
            ) : hero ? (
              <HeroUpcoming trip={hero} now={now} />
            ) : (
              <HeroWelcome onNewTrip={openNewTrip} />
            )}
          </GuideTarget>

          <View style={styles.quickRow}>
            <GuideTarget id="home.newTrip" style={styles.quickTarget}>
              <QuickAction label="Nuevo viaje" hint="Armalo con el Scout" icon={<PlusIcon color={colors.khakiText} size={20} />} onPress={openNewTrip} />
            </GuideTarget>
            {/* PRD 04 (Unirme con código) */}
            <QuickAction label="Unirme con código" hint="Al viaje de tu grupo" icon={<GroupIcon color={colors.khakiText} size={20} />} soon />
            <QuickAction label="Tus gustos" hint="Para tus tours" icon={<PlanIcon color={colors.khakiText} size={20} />} onPress={() => router.push('/profile')} />
          </View>

          {hasOthers ? (
            <>
              <SectionHeader title={hero ? 'También por delante' : 'Próximos'} />
              <View style={styles.list}>
                {restLive.map((t) => (
                  <TripRow key={t.id} trip={t} now={now} kind="live" />
                ))}
                {restUpcoming.map((t) => (
                  <TripRow key={t.id} trip={t} now={now} kind="upcoming" />
                ))}
              </View>
            </>
          ) : null}

          {past.length ? (
            <>
              <SectionHeader
                title="Viajes anteriores"
                right={
                  past.length > PAST_PREVIEW ? (
                    <Pressable onPress={() => setShowAllPast((v) => !v)} hitSlop={12} accessibilityRole="button">
                      <Text style={styles.link}>{showAllPast ? 'Ver menos' : `Ver los ${past.length}`}</Text>
                    </Pressable>
                  ) : null
                }
              />
              <View style={styles.list}>
                {shownPast.map((t) => (
                  <TripRow key={t.id} trip={t} now={now} kind="past" />
                ))}
              </View>
            </>
          ) : null}

          {trips.data.length === 0 ? (
            <Text style={styles.footnote}>Todavía no tenés viajes. Cuando armes uno, o te sumes al de tu grupo, aparece acá.</Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function Greeting({ now }: { now: number }) {
  const { session } = useAuth();
  const profile = useMyProfile();
  const name = firstName(profile.data?.display_name ?? (session?.user.user_metadata?.full_name as string | undefined));
  const person = {
    id: session?.user.id ?? 'yo',
    display_name: profile.data?.display_name ?? null,
    avatar_url: profile.data?.avatar_url ?? null,
  };
  const today = formatDay(localParts(now, -180).date);
  return (
    <View style={styles.greeting}>
      <Pressable onLongPress={() => router.push('/dev')} delayLongPress={600} style={{ flex: 1 }} accessibilityRole="header">
        <Text style={styles.date}>{today.charAt(0).toUpperCase() + today.slice(1)}</Text>
        <Text style={styles.hello} numberOfLines={1}>
          {greeting(now)}
          {name ? `, ${name}` : ''}
        </Text>
      </Pressable>
      <GuideTarget id="home.profile">
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Tu perfil"
          hitSlop={8}
          style={styles.avatarBtn}
        >
          <Avatar person={person} size={44} />
        </Pressable>
      </GuideTarget>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg },
  greeting: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, gap: space.md },
  date: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  hello: { fontSize: font.title, fontWeight: '700', color: colors.text },
  avatarBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'flex-end', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  quickTarget: { flex: 1, flexDirection: 'row' },
  list: { gap: space.sm },
  link: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  error: { minHeight: 360 },
  footnote: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', marginTop: space.xl, paddingHorizontal: space.lg },
});
