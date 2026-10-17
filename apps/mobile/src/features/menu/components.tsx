// Piezas del menú colaborativo (PRD 31): ícono por categoría, tarjeta de opción con reacciones, chips de tramo y esqueleto.
import type { CatalogCategory, LegOptionReactionRow, LegOptionRow, OptionReaction } from '@build101/shared';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { AvatarStack, type AvatarPerson } from '../../ui/Avatar';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { TypeIcon } from '../plan/components/TypeIcon';
import { CATEGORY_LABEL, forWhomLabel, metaLine, REACTION_LABEL, shortRange, TIER_LABEL, type MenuLegState } from './model';

// ───────────────────────── Ícono por categoría

const svg = (size: number, color: ColorValue) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function CategoryIcon({ category, color, size = 22 }: { category: CatalogCategory; color: ColorValue; size?: number }) {
  const s = svg(size, color);
  switch (category) {
    case 'museum':
      return (
        <Svg {...s}>
          <Path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 21h18" />
        </Svg>
      );
    case 'viewpoint':
      return (
        <Svg {...s}>
          <Path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" />
          <Circle cx={12} cy={12} r={2.6} />
        </Svg>
      );
    case 'park':
      return (
        <Svg {...s}>
          <Path d="M12 21v-6M12 3l5 7h-3l4 5H6l4-5H7z" />
        </Svg>
      );
    case 'beach':
      return (
        <Svg {...s}>
          <Circle cx={17} cy={7} r={3} />
          <Path d="M2 19c2 0 2-1.5 4-1.5S8 19 10 19s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
        </Svg>
      );
    case 'market':
    case 'shopping':
      return (
        <Svg {...s}>
          <Path d="M5 8h14l-1.2 12H6.2z" />
          <Path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </Svg>
      );
    case 'nightlife':
      return (
        <Svg {...s}>
          <Path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </Svg>
      );
    case 'event':
      return (
        <Svg {...s}>
          <Rect x={3.5} y={5} width={17} height={15} rx={2.5} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" />
        </Svg>
      );
    case 'neighborhood':
      return (
        <Svg {...s}>
          <Path d="M3 21V10l5-4 5 4v11M13 21v-8h8v8M3 21h18M7 14h2" />
        </Svg>
      );
    case 'food':
      return <TypeIcon type="meal" color={color} size={size} />;
    case 'day_trip':
      return <TypeIcon type="transfer" color={color} size={size} />;
    case 'experience':
      return <TypeIcon type="tour" color={color} size={size} />;
    default:
      return <TypeIcon type="activity" color={color} size={size} />;
  }
}

// ───────────────────────── Chips de tramo

