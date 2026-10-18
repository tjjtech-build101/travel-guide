// Quién va: avatares y, si comparten ubicación, una línea corta ("Ana a 300 m · Leo llegó").
import { StyleSheet, View } from 'react-native';

import { AvatarStack, type AvatarPerson } from '../../../../ui/Avatar';
import { Text } from '../../../../ui/Text';
import { colors, font, space } from '../../../../ui/theme';

export type GroupFacesPerson = AvatarPerson & { distance_m?: number | null };

/** A menos de esto, "llegó". */
const ARRIVED_M = 50;
/** Nombres en la línea: más es ruido. */
const MAX_NAMES = 2;

function firstName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'Alguien';
}

export function distanceLabel(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "Ana a 300 m · Leo llegó": solo quienes tienen distancia, en el orden recibido, máx. 2. */
export function groupLine(people: GroupFacesPerson[]): string | null {
  const parts = people
    .filter((p) => typeof p.distance_m === 'number')
    .slice(0, MAX_NAMES)
    .map((p) => {
      const d = p.distance_m as number;
      return d <= ARRIVED_M ? `${firstName(p.display_name)} llegó` : `${firstName(p.display_name)} a ${distanceLabel(d)}`;
    });
  return parts.length ? parts.join(' · ') : null;
}

export function GroupFaces({ people, max = 4 }: { people: GroupFacesPerson[]; max?: number }) {
  if (!people.length) return null;
  const line = groupLine(people);
  const names = people.map((p) => firstName(p.display_name)).join(', ');
  return (
    <View style={styles.row} accessible accessibilityLabel={`Van: ${names}${line ? `. ${line}` : ''}`}>
      <AvatarStack people={people} size={28} max={max} />
      {line ? (
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexShrink: 1, fontSize: font.small, color: colors.textMuted },
});
