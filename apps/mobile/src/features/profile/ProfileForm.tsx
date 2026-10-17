// Formulario de preferencias con chips (onboarding mínimo y pantalla Perfil): intereses con peso, ritmo,
// horario, presupuesto, estilo, comida, cosas que no te gustan e idiomas.
import { INTEREST_TAGS } from '@build101/shared';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../ui/Text';
import { colors, font, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import {
  AVOID_OPTIONS,
  BUDGET_OPTIONS,
  CHRONOTYPE_OPTIONS,
  DIETARY_OPTIONS,
  INTEREST_LABEL,
  LANGUAGE_OPTIONS,
  nextStars,
  PACE_OPTIONS,
  STYLE_OPTIONS,
  toggle,
  type ProfileDraft,
} from './model';

const tick = () => void Haptics.selectionAsync().catch(() => {});

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Single<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={value === o.value}
          onPress={() => {
            tick();
            onChange(value === o.value ? null : o.value);
          }}
          style={styles.chip}
        />
      ))}
    </>
  );
}

export function ProfileForm({ draft, onChange }: { draft: ProfileDraft; onChange: (d: ProfileDraft) => void }) {
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => onChange({ ...draft, [k]: v });

  return (
    <View style={styles.form}>
      <Section title="¿Qué te gusta?" hint="Tocá varias veces: ★ más o menos · ★★ me gusta · ★★★ me encanta">
        {INTEREST_TAGS.map((tag) => {
          const stars = draft.interests[tag] ?? 0;
          return (
            <Chip
              key={tag}
              label={`${INTEREST_LABEL[tag]}${stars ? ` ${'★'.repeat(stars)}` : ''}`}
              selected={stars > 0}
              accessibilityLabel={`${INTEREST_LABEL[tag]}: ${stars} de 3 estrellas`}
              onPress={() => {
                tick();
                set('interests', { ...draft.interests, [tag]: nextStars(stars) });
              }}
              style={styles.chip}
            />
          );
        })}
      </Section>

      <Section title="Ritmo">
        <Single options={PACE_OPTIONS} value={draft.pace} onChange={(v) => set('pace', v)} />
      </Section>

      <Section title="Horario">
        <Single options={CHRONOTYPE_OPTIONS} value={draft.chronotype} onChange={(v) => set('chronotype', v)} />
      </Section>

      <Section title="Presupuesto">
        <Single options={BUDGET_OPTIONS} value={draft.budget_level} onChange={(v) => set('budget_level', v)} />
      </Section>

      <Section title="¿Cómo te gusta viajar?">
        <Single options={STYLE_OPTIONS} value={draft.travel_style} onChange={(v) => set('travel_style', v)} />
      </Section>

      <Section title="Cosas que no te gustan">
        {AVOID_OPTIONS.map((a) => (
          <Chip
            key={a}
            label={a[0].toUpperCase() + a.slice(1)}
            selected={draft.avoid.includes(a)}
            color={draft.avoid.includes(a) ? colors.danger : undefined}
            onPress={() => {
              tick();
              set('avoid', toggle(draft.avoid, a));
            }}
            style={styles.chip}
          />
        ))}
      </Section>

      <Section title="Comida">
        {DIETARY_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={draft.dietary.includes(o.value)}
            onPress={() => {
              tick();
              set('dietary', toggle(draft.dietary, o.value));
            }}
            style={styles.chip}
          />
        ))}
      </Section>

      <Section title="Idiomas que hablás">
        {LANGUAGE_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={draft.languages.includes(o.value)}
            onPress={() => {
              tick();
              set('languages', toggle(draft.languages, o.value));
            }}
            style={styles.chip}
          />
        ))}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.xl },
  section: { gap: space.sm },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  hint: { fontSize: font.tiny, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 44 },
});
