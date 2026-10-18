// Piezas de la home (Inicio): héroe (viaje en curso / próximo / bienvenida), accesos rápidos y filas de viajes.
import { SCOUT } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AvatarStack } from '../../ui/Avatar';
import { Skeleton } from '../../ui/States';
import { ScoutRig, type ScoutPose } from '../../scout/ScoutRig';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { callTool } from '../../lib/api';
import { errorLine } from '../../lib/errors';
import { formatDateRange } from '../../lib/format';
import { ChevronIcon, SparkIcon } from '../plan/components/TypeIcon';
import { confirm, showMenu } from '../plan/menu';
import { openProposals } from '../plan/nav';
import { useMe, usePendingProposals, usePlanBlocks, usePlanOverview } from '../plan/queries';
import { buildNowPlan, clock, formatMinutes, localParts, resolveToday } from '../now/selectors';
import { tripKeys } from '../trips/keys';
import type { TripCard } from '../trips/queries';
import { countdownLabel, daysUntilStart, HOME_OFFSET_MIN, tripDayOf } from './selectors';

const ON_DARK = '#FFF9EE';
const ON_DARK_MUTED = colors.khaki;

export function openTripNow(tripId: string) {
  router.push({ pathname: '/trip/[tripId]/now', params: { tripId } });
}

export function openTripPlan(tripId: string) {
  router.push({ pathname: '/trip/[tripId]', params: { tripId } });
}

// ───────── Héroe

function HeroShell({ pose, onPress, label, children }: { pose: ScoutPose; onPress?: () => void; label: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
    >
      <View style={styles.heroGlow} />
      <ScoutRig width={92} pose={pose} style={styles.heroScout} />
      {children}
    </Pressable>
  );
}

