import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { queryClient } from '../lib/queryClient';
import { LocationContextProvider } from '../location/LocationContext';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { VoiceProvider } from '../voice/VoiceProvider';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocationContextProvider>
              <StatusBar style="dark" />
              <VoiceProvider>
                <RootNavigator />
              </VoiceProvider>
              <ConnectionBanner />
            </LocationContextProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Redirección por sesión: (app)/_layout manda al login si no hay sesión y (auth)/_layout manda a
  // Mis viajes si ya hay. (Stack.Protected no sirve acá: "/" vive dentro de (app) y sin sesión
  // queda una ruta sin match.)
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
});
