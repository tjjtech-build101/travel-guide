import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { statusCodes } from '@react-native-google-signin/google-signin';

import { signInAsDemo, signInWithGoogle, type DemoUserKey, type SignInResult } from '../../features/auth/signIn';
import { toAppError, type AppError } from '../../lib/errors';
import { missingEnv } from '../../lib/env';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { errorToast, Toast, useToast } from '../../ui/Toast';
import { colors, font, radius, space } from '../../ui/theme';

const DEMO_USERS: { key: DemoUserKey; label: string }[] = [
  { key: 'juan', label: 'Juan' },
  { key: 'ana', label: 'Ana' },
  { key: 'leo', label: 'Leo' },
  { key: 'sofi', label: 'Sofi' },
];

type Pending = 'google' | DemoUserKey | null;

/**
 * Falla de login → error para lib/errors. Los textos técnicos (Google / Supabase, en inglés) quedan solo en
 * `detail` (se ven en desarrollo); a la persona le llega la causa: sin conexión, falta configurar, etc.
 */
function loginError(res: Extract<SignInResult, { ok: false }>): AppError {
  const detail = `${res.code}: ${res.message}`;
  if (res.code === 'config_missing') {
    return { code: 'not_configured', provider: 'google', message: 'A la app le falta el ID de cliente de Google.', detail };
  }
  if (res.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return { code: 'play_services', message: 'Este celu no tiene Google Play Services (o está desactualizado).', detail };
  }
  if (res.code === 'invalid_credentials') {
    return { code: 'demo_missing', message: 'Ese usuario de demo no está en esta base. Corré pnpm db:reset.', detail };
  }
  // Por el texto: "Network request failed" → sin conexión, timeouts, etc.
  const guess = toAppError(res.message);
  if (guess.code !== 'unknown') return { ...guess, detail };
  // Sin mensaje legible: genérico con el detalle técnico aparte.
  return { code: res.code, message: '', detail };
}

export default function LoginScreen() {
  const [pending, setPending] = useState<Pending>(null);
  const { toast, show } = useToast();
  const missing = missingEnv();

  const onGoogle = async () => {
    setPending('google');
    const res = await signInWithGoogle();
    setPending(null);
    // Cancelar (o tocar dos veces mientras ya estaba abierto) no es un error: no se muestra nada.
    if (!res.ok && !res.cancelled && res.code !== statusCodes.IN_PROGRESS) {
      show(errorToast(loginError(res), 'entrar con Google'));
    }
    // Si salió bien, el guard del layout raíz nos lleva a Mis viajes.
  };

  const onDemo = async (who: DemoUserKey) => {
    setPending(who);
    const res = await signInAsDemo(who);
    setPending(null);
    if (!res.ok) show(errorToast(loginError(res), 'entrar con el usuario de demo'));
  };

  const busy = pending !== null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.brand}>Compañero</Text>
          <Text style={styles.tagline}>Tu guía de viaje con IA: planificá en grupo y recorré cada lugar con un guía que te habla.</Text>
        </View>

        <Button label="Entrar con Google" onPress={onGoogle} loading={pending === 'google'} disabled={busy} />

        {__DEV__ ? (
          <View style={styles.dev}>
            <Text style={styles.devTitle}>Entrar como demo</Text>
            <Text style={styles.devHint}>Solo en desarrollo · usuarios del seed local</Text>
            <View style={styles.grid}>
              {DEMO_USERS.map((u) => (
                <Button
                  key={u.key}
                  label={u.label}
                  variant="secondary"
                  onPress={() => onDemo(u.key)}
                  loading={pending === u.key}
                  disabled={busy}
                  style={styles.gridItem}
                />
              ))}
            </View>
            {missing.length > 0 ? <Text style={styles.warn}>Falta configurar: {missing.join(', ')} (apps/mobile/.env)</Text> : null}
          </View>
        ) : null}
      </ScrollView>
      <Toast toast={toast} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg },
  hero: { marginBottom: space.xl },
  brand: { fontSize: 40, fontWeight: '800', color: colors.text },
  tagline: { fontSize: font.body, color: colors.textMuted, marginTop: space.sm, lineHeight: 24 },
  dev: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  devTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  devHint: { fontSize: font.small, color: colors.textMuted, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  gridItem: { flexBasis: '47%', flexGrow: 1 },
  warn: { marginTop: space.md, fontSize: font.tiny, color: colors.danger },
});
