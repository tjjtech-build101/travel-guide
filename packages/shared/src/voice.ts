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
  /**
   * Oferta SDP de WebRTC (interfaz unificada): la API crea la llamada en OpenAI con su key y devuelve answer_sdp.
   * Ahorra un viaje (~1 s) frente a client_secret + POST /realtime/calls desde el celu.
   */
  sdp: z.string().min(10).max(20_000).optional(),
});
export type VoiceSessionInput = z.input<typeof VoiceSessionInput>;

/** Respuesta de POST /voice/session (data). `session_config` = el objeto `session` enviado a OpenAI, sin secretos. */
export type VoiceSessionStart = {
  /** Token temporal (solo si no vino `sdp`). */
  client_secret: string | null;
  /** Respuesta SDP (si vino `sdp`): el celu la aplica con setRemoteDescription. */
  answer_sdp: string | null;
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

export function voiceLangName(lang: string): string {
  return LANG_NAMES[lang] ?? lang;
}

/**
 * Regla de idioma. Va arriba y abajo de las instrucciones (composeVoiceInstructions): las instrucciones y la charla
 * previa están en español y, si no, el modelo vuelve al español a mitad de frase.
 */
export function voiceLangLine(lang: string): string {
  if (lang === 'es') {
    return 'IDIOMA: hablá en español rioplatense, con voseo. Si la persona te pide otro idioma, llamá set_language y cambiá en el momento.';
  }
  const name = voiceLangName(lang);
  return `IDIOMA OBLIGATORIO: respondé SOLO en ${name}, cada frase entera, aunque estas instrucciones y la charla anterior estén en español. Esto pisa cualquier otra indicación de idioma (incluida la del personaje). Si te piden volver al español u otro idioma, llamá set_language.`;
}

/** Instrucciones completas = idioma + base + idioma. La API y el celu (al cambiar de idioma) usan la misma función. */
export function composeVoiceInstructions(base: string, lang: string): string {
  const line = voiceLangLine(lang);
  return `${line}\n${base}\n${line}`;
}

/** Mensaje de sistema que se inyecta al cambiar de idioma (la charla previa en español arrastra al modelo). */
export function languageSwitchMessage(lang: string, confirm = true): string {
  const base = `[IDIOMA] Desde ahora respondé únicamente en ${voiceLangName(lang)}.`;
  // Por voz (set_language) no hace falta confirmar: la respuesta a la herramienta ya va en el idioma nuevo.
  return confirm ? `${base} Confirmalo en una frase corta en ese idioma.` : base;
}

/**
 * Herramientas que resuelve el celu, no el backend (controles de la llamada, no datos). La API las suma a la sesión.
 * look_at_photo (PRD 08) se agrega acá con su esquema reducido.
 */
export const VOICE_CLIENT_TOOLS = [
  {
    type: 'function' as const,
    name: 'set_language',
    description:
      'Cambia el idioma de la llamada (lo que hablás y lo que se transcribe). Usala cuando la persona pide que le hables en otro idioma.',
    parameters: {
      type: 'object',
      properties: { lang: { type: 'string', description: 'Código ISO 639-1: es, en, pt, fr, it, de…' } },
      required: ['lang'],
      additionalProperties: false,
    },
  },
];

/**
 * Detección de turno mientras el scout habla (micrófono abierto, se lo corta con la voz): VAD por energía con umbral
 * alto, así el eco que queda después del AEC no lo corta pero una voz cercana sí. Al terminar se vuelve a la normal.
 */
export const BARGE_IN_TURN_DETECTION = {
  type: 'server_vad',
  threshold: 0.85,
  prefix_padding_ms: 200,
  silence_duration_ms: 500,
  interrupt_response: true,
  create_response: true,
} as const;