export function LegChips({ legs, value, onChange }: { legs: (MenuLegState & { start_date: string; end_date: string })[]; value: string | null; onChange: (legId: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {legs.map((l) => {
        const active = l.legId === value;
        return (
          <Pressable
            key={l.legId}
            onPress={() => onChange(l.legId)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${l.city}, ${shortRange(l.start_date, l.end_date)}${l.planned ? ', ya armado' : ''}`}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipCity, active && styles.chipTextActive]}>{l.city}</Text>
            <Text style={[styles.chipDates, active && styles.chipTextActive]}>
              {shortRange(l.start_date, l.end_date)}
              {l.planned ? ' · armado' : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ───────────────────────── Tarjeta de opción

const REACTIONS: OptionReaction[] = ['love', 'no', 'must'];

const REACTION_TONE: Record<OptionReaction, { bg: string; fg: string; border: string }> = {
  love: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
  no: { bg: colors.text, fg: '#fff', border: colors.text },
  must: { bg: colors.bronze, fg: colors.text, border: colors.bronzeText },
};

type CardProps = {
  option: LegOptionRow;
  reactions: LegOptionReactionRow[];
  included: boolean;
  me: string;
  people: Map<string, AvatarPerson>;
  /** null = no puede reaccionar (seguidor). */
  onReact: ((option: LegOptionRow, tapped: OptionReaction) => void) | null;
};

export const OptionCard = memo(function OptionCard({ option, reactions, included, me, people, onReact }: CardProps) {
  const [tipOpen, setTipOpen] = useState(false);
  const it = option.item;
  const mine = reactions.find((r) => r.user_id === me)?.reaction ?? null;
  const meta = metaLine(it);
  const person = (id: string): AvatarPerson => people.get(id) ?? { id, display_name: null, avatar_url: null };
  const forWhom = forWhomLabel(option.for_user_ids, me, (id) => people.get(id)?.display_name);
  const booking = it.booking === 'required' ? 'Hay que reservar' : it.booking === 'recommended' ? 'Conviene reservar' : null;
  const eventWhen = it.event_dates?.length
    ? `${it.event_dates.map((d) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`).join(', ')}${it.event_time ? ` · ${it.event_time.slice(0, 5)}` : ''}`
    : null;

  return (
    <View
      style={[styles.card, included && styles.cardIncluded]}
      accessibilityLabel={`${it.name}. ${TIER_LABEL[it.tier]}. ${included ? 'Va en el plan' : 'Queda afuera'}`}
    >
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <CategoryIcon category={it.category} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={2}>
            {it.name}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {[CATEGORY_LABEL[it.category], meta].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={[styles.tier, it.tier === 'must' ? styles.tierMust : it.tier === 'gem' ? styles.tierGem : null]}>
          <Text style={[styles.tierText, it.tier === 'must' && { color: colors.text }]}>{TIER_LABEL[it.tier]}</Text>
        </View>
      </View>

      {forWhom ? (
        <View style={styles.forRow}>
          <AvatarStack people={option.for_user_ids.map(person)} size={22} max={4} />
          <Text style={styles.forText} numberOfLines={2}>
            {forWhom}
            {option.reason ? ` · ${option.reason}` : ''}
          </Text>
        </View>
      ) : option.reason ? (
        <Text style={styles.reason}>{option.reason}</Text>
      ) : null}

      {it.why ? <Text style={styles.why}>{it.why}</Text> : null}

      {eventWhen || booking ? (
        <View style={styles.tags}>
          {eventWhen ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{eventWhen}</Text>
            </View>
          ) : null}
          {booking ? (
            <View style={[styles.tag, styles.tagWarn]}>
              <Text style={[styles.tagText, { color: colors.bronzeText }]}>{booking}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {it.tip ? (
        <Pressable onPress={() => setTipOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: tipOpen }} hitSlop={6} style={styles.tipBtn}>
          <Text style={styles.tipLabel}>{tipOpen ? 'Consejo local ▾' : 'Consejo local ▸'}</Text>
          {tipOpen ? <Text style={styles.tip}>{it.tip}</Text> : null}
        </Pressable>
      ) : null}

      <ReactionPeople reactions={reactions} person={person} />

      <View style={styles.footer}>
        {included ? (
          <View style={styles.inPlan}>
            <Text style={styles.inPlanText}>✓ Va en el plan</Text>
          </View>
        ) : (
          <Text style={styles.outPlan}>Queda afuera</Text>
        )}
      </View>

      {onReact ? (
        <View style={styles.buttons}>
          {REACTIONS.map((r) => {
            const on = mine === r;
            const tone = REACTION_TONE[r];
            return (
              <Pressable
                key={r}
                onPress={() => onReact(option, r)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${REACTION_LABEL[r]}${on ? ', elegido. Tocá para sacarlo' : ''}`}
                style={({ pressed }) => [
                  styles.reactBtn,
                  on ? { backgroundColor: tone.bg, borderColor: tone.border } : null,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.reactText, on && { color: tone.fg }]}>{REACTION_LABEL[r]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

function ReactionPeople({ reactions, person }: { reactions: LegOptionReactionRow[]; person: (id: string) => AvatarPerson }) {
  const groups = REACTIONS.map((r) => ({ r, ids: reactions.filter((x) => x.reaction === r).map((x) => x.user_id) })).filter((g) => g.ids.length);
  if (!groups.length) return null;
  return (
    <View style={styles.reactedRow}>
      {groups.map((g) => (
        <View key={g.r} style={styles.reacted} accessibilityLabel={`${REACTION_LABEL[g.r]}: ${g.ids.map((id) => person(id).display_name ?? 'alguien').join(', ')}`}>
          <AvatarStack people={g.ids.map(person)} size={20} max={4} />
          <Text style={styles.reactedText}>{REACTION_LABEL[g.r]}</Text>
        </View>
      ))}
    </View>
  );
}

// ───────────────────────── Punto de entrada desde el Plan

/** Banner "Armá {ciudad} con el grupo" (tramo con menú y sin días armados) o links discretos "Ver menú de {ciudad}". */
export function MenuEntry({ states, onOpen }: { states: MenuLegState[]; onOpen: (legId: string) => void }) {
  if (!states.length) return null;
  const pending = states.filter((s) => !s.planned);
  if (pending.length) {
    const first = pending[0];
    const more = pending.length - 1;
    return (
      <Pressable
        onPress={() => onOpen(first.legId)}
        accessibilityRole="button"
        accessibilityHint="Abre el menú del tramo"
        style={({ pressed }) => [styles.entry, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.flex}>
          <Text style={styles.entryTitle}>Armá {first.city} con el grupo: elegí del menú</Text>
          <Text style={styles.entrySub}>
            {first.options} {first.options === 1 ? 'opción' : 'opciones'} para votar
            {more > 0 ? ` · y ${more} ${more === 1 ? 'tramo más' : 'tramos más'}` : ''}
          </Text>
        </View>
        <Text style={styles.entryLink}>Abrir</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.entryLinks}>
      {states.map((s) => (
        <Pressable key={s.legId} onPress={() => onOpen(s.legId)} accessibilityRole="link" hitSlop={6} style={styles.entryLinkBtn}>
          <Text style={styles.entryLinkSmall}>Ver menú de {s.city}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ───────────────────────── Esqueleto

export function MenuSkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Cargando el menú">
      <Skeleton width="70%" height={26} />
      <Skeleton width="45%" height={16} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <View style={styles.head}>
            <Skeleton width={40} height={40} style={{ borderRadius: 20 }} />
            <View style={[styles.flex, { gap: space.xs }]}>
              <Skeleton width="65%" height={18} />
              <Skeleton width="45%" height={14} />
            </View>
          </View>
          <Skeleton height={14} style={{ marginTop: space.md }} />
          <Skeleton width="80%" height={14} style={{ marginTop: space.xs }} />
          <View style={[styles.buttons, { marginTop: space.md }]}>
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} height={MIN_TOUCH} style={{ flex: 1 }} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
  chip: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipCity: { fontSize: font.small, fontWeight: '700', color: colors.text },
  chipDates: { fontSize: font.tiny, color: colors.textMuted },
  chipTextActive: { color: colors.primaryText },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  cardIncluded: { borderColor: colors.success, borderWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.khakiLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  tier: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tierMust: { backgroundColor: colors.bronze },
  tierGem: { backgroundColor: colors.khaki },
  tierText: { fontSize: font.tiny, fontWeight: '700', color: colors.khakiText },
  forRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  forText: { flex: 1, fontSize: font.small, fontWeight: '600', color: colors.primary },
  reason: { fontSize: font.small, color: colors.primary, fontWeight: '600' },
  why: { fontSize: font.body, color: colors.text },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  tagWarn: { backgroundColor: '#F6E7C4' },
  tagText: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  tipBtn: { minHeight: 32, justifyContent: 'center' },
  tipLabel: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  tip: { fontSize: font.small, color: colors.text, marginTop: space.xs },
  reactedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  reacted: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  reactedText: { fontSize: font.tiny, color: colors.textMuted, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center' },
  inPlan: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.successBg },
  inPlanText: { fontSize: font.tiny, fontWeight: '800', color: colors.success },
  outPlan: { fontSize: font.tiny, color: colors.textMuted },
  buttons: { flexDirection: 'row', gap: space.sm },
  reactBtn: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  reactText: { fontSize: font.small, fontWeight: '700', color: colors.text },
  skeleton: { padding: space.lg, gap: space.md },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.khakiLight,
    borderWidth: 1,
    borderColor: colors.khaki,
  },
  entryTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  entrySub: { fontSize: font.small, color: colors.khakiText, marginTop: 2 },
  entryLink: { fontSize: font.body, fontWeight: '800', color: colors.primary },
  entryLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, paddingHorizontal: space.lg },
  entryLinkBtn: { minHeight: 32, justifyContent: 'center' },
  entryLinkSmall: { fontSize: font.small, fontWeight: '600', color: colors.primary },
});
