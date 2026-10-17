// Onboarding mínimo (PRD 10 simplificado, decisiones del sábado): una pantalla con chips, sin voz.
// Se abre al entrar si profiles.onboarded_at es null. Guardar escribe profiles + onboarded_at en una sola
// actualización. "Ahora no" lo saltea solo por esta sesión.
import { SCOUT } from '@build101/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { completedSections, draftFromProfile, patchFromDraft, TOTAL_SECTIONS, type ProfileDraft } from '../../features/profile/model';
import { ProfileForm } from '../../features/profile/ProfileForm';
import { useMyProfile, useOnboardingSkip, useSaveProfile } from '../../features/profile/queries';
import { errorDetail } from '../../features/trips/queries';
import { Button } from '../../ui/Button';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { ErrorState, LoadingList } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function OnboardingScreen() {
  const profile = useMyProfile();
  const save = useSaveProfile();
  const skip = useOnboardingSkip((s) => s.skip);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  useEffect(() => {
    if (profile.data !== undefined && draft === null) setDraft(draftFromProfile(profile.data));
  }, [profile.data, draft]);

  if (profile.isPending || (!draft && !profile.isError)) {
    return (
      <SafeAreaView style={styles.flex}>
        <LoadingList count={2} />
      </SafeAreaView>
    );
  }
  if (profile.isError || !draft) {
    return (
      <SafeAreaView style={styles.flex}>
        <ErrorState message="No pude cargar tu perfil" detail={errorDetail(profile.error)} onRetry={() => profile.refetch()} />
        <Button label="Ahora no" variant="ghost" onPress={() => (skip(), leave())} />
      </SafeAreaView>
    );
  }

  const done = completedSections(draft);

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <ScoutAvatar size={88} state="idle" />
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>¡Hola! Soy {SCOUT.name}</Text>
            <Text style={styles.sub}>Contame cómo te gusta viajar y te armo tours a tu medida. Es un minuto.</Text>
          </View>
        </View>
        <View style={styles.progress} accessibilityLabel={`${done} de ${TOTAL_SECTIONS} completas`}>
          <View style={[styles.progressFill, { width: `${(done / TOTAL_SECTIONS) * 100}%` }]} />
        </View>
        <ProfileForm draft={draft} onChange={setDraft} />
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {save.isError ? <Text style={styles.error}>No pude guardar. Probá de nuevo.</Text> : null}
        <Button
          label="Listo, guardar"
          loading={save.isPending}
          onPress={() =>
            save.mutate(
              { patch: patchFromDraft(draft, profile.data?.interests), markOnboarded: true },
              { onSuccess: () => router.replace('/') },
            )
          }
          style={styles.save}
        />
        <Button
          label="Ahora no"
          variant="ghost"
          onPress={() => {
            skip();
            leave();
          }}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl * 2, gap: space.lg },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  hello: { fontSize: font.title, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.body, color: colors.textMuted, marginTop: space.xs, lineHeight: 23 },
  progress: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  bar: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  save: { minHeight: 56 },
  error: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
});
