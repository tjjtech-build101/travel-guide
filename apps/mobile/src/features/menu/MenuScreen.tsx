// Menú colaborativo por tramo (PRD 31): el grupo reacciona a las opciones (Me copa / Paso / Sí o sí) y después
// "Armar los días con esto" dispara compose_days. Ruta: /trip/[tripId]/menu?legId=<id>.
import { optionIncluded, type AgentJobRow, type LegOptionRow, type OptionReaction } from '@build101/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGuide } from '../guide/useGuide';
import type { AvatarPerson } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, space } from '../../ui/theme';
import { AgentJobProgress } from '../jobs/AgentJobProgress';
import { ActionToast } from '../plan/components/ActionToast';
import { useMe, usePermissions, usePlanBlocks, usePlanOverview } from '../plan/queries';
import { LegChips, MenuSkeleton, OptionCard } from './components';
import { buildMenuSections, initialMenuLeg, menuCounts, menuLegStates, nextReaction, reactionsByOption } from './model';
import { useComposeDays, useLegOptionReactions, useLegOptions, useReactOption } from './queries';

export function openTripPlan(tripId: string, legId?: string | null) {
  router.navigate({ pathname: '/trip/[tripId]', params: { tripId, ...(legId ? { leg: legId, t: String(Date.now()) } : {}) } });
}

