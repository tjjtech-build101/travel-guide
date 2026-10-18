// Onboarding conversacional (PRD 10, con chips): el Scout se presenta y pregunta de a una cosa por pantalla
// (gustos, ritmo, horario, presupuesto, estilo, lo que no te gusta, comida, idiomas); festeja cuando contestás y
// al final guarda todo junto (profiles + onboarded_at en una sola actualización). Cada pregunta se puede saltar.
// Se abre al entrar si profiles.onboarded_at es null. "Ahora no" lo saltea solo por esta sesión.
import { SCOUT } from '@build101/shared';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { draftFromProfile, patchFromDraft, sectionAnswered, type ProfileDraft } from '../../features/profile/model';
import { PROFILE_SECTIONS, ProfileSection, type ProfileSectionId } from '../../features/profile/ProfileForm';
import { useMyProfile, useOnboardingSkip, useSaveProfile } from '../../features/profile/queries';
import type { ScoutPose } from '../../scout/ScoutRig';
import { Button } from '../../ui/Button';
import { BackIcon } from '../../ui/icons';
import { ScoutSays } from '../../ui/ScoutSays';
import { errorLine } from '../../lib/errors';
import { ErrorState, LoadingList } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, space } from '../../ui/theme';

const POSE: Record<ProfileSectionId, ScoutPose> = {
  interests: 'map',
  pace: 'compass',
  chronotype: 'idle',
  budget: 'think',
  style: 'map',
  avoid: 'idle',
  dietary: 'idle',
  languages: 'idle',
};

/** 0 = presentación · 1…N = una sección cada una · N+1 = cierre. */
const LAST = PROFILE_SECTIONS.length + 1;

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function OnboardingScreen() {
  const profile = useMyProfile();
  const save = useSaveProfile();
  const skip = useOnboardingSkip((s) => s.skip);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [step, setStep] = useState(0);
  const cheer = useCheer();

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
        <ErrorState message="No pude cargar tu perfil" error={profile.error} doing="cargar tu perfil" onRetry={() => profile.refetch()} />
        <Button label="Ahora no" variant="ghost" onPress={() => (skip(), leave())} />
      </SafeAreaView>
    );
  }

  const later = () => {
    skip();
    leave();
  };
  const finish = () =>
    save.mutate({ patch: patchFromDraft(draft, profile.data?.interests), markOnboarded: true }, { onSuccess: () => router.replace('/') });

  const section = step >= 1 && step < LAST ? PROFILE_SECTIONS[step - 1] : null;
  const answered = section ? sectionAnswered(section.id, draft) : false;

  const scout: { text: string; pose: ScoutPose } =
    step === 0
      ? {
          text: `¡Hola! Soy ${SCOUT.name}, tu guía. Te hago unas preguntas rápidas para armarte tours a tu medida. Es un minuto.`,
          pose: 'wave',
        }
      : section
        ? { text: section.ask, pose: cheer.on ? 'thumbs' : POSE[section.id] }
        : { text: '¡Listo! Ya sé cómo te gusta viajar. Lo guardo y arrancamos.', pose: 'thumbs' };

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.top}>
        {step > 0 ? (
          <Pressable onPress={() => setStep((s) => s - 1)} accessibilityRole="button" accessibilityLabel="Atrás" hitSlop={8} style={styles.back}>
            <BackIcon color={colors.primary} size={22} />
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        <View style={styles.progress} accessibilityLabel={`Pregunta ${Math.min(step, PROFILE_SECTIONS.length)} de ${PROFILE_SECTIONS.length}`}>
          <View style={[styles.progressFill, { width: `${(Math.min(step, PROFILE_SECTIONS.length) / PROFILE_SECTIONS.length) * 100}%` }]} />
        </View>
        <Pressable onPress={later} accessibilityRole="button" hitSlop={8} style={styles.later}>
          <Text style={styles.laterText}>Ahora no</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ScoutSays text={scout.text} pose={scout.pose} size={step === 0 || step === LAST ? 140 : 104} side={step === 0 || step === LAST ? 'top' : 'left'} />
        {section ? (
          <Animated.View key={section.id} entering={FadeIn.duration(250)} style={{ gap: space.sm }}>
            {section.hint ? <Text style={styles.hint}>{section.hint}</Text> : null}
            <ProfileSection
              id={section.id}
              draft={draft}
              showTitle={false}
              onChange={(d) => {
                // El Scout festeja la primera vez que contestás cada pregunta.
                if (!sectionAnswered(section.id, draft) && sectionAnswered(section.id, d)) cheer.fire();
                setDraft(d);
              }}
            />
          </Animated.View>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {save.isError ? <Text style={styles.error}>{errorLine(save.error, { doing: 'guardar tu perfil' })}</Text> : null}
        {step === 0 ? (
          <Button label="¡Dale!" onPress={() => setStep(1)} style={styles.main} />
        ) : section ? (
          <Button
            label={answered ? 'Seguir' : 'Saltar esta'}
            variant={answered ? 'primary' : 'secondary'}
            onPress={() => setStep((s) => s + 1)}
            style={styles.main}
          />
        ) : (
          <Button label="Guardar y empezar" loading={save.isPending} onPress={finish} style={styles.main} />
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

/** Pulgar arriba del Scout por un ratito. */
function useCheer() {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return {
    on,
    fire: () => {
      setOn(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), 1300);
    },
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: MIN_TOUCH },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  later: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.xs },
  laterText: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  content: { padding: space.lg, paddingBottom: space.xxl * 2, gap: space.lg },
  hint: { fontSize: font.tiny, color: colors.textMuted },
  bar: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  main: { minHeight: 56, marginBottom: space.sm },
  error: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
});
