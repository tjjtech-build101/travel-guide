import { Redirect, router, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../features/auth/AuthProvider';
import { colors, font } from '../../ui/theme';

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

export default function AppLayout() {
  const { session } = useAuth();
  // Sin sesión → login (también al cerrar sesión).
  if (!session) return <Redirect href="/login" />;
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
        options={{ title: 'Mis viajes', headerTitle: () => <DevTitle>Mis viajes</DevTitle> }}
      />
      {/* El shell del viaje dibuja su propio header (título del viaje) desde las tabs. */}
      <Stack.Screen name="trip/[tripId]" options={{ headerShown: false }} />
      <Stack.Screen name="dev" options={{ presentation: 'modal', title: 'Menú dev' }} />
      <Stack.Screen name="dev-record" options={{ presentation: 'modal', title: 'Grabar track' }} />
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
});
