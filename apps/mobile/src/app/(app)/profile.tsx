// Perfil simple (PRD 10 mínimo): ver y editar las preferencias que usa el Scout para armar tours.
import { SCOUT } from '@build101/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../features/auth/AuthProvider';
import { useGuideStore } from '../../features/guide/store';
import { useOutdoorMode } from '../../features/now/v2/outdoor';
import { draftFromProfile, patchFromDraft, type ProfileDraft } from '../../features/profile/model';
import { ProfileForm } from '../../features/profile/ProfileForm';
import { useMyProfile, useSaveProfile } from '../../features/profile/queries';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { errorLine } from '../../lib/errors';
import { ErrorState, LoadingList } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';

export default function ProfileScreen() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const { outdoor, setOutdoor } = useOutdoorMode();

  useEffect(() => {
    if (profile.data !== undefined && draft === null) setDraft(draftFromProfile(profile.data));
  }, [profile.data, draft]);

  const original = useMemo(() => JSON.stringify(draftFromProfile(profile.data)), [profile.data]);
  const dirty = !!draft && JSON.stringify(draft) !== original;

  if (profile.isPending) return <LoadingList count={2} />;
  if (profile.isError || !draft) {
    return <ErrorState message="No pude cargar tu perfil" error={profile.error} doing="cargar tu perfil" onRetry={() => profile.refetch()} />;
  }

  const me = {
    id: session?.user.id ?? 'yo',
    display_name: profile.data?.display_name ?? null,
    avatar_url: profile.data?.avatar_url ?? null,
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Avatar person={me} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{me.display_name ?? 'Tu perfil'}</Text>
            <Text style={styles.sub}>{SCOUT.name} usa esto para armarte tours a tu medida.</Text>
          </View>
        </View>
        <ProfileForm
          draft={draft}
          onChange={(d) => {
            setSaved(false);
            setDraft(d);
          }}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Modo exterior (más contraste y letra grande)</Text>
          <Switch value={outdoor} onValueChange={setOutdoor} accessibilityLabel="Modo exterior" />
        </View>
        <View style={styles.guide}>
          <ScoutAvatar size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.guideTitle}>La guía de {SCOUT.name}</Text>
            <Text style={styles.sub}>Te vuelvo a mostrar cómo funciona cada pantalla.</Text>
          </View>
        </View>
        <Button
          label="Volver a ver la guía"
          variant="secondary"
          onPress={() => {
            useGuideStore.getState().resetAll();
            router.navigate('/');
          }}
        />
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {save.isError ? <Text style={styles.error}>{errorLine(save.error, { doing: 'guardar tu perfil' })}</Text> : null}
        {saved && !dirty ? <Text style={styles.ok}>Listo, guardado.</Text> : null}
        <Button
          label="Guardar cambios"
          disabled={!dirty}
          loading={save.isPending}
          onPress={() =>
            save.mutate(
              { patch: patchFromDraft(draft, profile.data?.interests), markOnboarded: !profile.data?.onboarded_at },
              {
                onSuccess: (row) => {
                  setDraft(draftFromProfile(row));
                  setSaved(true);
                },
              },
            )
          }
          style={styles.save}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl * 2, gap: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  guide: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: -space.md },
  guideTitle: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  bar: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: space.xs,
  },
  save: { minHeight: 56, marginBottom: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  error: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
  ok: { fontSize: font.small, color: colors.success, textAlign: 'center', fontWeight: '700' },
});
