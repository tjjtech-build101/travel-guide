// Solo __DEV__: cambiar de usuario de demo por deep link (pruebas en simulador sin tocar la pantalla).
//   build101://dev-login?as=sofi&to=/trip/<tripId>
import type { DEMO_USER_EMAILS } from '@build101/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { signInAsDemo } from '../features/auth/signIn';
import { supabase } from '../lib/supabase';
import { colors } from '../ui/theme';

export default function DevLogin() {
  const { as, to } = useLocalSearchParams<{ as?: string; to?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!__DEV__ || !as) return;
    let cancelled = false;
    (async () => {
      await supabase.auth.signOut();
      const res = await signInAsDemo(as as keyof typeof DEMO_USER_EMAILS);
      if (cancelled) return;
      if (!res.ok) return setError(`${res.code}: ${res.message}`);
      router.replace((to as never) ?? '/');
    })();
    return () => {
      cancelled = true;
    };
  }, [as, to]);

  if (!__DEV__) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : <ActivityIndicator />}
    </View>
  );
}
