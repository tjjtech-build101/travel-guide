import { Image, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, font } from './theme';

const PALETTE = ['#8A6236', '#3567A0', '#B07A16', '#7B4F2C', '#5F6B35', '#8E4B6E'];

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export type AvatarPerson = { id: string; display_name: string | null; avatar_url: string | null };

export function Avatar({ person, size = 32 }: { person: AvatarPerson; size?: number }) {
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (person.avatar_url) {
    return <Image source={{ uri: person.avatar_url }} style={[style, styles.ring]} accessibilityLabel={person.display_name ?? ''} />;
  }
  return (
    <View style={[style, styles.ring, styles.fallback, { backgroundColor: colorFor(person.id) }]} accessibilityLabel={person.display_name ?? ''}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials(person.display_name)}</Text>
    </View>
  );
}

export function AvatarStack({ people, size = 32, max = 5 }: { people: AvatarPerson[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <View style={styles.row}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -size / 4 }}>
          <Avatar person={p} size={size} />
        </View>
      ))}
      {rest > 0 ? <Text style={styles.rest}>+{rest}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderWidth: 2, borderColor: colors.surface },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
  rest: { marginLeft: 6, fontSize: font.small, color: colors.textMuted },
});