function Kicker({ children }: { children: string }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

function HeroCta({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
      <Text style={styles.ctaText}>{label}</Text>
      <View style={{ transform: [{ rotate: '-90deg' }] }}>
        <ChevronIcon color={colors.text} size={18} />
      </View>
    </Pressable>
  );
}

/** "Scout tiene 2 propuestas para revisar" (solo si hay). */
function ProposalsChip({ tripId }: { tripId: string }) {
  const proposals = usePendingProposals(tripId);
  const n = proposals.data?.length ?? 0;
  if (!n) return null;
  return (
    <Pressable
      onPress={() => openProposals(tripId)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <SparkIcon color={colors.scoutText} size={15} />
      <Text style={styles.chipText}>
        {SCOUT.name} tiene {n} {n === 1 ? 'propuesta' : 'propuestas'} para revisar
      </Text>
    </Pressable>
  );
}

/** Viaje en curso: qué toca ahora / qué sigue, en una tarjeta grande. */
export function HeroLive({ trip, now }: { trip: TripCard; now: number }) {
  const me = useMe();
  const overview = usePlanOverview(trip.id);
  const blocks = usePlanBlocks(trip.id);

  const today = useMemo(() => {
    if (!overview.data || !blocks.data) return null;
    const ctx = resolveToday(overview.data.legs, me, now, trip);
    if (ctx.kind !== 'today') return { ctx, plan: null };
    const dayBlocks = blocks.data.filter((b) => b.day_id === ctx.day.id);
    return { ctx, plan: buildNowPlan(dayBlocks, me, ctx.minutes) };
  }, [overview.data, blocks.data, me, now, trip]);

  const date = today && 'date' in today.ctx ? today.ctx.date : localParts(now, HOME_OFFSET_MIN).date;
  const dayOf = tripDayOf(trip, date);
  const city = today?.ctx.kind === 'today' ? today.ctx.leg.city : trip.destinations[0];
  const kicker = ['En curso', dayOf ? `Día ${dayOf.day} de ${dayOf.total}` : null, city].filter(Boolean).join(' · ');

  let body: ReactNode;
  if (!today) {
    body = overview.isError || blocks.isError ? (
      // La causa real (sin conexión, sesión vencida…) y un Reintentar chico (el héroe entero abre Ahora).
      <View style={{ gap: space.xs }}>
        <Text style={styles.nowEmpty}>No pudimos cargar el plan de hoy.</Text>
        <Text style={styles.nowAfter} numberOfLines={2}>
          {errorLine(overview.error ?? blocks.error, { doing: 'cargar el plan de hoy' })}
        </Text>
        <Pressable
          onPress={() => {
            void overview.refetch();
            void blocks.refetch();
          }}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.nowRetry}
        >
          <Text style={styles.nowRetryText}>{overview.isFetching || blocks.isFetching ? 'Reintentando…' : 'Reintentar'}</Text>
        </Pressable>
      </View>
    ) : (
      <View style={{ gap: space.sm }}>
        <Skeleton width="40%" height={14} style={styles.skeletonDark} />
        <Skeleton width="75%" height={20} style={styles.skeletonDark} />
      </View>
    );
  } else if (today.plan?.current) {
    const c = today.plan.current;
    body = (
      <>
        <Text style={styles.nowLabel}>Ahora · quedan {formatMinutes(c.remainingMin)}</Text>
        <Text style={styles.nowTitle} numberOfLines={2}>
          {c.block.title}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, c.progress)) * 100)}%` }]} />
        </View>
        {today.plan.next ? (
          <Text style={styles.nowAfter} numberOfLines={1}>
            Después: {today.plan.next.block.title} · {clock(today.plan.next.start)}
          </Text>
        ) : null}
      </>
    );
  } else if (today.plan?.next) {
    const n = today.plan.next;
    body = (
      <>
        <Text style={styles.nowLabel}>
          Sigue a las {clock(n.start)} · en {formatMinutes(n.inMin)}
        </Text>
        <Text style={styles.nowTitle} numberOfLines={2}>
          {n.block.title}
        </Text>
        {n.block.place_name ? (
          <Text style={styles.nowAfter} numberOfLines={1}>
            {n.block.place_name}
          </Text>
        ) : null}
      </>
    );
  } else {
    body = <Text style={styles.nowEmpty}>Nada más agendado por hoy. Pedile a {SCOUT.name} un tour por la zona.</Text>;
  }

  return (
    <HeroShell pose="compass" label={`Abrir ${trip.title} en Ahora`} onPress={() => openTripNow(trip.id)}>
      <Kicker>{kicker}</Kicker>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {trip.title}
      </Text>
      <View style={styles.nowPanel}>{body}</View>
      <ProposalsChip tripId={trip.id} />
      <HeroCta label="Abrir Ahora" onPress={() => openTripNow(trip.id)} />
    </HeroShell>
  );
}

/** Próximo viaje: cuenta regresiva y cuánto del plan ya está armado. */
export function HeroUpcoming({ trip, now }: { trip: TripCard; now: number }) {
  const overview = usePlanOverview(trip.id);
  const blocks = usePlanBlocks(trip.id);
  const days = daysUntilStart(trip, now);

  const progress = useMemo(() => {
    if (!overview.data || !blocks.data) return null;
    const allDays = overview.data.legs.flatMap((l) => l.days);
    if (!allDays.length) return null;
    const withPlan = new Set(blocks.data.filter((b) => b.day_id && (!b.plan_variant || b.plan_variant === 'main')).map((b) => b.day_id));
    const planned = allDays.filter((d) => withPlan.has(d.id)).length;
    return { planned, total: allDays.length };
  }, [overview.data, blocks.data]);

  return (
    <HeroShell pose="map" label={`Abrir ${trip.title}`} onPress={() => openTripPlan(trip.id)}>
      <Kicker>Tu próximo viaje</Kicker>
      <View style={styles.countRow}>
        {days !== null && days > 1 ? (
          <>
            <Text style={styles.countNum}>{days}</Text>
            <Text style={styles.countUnit}>días para{'\n'}salir</Text>
          </>
        ) : (
          <Text style={styles.countWord}>{days === null ? 'Sin fechas' : days === 1 ? '¡Mañana!' : '¡Hoy!'}</Text>
        )}
      </View>
      <Text style={styles.heroTitle} numberOfLines={2}>
        {trip.title}
      </Text>
      <Text style={styles.heroMeta} numberOfLines={1}>
        {[formatDateRange(trip.start_date, trip.end_date), trip.destinations.join(' · ')].filter(Boolean).join('  ·  ')}
      </Text>
      {progress ? (
        <View style={{ marginTop: space.md, gap: space.xs }}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round((progress.planned / progress.total) * 100)}%` }]} />
          </View>
          <Text style={styles.heroMetaSmall}>
            {progress.planned === progress.total
              ? 'Todos los días tienen plan'
              : `${progress.planned} de ${progress.total} días con plan`}
          </Text>
        </View>
      ) : null}
      <ProposalsChip tripId={trip.id} />
      <HeroCta label={progress && progress.planned < progress.total ? 'Seguir planificando' : 'Ver el plan'} onPress={() => openTripPlan(trip.id)} />
    </HeroShell>
  );
}

