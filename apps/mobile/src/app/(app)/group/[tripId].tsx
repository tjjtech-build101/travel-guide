// Grupo (placeholder hasta PRD 04; acceso secundario desde el menú de Planificación, fuera de las tabs): miembros + últimas filas de activity_feed.
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useLocalSearchParams } from 'expo-router';
import { useActivityFeed, useTripMembers } from '../../../features/trips/queries';
import { timeAgo } from '../../../lib/format';
import { Avatar } from '../../../ui/Avatar';
import { ErrorState, LoadingList } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { colors, font, radius, space } from '../../../ui/theme';

const ROLE_LABEL = { organizer: 'Organiza', traveler: 'Viaja', follower: 'Sigue el viaje' } as const;

export default function GroupTab() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const members = useTripMembers(tripId);
  const feed = useActivityFeed(tripId);

  if (members.isPending || feed.isPending) return <LoadingList count={2} />;
  if (members.isError || feed.isError) {
    return (
      <ErrorState
        message="No pudimos cargar el grupo"
        error={members.error ?? feed.error}
        doing="cargar el grupo"
        onRetry={() => {
          void members.refetch();
          void feed.refetch();
        }}
      />
    );
  }

  const names = new Map(members.data.map((m) => [m.id, m.display_name ?? 'Alguien']));

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={members.isRefetching || feed.isRefetching}
          onRefresh={() => {
            void members.refetch();
            void feed.refetch();
          }}
        />
      }
    >
      <Text style={styles.section}>Integrantes</Text>
      <View style={styles.card}>
        {members.data.map((m) => (
          <View key={m.id} style={styles.member}>
            <Avatar person={m} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{m.display_name ?? 'Sin nombre'}</Text>
              <Text style={styles.muted}>{ROLE_LABEL[m.role] ?? m.role}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Actividad reciente</Text>
      {feed.data.length === 0 ? (
        <Text style={styles.muted}>Todavía no pasó nada en este viaje.</Text>
      ) : (
        <View style={styles.card}>
          {feed.data.map((f) => (
            <View key={f.id} style={styles.feedRow}>
              <Text style={styles.feedText}>{f.payload?.summary ?? f.kind}</Text>
              <Text style={styles.muted}>
                {f.actor_agent ? 'Agente' : f.actor_user_id ? names.get(f.actor_user_id) ?? 'Alguien' : 'Sistema'} · {f.kind} ·{' '}
                {timeAgo(f.created_at)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl * 2 },
  section: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginTop: space.md, marginBottom: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  name: { fontSize: font.body, fontWeight: '600', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  feedRow: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  feedText: { fontSize: font.body, color: colors.text },
});
