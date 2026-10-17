// Modelo puro del perfil (PRD 10 mínimo, sin voz): borrador de chips ↔ columnas de `profiles`.
// Tests: model.test.ts (`pnpm --filter mobile test:profile`).
import {
  INTEREST_TAGS,
  type BudgetLevel,
  type Chronotype,
  type InterestTag,
  type Pace,
  type ProfilePreferencesPatch,
  type ProfileRow,
  type TravelStyle,
} from '@build101/shared';

export const INTEREST_LABEL: Record<InterestTag, string> = {
  historia: 'Historia',
  arquitectura: 'Arquitectura',
  arte: 'Arte',
  museos: 'Museos',
  comida: 'Comida',
  mercados: 'Mercados',
  vida_nocturna: 'Vida nocturna',
  musica: 'Música',
  naturaleza: 'Naturaleza',
  playa: 'Playa',
  compras: 'Compras',
  deporte: 'Deporte',
  fotografia: 'Fotografía',
  religion: 'Religión',
  tecnologia: 'Tecnología',
};

export const PACE_OPTIONS: { value: Pace; label: string }[] = [
  { value: 'relaxed', label: 'Tranqui' },
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'intense', label: 'A full' },
];

export const CHRONOTYPE_OPTIONS: { value: Chronotype; label: string }[] = [
  { value: 'early', label: 'Madrugador' },
  { value: 'normal', label: 'Normal' },
  { value: 'night', label: 'Nocturno' },
];

export const BUDGET_OPTIONS: { value: BudgetLevel; label: string }[] = [
  { value: 'low', label: 'Gasolero' },
  { value: 'mid', label: 'Medio' },
  { value: 'high', label: 'Darse gustos' },
  { value: 'no_limit', label: 'Sin límite' },
];

export const STYLE_OPTIONS: { value: TravelStyle; label: string }[] = [
  { value: 'planned', label: 'Todo planeado' },
  { value: 'mixed', label: 'Mitad y mitad' },
  { value: 'spontaneous', label: 'Sobre la marcha' },
];

/** Cosas que no te gustan (profiles.avoid, texto libre en Contratos: guardamos estas etiquetas). */
export const AVOID_OPTIONS = [
  'museos',
  'multitudes',
  'caminar mucho',
  'madrugar',
  'lugares muy turísticos',
  'boliches',
  'shoppings',
  'colas largas',
] as const;

/** profiles.dietary. */
export const DIETARY_OPTIONS: { value: string; label: string }[] = [
  { value: 'vegetariano', label: 'Vegetariano' },
  { value: 'vegano', label: 'Vegano' },
  { value: 'sin_tacc', label: 'Sin TACC' },
  { value: 'sin_lactosa', label: 'Sin lactosa' },
];

/** profiles.languages (ISO 639-1). */
export const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Deutsch' },
];

// ───────── Intereses con peso: chips de 0 a 3 estrellas ↔ pesos 1–5 de Contratos.

export type Stars = 0 | 1 | 2 | 3;

const STAR_TO_WEIGHT: Record<Exclude<Stars, 0>, number> = { 1: 2, 2: 4, 3: 5 };

export function starsToWeight(stars: Stars): number | null {
  return stars === 0 ? null : STAR_TO_WEIGHT[stars];
}

/** 5 → ★★★ (me encanta), 3–4 → ★★ (me gusta), 1–2 → ★ (más o menos). */
export function weightToStars(w: number | null | undefined): Stars {
  if (!w || w < 1) return 0;
  if (w >= 5) return 3;
  if (w >= 3) return 2;
  return 1;
}

/** Tocar un chip de interés: 0 → 1 → 2 → 3 → 0. */
export function nextStars(s: Stars): Stars {
  return ((s + 1) % 4) as Stars;
}

export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// ───────── Borrador ↔ fila

export type ProfileDraft = {
  interests: Partial<Record<InterestTag, Stars>>;
  pace: Pace | null;
  chronotype: Chronotype | null;
  budget_level: BudgetLevel | null;
  travel_style: TravelStyle | null;
  dietary: string[];
  avoid: string[];
  languages: string[];
};

export type ProfilePrefs = Pick<
  ProfileRow,
  'interests' | 'pace' | 'chronotype' | 'budget_level' | 'travel_style' | 'dietary' | 'avoid' | 'languages' | 'locale'
>;

export function emptyDraft(locale = 'es'): ProfileDraft {
  return {
    interests: {},
    pace: null,
    chronotype: null,
    budget_level: null,
    travel_style: null,
    dietary: [],
    avoid: [],
    languages: [locale === 'en' ? 'en' : 'es'],
  };
}

export function draftFromProfile(p: Partial<ProfilePrefs> | null | undefined): ProfileDraft {
  const base = emptyDraft(p?.locale ?? 'es');
  if (!p) return base;
  const interests: ProfileDraft['interests'] = {};
  for (const tag of INTEREST_TAGS) {
    const s = weightToStars(p.interests?.[tag]);
    if (s) interests[tag] = s;
  }
  return {
    interests,
    pace: p.pace ?? null,
    chronotype: p.chronotype ?? null,
    budget_level: p.budget_level ?? null,
    travel_style: p.travel_style ?? null,
    dietary: p.dietary ?? [],
    avoid: p.avoid ?? [],
    languages: p.languages?.length ? p.languages : base.languages,
  };
}

/**
 * Patch para `profiles`. Conserva intereses que no están en INTEREST_TAGS (p. ej. los que escriba la
 * extracción por voz más adelante) y los pesos exactos de los que no cambiaron de estrellas.
 */
export function patchFromDraft(d: ProfileDraft, previous?: Record<string, number> | null): ProfilePreferencesPatch {
  const interests: Record<string, number> = {};
  for (const [k, w] of Object.entries(previous ?? {})) {
    if (!(INTEREST_TAGS as readonly string[]).includes(k)) interests[k] = w;
  }
  for (const tag of INTEREST_TAGS) {
    const stars = d.interests[tag] ?? 0;
    const prev = previous?.[tag];
    const w = prev && weightToStars(prev) === stars ? prev : starsToWeight(stars);
    if (w) interests[tag] = w;
  }
  return {
    interests: Object.keys(interests).length ? interests : null,
    pace: d.pace,
    chronotype: d.chronotype,
    budget_level: d.budget_level,
    travel_style: d.travel_style,
    dietary: d.dietary,
    avoid: d.avoid,
    languages: d.languages,
  };
}

/** Cuántas secciones completó (para el progreso del onboarding). */
export function completedSections(d: ProfileDraft): number {
  return [
    Object.values(d.interests).some((s) => (s ?? 0) > 0),
    !!d.pace,
    !!d.chronotype,
    !!d.budget_level,
    d.avoid.length > 0,
    d.languages.length > 0,
  ].filter(Boolean).length;
}

export const TOTAL_SECTIONS = 6;

export function needsOnboarding(p: Pick<ProfileRow, 'onboarded_at'> | null | undefined): boolean {
  return !!p && !p.onboarded_at;
}
