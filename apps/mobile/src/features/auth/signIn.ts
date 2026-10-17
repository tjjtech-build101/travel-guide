import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { DEMO_PASSWORD, DEMO_USER_EMAILS } from '@build101/shared';

import { env } from '../../lib/env';
import { supabase } from '../../lib/supabase';

export type DemoUserKey = keyof typeof DEMO_USER_EMAILS;

export type SignInResult = { ok: true } | { ok: false; cancelled?: boolean; code: string; message: string };

let configured = false;
function configureGoogle() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: env.googleWebClientId || undefined,
    iosClientId: env.googleIosClientId || undefined,
  });
  configured = true;
}

/** Google nativo → idToken → supabase.auth.signInWithIdToken. */
export async function signInWithGoogle(): Promise<SignInResult> {
  if (!env.googleWebClientId) {
    return { ok: false, code: 'config_missing', message: 'Falta EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' };
  }
  try {
    configureGoogle();
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      return { ok: false, cancelled: true, code: 'cancelled', message: 'Cancelado' };
    }
    const idToken = response.data.idToken;
    if (!idToken) return { ok: false, code: 'no_id_token', message: 'Google no devolvió idToken' };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { ok: false, code: error.code ?? 'supabase_error', message: error.message };
    return { ok: true };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) {
        return { ok: false, cancelled: true, code: 'cancelled', message: 'Cancelado' };
      }
      return { ok: false, code: String(e.code), message: e.message };
    }
    return { ok: false, code: 'unknown', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Solo en __DEV__ / Supabase local: entra con un usuario del seed. */
export async function signInAsDemo(who: DemoUserKey): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_USER_EMAILS[who], password: DEMO_PASSWORD });
  if (error) return { ok: false, code: error.code ?? 'supabase_error', message: error.message };
  return { ok: true };
}

export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // sin sesión de Google: no pasa nada
  }
}
