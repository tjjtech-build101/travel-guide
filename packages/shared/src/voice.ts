// Voz 1 a 1 (PRD 05): contratos de POST /voice/session y /voice/session/:id/end, eventos del mundo y resumen.
import { z } from 'zod';

const Id = z.guid();

/** Idiomas con botón en la barra de llamada. "Otro" se pide hablando. */
export const VOICE_LANGS = ['es', 'en', 'pt'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

export const VoiceFocus = z
  .object({
    block_id: Id.optional(),
    google_place_id: z.string().min(1).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    label: z.string().min(1).max(200).optional(),
  })
  .refine((f) => (f.lat === undefined) === (f.lng === undefined), { message: 'lat y lng van juntos' });
export type VoiceFocus = z.infer<typeof VoiceFocus>;

export const VoiceSessionInput = z.object({
  mode: z.enum(['chat', 'tour']).default('chat'),
  trip_id: Id.optional(),
  tour_id: Id.optional(),
  focus: VoiceFocus.optional(),
  purpose: z.enum(['onboarding', 'translator']).optional(),
  /** Idioma inicial (default: trip_members.language ?? profiles.locale ?? 'es'). */
  lang: z.string().min(2).max(8).optional(),
  target_lang: z.string().min(2).max(8).optional(),
  /** Posición actual del celu (LocationProvider) para que el scout sepa dónde estás. */
  location: z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().nullable().optional() }).optional(),
});
export type VoiceSessionInput = z.input<typeof VoiceSessionInput>;

/** Respuesta de POST /voice/session (data). `session_config` = el objeto `session` enviado a OpenAI, sin secretos. */
export type VoiceSessionStart = {
  client_secret: string;
  expires_at: number | null;
  voice_session_id: string;
  session_config: Record<string, unknown> & { instructions: string };
  /** Partes de las instrucciones, para rearmarlas en el celu al cambiar de idioma (session.update). */
  instructions_base: string;
  lang: string;
  scout: { name: string; voice: string };
};

export const TranscriptLine = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(4000),
  at: z.string(),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export const VoiceSessionEndInput = z.object({
  transcript: z.array(TranscriptLine).max(400).default([]),
});

/** Salida estructurada de Claude para el resumen al cortar. */
export const VoiceSummary = z.object({
  summary: z.string(),
  memories: z
    .array(
      z.object({
        scope: z.enum(['personal', 'trip']),
        kind: z.string(),
        text: z.string(),
      }),
    )
    .max(8),
});
export type VoiceSummary = z.infer<typeof VoiceSummary>;

/** agent_jobs.result de un job kind='voice_summary'. */
export type VoiceSummaryResult = {
  voice_session_id: string;
  summary: string;
  memories: number;
  duration_s: number;
  actions: { feed_id: string; kind: string; summary: string; undo_token: string | null; at: string }[];
};

/** Eventos del mundo hacia la sesión (`[EVENTO:<tipo>] <json>`, Contratos). */
export const VOICE_EVENT_TYPES = [
  'arrived_stop',
  'left_route',
  'time_warning',
  'photo_result',
  'weather_change',
  'member_late',
  'proposal_decided',
  'dwell',
  'speaker_changed',
] as const;
export type VoiceEventType = (typeof VOICE_EVENT_TYPES)[number];

export function formatVoiceEvent(type: VoiceEventType, payload: unknown): string {
  return `[EVENTO:${type}] ${JSON.stringify(payload ?? {})}`;
}

export const REALTIME_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';

const LANG_NAMES: Record<string, string> = {
  es: 'español rioplatense, con voseo',
  en: 'inglés (English)',
  pt: 'portugués (português)',
};

/**
 * Última línea de las instrucciones: el idioma. La API arma `instructions_base + '\n' + voiceLangLine(lang)` y el
 * celu hace lo mismo en `session.update` al cambiar de idioma (así no hay que pedir otra sesión).
 */
export function voiceLangLine(lang: string): string {
  const name = LANG_NAMES[lang] ?? lang;
  return `Idioma: hablá en ${name}. Si la persona te habla en otro idioma o te lo pide, cambiá en el momento y seguí en ese.`;
}
