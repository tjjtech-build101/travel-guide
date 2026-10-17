import { Redirect, router, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { useAuth } from '../../features/auth/AuthProvider';
import { needsOnboarding } from '../../features/profile/model';
import { useMyProfile, useOnboardingSkip } from '../../features/profile/queries';
import { Avatar } from '../../ui/Avatar';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH } from '../../ui/theme';

function openDevMenu() {
  router.push('/dev');
}

/** Título del header: long-press abre el menú dev (oculto; también build101:///dev). */
function DevTitle({ children }: { children: string }) {
  return (
    <Pressable onLongPress={openDevMenu} delayLongPress={600} hitSlop={12} accessibilityRole="header">
      <Text style={styles.title}>{children}</Text>
    </Pressable>
  );
}

/** Botón del header de Mis viajes → Perfil. */
function ProfileButton() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const person = {
    id: session?.user.id ?? 'yo',
    display_name: profile.data?.display_name ?? (session?.user.user_metadata?.full_name as string | undefined) ?? null,
    avatar_url: profile.data?.avatar_url ?? null,
  };
  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Tu perfil"
      hitSlop={8}
      style={styles.profileBtn}
    >
      <Avatar person={person} size={34} />
    </Pressable>
  );
}

/** PRD 10: si profiles.onboarded_at es null, abre el onboarding (salvo "Ahora no" en esta sesión). */
function useOnboardingGate() {
  const profile = useMyProfile();
  const skipped = useOnboardingSkip((s) => s.skipped);
  const segments = useSegments() as string[];
  const inOnboarding = segments.includes('onboarding');
  const pending = needsOnboarding(profile.data);
  useEffect(() => {
    if (pending && !skipped && !inOnboarding) router.push('/onboarding');
  }, [pending, skipped, inOnboarding]);
}

export default function AppLayout() {
  const { session } = useAuth();
  // Sin sesión → login (también al cerrar sesión).
  if (!session) return <Redirect href="/login" />;
  return <AppStack />;
}

function AppStack() {
  useOnboardingGate();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.bg },
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Mis viajes',
          headerTitle: () => <DevTitle>Mis viajes</DevTitle>,
          headerRight: () => <ProfileButton />,
        }}
      />
      {/* El shell del viaje dibuja su propio header (título del viaje) desde las tabs. */}
      <Stack.Screen name="trip/[tripId]" options={{ headerShown: false }} />
      <Stack.Screen name="dev" options={{ presentation: 'modal', title: 'Menú dev' }} />
      <Stack.Screen name="dev-record" options={{ presentation: 'modal', title: 'Grabar track' }} />
      <Stack.Screen name="dev/now-gallery" options={{ title: 'Galería de Ahora', headerBackTitle: 'Atrás' }} />
      {/* PRD 10 mínimo: onboarding con chips (primer login) y perfil editable. */}
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="profile" options={{ title: 'Tu perfil', headerBackTitle: 'Atrás' }} />
      {/* Grupo: acceso secundario desde el "⋯" de Planificación (multiplayer fuera del MVP). */}
      <Stack.Screen name="group/[tripId]" options={{ title: 'Grupo y actividad', headerBackTitle: 'Viaje' }} />
      {/* PRD 02 · sheets del Plan (detalle/edición, crear, propuestas, traer del banco). */}
      <Stack.Screen name="plan/block/[blockId]" options={PLAN_SHEET} />
      <Stack.Screen name="plan/new" options={PLAN_SHEET} />
      <Stack.Screen name="plan/proposals" options={PLAN_SHEET} />
      <Stack.Screen name="plan/bank" options={PLAN_SHEET} />
    </Stack>
  );
}

/** Bottom sheet nativo al 60 %, expandible (PRD 02). */
const PLAN_SHEET = {
  presentation: 'formSheet' as const,
  headerShown: false,
  sheetAllowedDetents: [0.6, 1] as number[],
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 20,
  contentStyle: { backgroundColor: colors.surface },
};

const styles = StyleSheet.create({
  title: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  profileBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
