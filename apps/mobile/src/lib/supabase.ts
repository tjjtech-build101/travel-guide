import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from './env';

// AsyncStorage y no SecureStore: la sesión supera los 2048 bytes de SecureStore.
// Si falta la URL usamos una local para que la app abra y muestre el aviso de config en vez de crashear.
export const supabase = createClient(env.supabaseUrl || 'http://127.0.0.1:54321', env.supabaseAnonKey || 'missing-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// En RN el refresh automático solo corre con la app en primer plano (recomendación de Supabase).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

// Cada vez que cambia el token, Realtime tiene que usar el nuevo (si no, el canal cae a la hora).
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
    void supabase.realtime.setAuth(session?.access_token ?? null);
  }
});
