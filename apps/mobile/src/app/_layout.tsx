import { Fredoka_500Medium } from '@expo-google-fonts/fredoka/500Medium';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka/600SemiBold';
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_500Medium } from '@expo-google-fonts/nunito-sans/500Medium';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { SimPill } from '../features/gps/SimPill';
import { queryClient } from '../lib/queryClient';
import { LocationContextProvider } from '../location/LocationContext';
// PRD 07: la task de ubicación en segundo plano se define al cargar el módulo (fuera de cualquier componente).
import '../tour/backgroundLocation';
import { TourRunner } from '../tour/TourRunner';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { VoiceProvider } from '../voice/VoiceProvider';
import { setFontsReady } from '../ui/Text';
import { colors, fonts } from '../ui/theme';

const FONT_FILES = {
  [fonts.displayMedium]: Fredoka_500Medium,
  [fonts.display]: Fredoka_600SemiBold,
  [fonts.body]: NunitoSans_400Regular,
  [fonts.bodyMedium]: NunitoSans_500Medium,
  [fonts.bodySemi]: NunitoSans_600SemiBold,
  [fonts.bodyBold]: NunitoSans_700Bold,
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocationContextProvider>
              <StatusBar style="dark" />
              <TourRunner />
              <VoiceProvider>
                <RootNavigator />
              </VoiceProvider>
              <ConnectionBanner />
              <SimPill />
            </LocationContextProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoading } = useAuth();
  // Si las fuentes fallan seguimos con la del sistema (ui/Text no aplica la familia).
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  setFontsReady(fontsLoaded);

  if (isLoading || (!fontsLoaded && !fontError)) {
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