export function MenuScreen({ tripId, legId: requestedLeg }: { tripId: string; legId?: string }) {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const options = useLegOptions(tripId);
  const reactions = useLegOptionReactions(tripId);
  const perms = usePermissions(tripId);
  const react = useReactOption(tripId, me);
  const compose = useComposeDays(tripId);
  useGuide('menu');
  const [jobId, setJobId] = useState<string | null>(null);
  const [legId, setLegId] = useState<string | null>(null);

  const legs = overview.data?.legs;
  const states = useMemo(
    () => (legs && options.data ? menuLegStates(legs, options.data, blocks.data ?? []) : []),
    [legs, options.data, blocks.data],
  );

  // Tramo inicial: el pedido por deep link, si no el primero sin armar. Un legId nuevo en la ruta manda.
  useEffect(() => {
    if (!states.length) return;
    setLegId((cur) => (cur && states.some((s) => s.legId === cur) ? cur : initialMenuLeg(states, requestedLeg)));
  }, [states, requestedLeg]);
  useEffect(() => {
    if (requestedLeg) setLegId(requestedLeg);
  }, [requestedLeg]);

  const people = useMemo(
    () => new Map<string, AvatarPerson>((overview.data?.members ?? []).map((m) => [m.id, m])),
    [overview.data?.members],
  );
  const byOption = useMemo(() => reactionsByOption(reactions.data ?? []), [reactions.data]);
  const sections = useMemo(() => (legId && options.data ? buildMenuSections(options.data, legId) : []), [options.data, legId]);
  const counts = useMemo(
    () => menuCounts(options.data ?? [], reactions.data ?? [], legId ? [legId] : []),
    [options.data, reactions.data, legId],
  );
  const allCounts = useMemo(() => menuCounts(options.data ?? [], reactions.data ?? [], null), [options.data, reactions.data]);

  const onReact = useCallback(
    (option: LegOptionRow, tapped: OptionReaction) => {
      const current = (byOption.get(option.id) ?? []).find((r) => r.user_id === me)?.reaction ?? null;
      react.mutate({ optionId: option.id, reaction: nextReaction(current, tapped) });
    },
    [byOption, me, react],
  );

  const onJobDone = useCallback(
    (job: AgentJobRow) => {
      const first = (job.result as { coverage?: { leg_id: string }[] } | null)?.coverage?.[0]?.leg_id ?? legId;
      // La pantalla queda montada (tabs): al volver, el menú vuelve a estar listo para votar.
      setJobId(null);
      openTripPlan(tripId, first);
    },
    [tripId, legId],
  );

  const startCompose = async (legIds?: string[]) => {
    try {
      const res = await compose.mutateAsync(legIds);
      setJobId(res.job_id);
    } catch {
      // El toast ya lo mostró useComposeDays.
    }
  };

  // ───────── Estados
  const loading = overview.isPending || options.isPending || reactions.isPending || blocks.isPending;
  const error = (overview.isError && !overview.data) || (options.isError && !options.data) || (reactions.isError && !reactions.data);
  const retry = () => {
    void overview.refetch();
    void options.refetch();
    void reactions.refetch();
    void blocks.refetch();
  };

  if (loading) return <MenuSkeleton />;
  if (error) {
    return (
      <ErrorState
        message="No pudimos cargar el menú"
        error={overview.error ?? options.error ?? reactions.error}
        doing="cargar el menú"
        onRetry={retry}
      />
    );
  }

  const current = states.find((s) => s.legId === legId) ?? null;
  const requestedCity = legs?.find((l) => l.id === (legId ?? requestedLeg))?.city ?? legs?.[0]?.city ?? 'este viaje';

  if (!current) {
    return (
      <EmptyState
        title={`Todavía no hay menú para ${requestedCity}`}
        subtitle="El menú se arma cuando el compañero planifica el viaje en modo grupo: junta imperdibles, joyas y lugares para cada uno, y ustedes eligen qué va."
      >
        {states.length ? <Button label={`Ver el menú de ${states[0].city}`} onPress={() => setLegId(states[0].legId)} /> : null}
        <Button label="Volver al plan" variant="secondary" onPress={() => openTripPlan(tripId)} />
      </EmptyState>
    );
  }

  const chipLegs = states.map((s) => {
    const l = legs?.find((x) => x.id === s.legId);
    return { ...s, start_date: l?.start_date ?? '', end_date: l?.end_date ?? '' };
  });
  const canReact = perms.canPropose;
  const canCompose = perms.canEditLeg(current.legId);
  const pendingOthers = states.filter((s) => !s.planned).length;
  const busy = compose.isPending || !!jobId;

  const composeCurrent = () => {
    if (!current.planned) return void startCompose([current.legId]);
    Alert.alert(
      `¿Rearmar ${current.city}?`,
      'Ya tiene días armados. Los vuelvo a armar con lo que eligieron en el menú.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Rearmar', onPress: () => void startCompose([current.legId]) },
      ],
    );
  };

  const BAR_H = states.length > 1 ? 120 : 76;

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: BAR_H + insets.bottom + space.xxl }]}>
        {states.length > 1 ? (
          <View style={styles.chipsWrap}>
            <LegChips legs={chipLegs} value={current.legId} onChange={setLegId} />
          </View>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Elegí qué hacer en {current.city}
          </Text>
          <Text style={styles.counter}>
            {counts.included} en el plan
            {counts.mustTotal ? ` · ${counts.mustIncluded} de ${counts.mustTotal} imperdibles` : ''}
          </Text>
          <Text style={styles.hint}>
            Reaccioná a lo que te tiente. Lo marcado “Va en el plan” entra cuando armemos los días. Con un “Sí o sí” entra seguro.
          </Text>
        </View>

        {jobId ? (
          <View style={styles.job}>
            <AgentJobProgress tripId={tripId} jobId={jobId} onDone={onJobDone} showSkeleton={false} />
          </View>
        ) : null}

        {sections.map((s) => (
          <View key={s.section} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {s.title}
              </Text>
              <Text style={styles.sectionSub}>{s.subtitle}</Text>
            </View>
            {s.options.map((o) => {
              const rs = byOption.get(o.id) ?? [];
              return (
                <OptionCard
                  key={o.id}
                  option={o}
                  reactions={rs}
                  included={optionIncluded(o, rs)}
                  me={me}
                  people={people}
                  onReact={canReact ? onReact : null}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>

      {canCompose ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
          {current.planned && !busy ? (
            <>
              <Button label={`Ver los días de ${current.city}`} onPress={() => openTripPlan(tripId, current.legId)} />
              <Button label={`Rearmar con esto (${counts.included})`} variant="ghost" onPress={composeCurrent} />
            </>
          ) : (
            <>
              <Button
                label={jobId ? 'Armando los días…' : `Armar los días con esto (${counts.included})`}
                onPress={composeCurrent}
                loading={compose.isPending}
                disabled={busy || counts.included === 0}
              />
              {pendingOthers > 1 ? (
                <Button
                  label={`Armá todos los tramos (${allCounts.included})`}
                  variant="ghost"
                  onPress={() => void startCompose()}
                  disabled={busy}
                />
              ) : null}
            </>
          )}
        </View>
      ) : (
        <View style={[styles.bar, { paddingBottom: insets.bottom + space.md }]}>
          <Text style={styles.readOnly}>
            {perms.isFollower ? 'Seguís el viaje: podés mirar el menú, pero eligen los que viajan.' : 'Los días de este tramo los arma quien viaja ahí.'}
          </Text>
        </View>
      )}
      <ActionToast bottom={BAR_H + insets.bottom + space.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { paddingTop: space.sm, gap: space.lg },
  chipsWrap: { marginHorizontal: 0 },
  header: { paddingHorizontal: space.lg, gap: space.xs },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  counter: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  hint: { fontSize: font.small, color: colors.textMuted },
  job: { paddingHorizontal: space.lg },
  section: { paddingHorizontal: space.lg, gap: space.md },
  sectionHead: { gap: 2 },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  sectionSub: { fontSize: font.small, color: colors.textMuted },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.xs,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  readOnly: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', paddingVertical: space.sm },
});
