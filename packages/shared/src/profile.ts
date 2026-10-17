// Perfil del usuario (PRD 10): formas de los jsonb y enums de `profiles`. No cambia nombres de Contratos.
import { z } from 'zod';

export const INTEREST_TAGS = [
  'historia',
  'arquitectura',
  'arte',
  'museos',
  'comida',
  'mercados',
  'vida_nocturna',
  'musica',
  'naturaleza',
  'playa',
  'compras',
  'deporte',
  'fotografia',
  'religion',
  'tecnologia',
] as const;
export type InterestTag = (typeof INTEREST_TAGS)[number];

export const PACES = ['relaxed', 'balanced', 'intense'] as const;
export const Pace = z.enum(PACES); // profiles.pace
export type Pace = z.infer<typeof Pace>;

export const CHRONOTYPES = ['early', 'normal', 'night'] as const;
export const Chronotype = z.enum(CHRONOTYPES); // profiles.chronotype
export type Chronotype = z.infer<typeof Chronotype>;

export const BUDGET_LEVELS = ['low', 'mid', 'high', 'no_limit'] as const;
export const BudgetLevel = z.enum(BUDGET_LEVELS); // profiles.budget_level
export type BudgetLevel = z.infer<typeof BudgetLevel>;

export const TRAVEL_STYLES = ['planned', 'mixed', 'spontaneous'] as const;
export const TravelStyle = z.enum(TRAVEL_STYLES); // profiles.travel_style
export type TravelStyle = z.infer<typeof TravelStyle>;

/** profiles.interests: {"arquitectura": 5, "comida": 4}, pesos 1–5. */
export const Interests = z.record(z.string(), z.number().int().min(1).max(5));
export type Interests = z.infer<typeof Interests>;

export const Mobility = z.object({ step_free: z.boolean(), max_walk_km: z.number().nullable(), notes: z.string().nullable() });
export type Mobility = z.infer<typeof Mobility>;

export const InferredTrait = z.object({
  id: z.string(),
  trait: z.string(),
  kind: z.enum(['interest', 'avoid', 'pace', 'food', 'other']),
  value: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
  source: z.enum(['onboarding', 'implicit']),
  status: z.enum(['pending', 'confirmed', 'dismissed']),
  at: z.string().datetime(),
});
export type InferredTrait = z.infer<typeof InferredTrait>;

export const QuietHours = z.object({ start: z.string(), end: z.string(), tz: z.string() }); // "22:00"-"08:00"
export type QuietHours = z.infer<typeof QuietHours>;

export const NotificationPrefs = z.object({
  guide_can_call: z.boolean(),
  max_calls_per_day: z.number().int().min(0).max(5),
  categories: z.object({ proposals: z.boolean(), group: z.boolean(), tour: z.boolean(), expenses: z.boolean(), briefing: z.boolean() }),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

/** Campos de `profiles` que llena el onboarding mínimo con chips (sin voz) y edita la pantalla Perfil. */
export const ProfilePreferencesPatch = z.object({
  interests: Interests.nullable(),
  pace: Pace.nullable(),
  chronotype: Chronotype.nullable(),
  budget_level: BudgetLevel.nullable(),
  travel_style: TravelStyle.nullable(),
  dietary: z.array(z.string()),
  avoid: z.array(z.string()),
  languages: z.array(z.string()),
});
export type ProfilePreferencesPatch = z.infer<typeof ProfilePreferencesPatch>;
