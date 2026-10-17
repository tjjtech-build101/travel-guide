// Variables públicas de la app. Expo inlinea process.env.EXPO_PUBLIC_* en el bundle:
// hay que accederlas con el nombre literal (nada de process.env[name]).

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
};

/** Variables obligatorias que faltan (para mostrar un aviso en dev en vez de romper). */
export function missingEnv(): string[] {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!env.apiUrl) missing.push('EXPO_PUBLIC_API_URL');
  return missing;
}
