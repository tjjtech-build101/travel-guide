// Menú dev oculto (long-press en el título del header): usuario, LocationProvider + simulador de GPS (PRD 09),
// último fix, Realtime, salir.
import Constants from 'expo-constants';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '../../features/auth/AuthProvider';
import { SimulatorPanel } from '../../features/gps/SimulatorPanel';
import { ClockDevSection } from '../../features/now/ClockDevSection';
import { env } from '../../lib/env';
import { useLocationFix, useLocationProvider } from '../../location/LocationContext';
import { useConnectionStore } from '../../realtime/connectionStore';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';

export default function DevMenu() {
  const { session, signOut } = useAuth();
  const { start, active } = useLocationProvider();
  const fix = useLocationFix();
  const realtime = useConnectionStore((s) => s.realtime);
  const realtimeError = useConnectionStore((s) => s.realtimeError);
  const [locError, setLocError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const user = session?.user;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title="Usuario">
        <Row label="Nombre" value={(user?.user_metadata?.full_name as string | undefined) ?? '—'} />
        <Row label="Email" value={user?.email ?? '—'} />
        <Row label="ID" value={user?.id ?? '—'} mono />
      </Section>

      <Section title="Ubicación">
        <SimulatorPanel />
        {!active ? (
          <Button
            label="Arrancar ubicación"
            variant="secondary"
            onPress={async () => {
              const err = await start();
              setLocError(err ? err.message : null);
            }}
            style={{ marginTop: space.sm }}
          />
        ) : null}
        {locError ? <Text style={styles.error}>{locError}</Text> : null}
        <Text style={[styles.mono, { marginTop: space.sm }]}>
          {fix ? JSON.stringify({ ...fix, t: new Date(fix.t).toISOString() }, null, 2) : 'Sin LocationFix todavía'}
        </Text>
      </Section>

      <ClockDevSection />

      <Section title="Conexión">
        <Row label="Realtime" value={realtime + (realtimeError ? ` (${realtimeError})` : '')} />
        <Row label="Supabase" value={env.supabaseUrl || '(falta)'} mono />
        <Row label="API" value={env.apiUrl || '(falta)'} mono />
        <Row label="Versión" value={`${Constants.expoConfig?.version ?? '?'} · ${Constants.expoConfig?.slug ?? ''}`} />
      </Section>

      <Button
        label="Cerrar sesión"
        variant="danger"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          await signOut();
          // El guard del layout raíz nos manda al login solo.
          setSigningOut(false);
        }}
      />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[mono ? styles.mono : styles.value, { flexShrink: 1, textAlign: 'right' }]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl * 2 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginBottom: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  label: { fontSize: font.body, color: colors.text },
  value: { fontSize: font.body, color: colors.textMuted },
  muted: { fontSize: font.small, color: colors.textMuted },
  mono: { fontFamily: 'Menlo', fontSize: font.tiny, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger, marginTop: space.sm },
});