/** Sin viajes por delante: invitación a armar uno. */
export function HeroWelcome({ onNewTrip }: { onNewTrip: () => void }) {
  return (
    <HeroShell pose="wave" label="Armar un viaje nuevo" onPress={onNewTrip}>
      <Kicker>{`${SCOUT.name} está listo`}</Kicker>
      <Text style={[styles.heroTitle, { marginRight: 96 }]}>¿A dónde vamos ahora?</Text>
      <Text style={[styles.heroMeta, { marginRight: 96 }]}>
        Contale a dónde querés ir y te arma el viaje día por día. Después te guía en la calle.
      </Text>
      <HeroCta label="Armar un viaje" onPress={onNewTrip} />
    </HeroShell>
  );
}

export function HeroSkeleton() {
  return (
    <View style={[styles.hero, { gap: space.md }]} accessibilityLabel="Cargando">
      <Skeleton width="35%" height={14} style={styles.skeletonDark} />
      <Skeleton width="70%" height={28} style={styles.skeletonDark} />
      <Skeleton width="55%" height={16} style={styles.skeletonDark} />
      <Skeleton width="100%" height={MIN_TOUCH} style={[styles.skeletonDark, { marginTop: space.md }]} />
    </View>
  );
}

// ───────── Accesos rápidos

export function QuickAction({
  label,
  hint,
  icon,
  onPress,
  soon,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  onPress?: () => void;
  soon?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={soon}
      accessibilityRole="button"
      accessibilityLabel={soon ? `${label}, muy pronto` : label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.quick, soon && styles.soon, pressed && styles.pressed]}
    >
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.quickHint} numberOfLines={1}>
        {soon ? 'Muy pronto' : hint}
      </Text>
    </Pressable>
  );
}

// ───────── Lista de viajes

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function DateBadge({ iso, dim }: { iso: string | null; dim?: boolean }) {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return (
    <View style={[styles.badge, dim && styles.badgeDim]}>
      {m ? (
        <>
          <Text style={[styles.badgeDay, dim && styles.textDim]}>{Number(m[3])}</Text>
          <Text style={[styles.badgeMonth, dim && styles.textDim]}>{MONTHS[Number(m[2]) - 1]}</Text>
        </>
      ) : (
        <Text style={styles.badgeMonth}>—</Text>
      )}
    </View>
  );
}

export function TripRow({ trip, now, kind }: { trip: TripCard; now: number; kind: 'live' | 'upcoming' | 'past' }) {
  const pill =
    kind === 'live'
      ? { text: 'En curso', bg: colors.scout, fg: colors.scoutText }
      : kind === 'past'
        ? { text: 'Terminado', bg: colors.surfaceMuted, fg: colors.textMuted }
        : { text: countdownLabel(daysUntilStart(trip, now)), bg: colors.khakiLight, fg: colors.khakiText };
  const sub = trip.destinations.length ? trip.destinations.join(' · ') : formatDateRange(trip.start_date, trip.end_date);
  const qc = useQueryClient();
  const onMenu = () => {
    showMenu(trip.title, [
      {
        label: 'Borrar viaje',
        destructive: true,
        onPress: () =>
          confirm(
            'Borrar viaje',
            `Se borra "${trip.title}" entero: tramos, días, bloques, tours, gastos. No se puede deshacer.`,
            'Borrar',
            () => {
              void (async () => {
                const res = await callTool('delete_trip', { trip_id: trip.id });
                if (res.ok) void qc.invalidateQueries({ queryKey: tripKeys.mine() });
                else Alert.alert('No pude borrar el viaje', errorLine(res.error, { doing: 'borrar el viaje' }));
              })();
            },
          ),
      },
    ]);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${trip.title}, ${pill.text}`}
      accessibilityHint="Mantené apretado para más opciones"
      onPress={() => (kind === 'live' ? openTripNow(trip.id) : openTripPlan(trip.id))}
      onLongPress={onMenu}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <DateBadge iso={trip.start_date} dim={kind === 'past'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, kind === 'past' && styles.textDim]} numberOfLines={1}>
          {trip.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {sub}
        </Text>
        <View style={styles.rowFoot}>
          <View style={[styles.pill, { backgroundColor: pill.bg }]}>
            <Text style={[styles.pillText, { color: pill.fg }]}>{pill.text}</Text>
          </View>
          {trip.members.length > 1 ? <AvatarStack people={trip.members} size={24} max={4} /> : null}
        </View>
      </View>
      <View style={{ transform: [{ rotate: '-90deg' }] }}>
        <ChevronIcon color={colors.textMuted} size={18} />
      </View>
    </Pressable>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },

  hero: {
    backgroundColor: colors.text,
    borderRadius: 24,
    padding: space.xl,
    overflow: 'hidden',
    minHeight: 220,
  },
  heroGlow: {
    position: 'absolute',
    right: -70,
    top: -70,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: colors.primary,
    opacity: 0.45,
  },
  heroScout: { position: 'absolute', right: 6, top: 10 },
  kicker: {
    fontSize: font.tiny,
    fontWeight: '700',
    color: colors.bronze,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginRight: 96,
  },
  heroTitle: { fontSize: font.title, fontWeight: '700', color: ON_DARK, marginTop: space.sm, marginRight: 80, lineHeight: 34 },
  heroMeta: { fontSize: font.small, color: ON_DARK_MUTED, marginTop: space.xs },
  heroMetaSmall: { fontSize: font.tiny, color: ON_DARK_MUTED },

  countRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.md },
  countNum: { fontSize: 64, lineHeight: 66, fontWeight: '700', color: ON_DARK },
  countUnit: { fontSize: font.small, fontWeight: '600', color: ON_DARK_MUTED, marginBottom: 10, lineHeight: 18 },
  countWord: { fontSize: 40, lineHeight: 46, fontWeight: '700', color: ON_DARK },

  nowPanel: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,249,238,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,249,238,0.12)',
    gap: space.xs,
  },
  nowLabel: { fontSize: font.tiny, fontWeight: '700', color: colors.bronze, textTransform: 'uppercase', letterSpacing: 0.6 },
  nowTitle: { fontSize: font.h2, fontWeight: '700', color: ON_DARK },
  nowAfter: { fontSize: font.small, color: ON_DARK_MUTED, marginTop: space.xs },
  nowEmpty: { fontSize: font.body, color: ON_DARK },
  nowRetry: { alignSelf: 'flex-start', minHeight: MIN_TOUCH, justifyContent: 'center' },
  nowRetryText: { fontSize: font.small, fontWeight: '700', color: ON_DARK, textDecorationLine: 'underline' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,249,238,0.15)', overflow: 'hidden', marginTop: space.xs },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.bronze },
  skeletonDark: { backgroundColor: 'rgba(255,249,238,0.14)' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.scout,
  },
  chipText: { fontSize: font.tiny, fontWeight: '700', color: colors.scoutText },

  cta: {
    marginTop: space.lg,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    backgroundColor: colors.khakiLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  ctaText: { fontSize: font.body, fontWeight: '700', color: colors.text },

  quick: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 2,
    minHeight: 112,
  },
  soon: { opacity: 0.55 },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.khakiLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  quickLabel: { fontSize: font.small, fontWeight: '700', color: colors.text },
  quickHint: { fontSize: font.tiny, color: colors.textMuted },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  badge: {
    width: 56,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.khakiLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDim: { backgroundColor: colors.surfaceMuted },
  badgeDay: { fontSize: font.h2, fontWeight: '700', color: colors.khakiText, lineHeight: 26 },
  badgeMonth: { fontSize: 11, fontWeight: '700', color: colors.khakiText, letterSpacing: 1 },
  textDim: { color: colors.textMuted },
  rowTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: font.small, color: colors.textMuted },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs },
  pill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 12, fontWeight: '700' },
});
