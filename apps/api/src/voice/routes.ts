// POST /voice/session y POST /voice/session/:id/end (PRD 05, Contratos v1.1).
import { Hono } from 'hono';
import { SCOUT, VoiceSessionEndInput, VoiceSessionInput, type VoiceSessionStart } from '@build101/shared';
import { requireAuth, type AuthVars } from '../auth';
import { dbError, notFound, ToolFailure } from '../errors';
import { createJob, runInBackground } from '../jobs';
import { loadVoiceContext, TRIP_TZ } from './context';
import { buildInstructions, nowText, type InstructionsInput } from './instructions';
import { createHash } from 'node:crypto';
import { buildRealtimeSession, createCall, createClientSecret } from './openai';
import { runVoiceSummary, type SummaryLLM } from './summary';

export type VoiceDeps = {
  createClientSecret: typeof createClientSecret;
  createCall?: typeof createCall;
  summaryLLM?: SummaryLLM;
  /** Reglas extra por modo (PRD 07 registra las del tour). */
  modeRules?: (mode: 'chat' | 'tour', tourId?: string) => Promise<string[]> | string[];
};

/** Instrucciones mínimas con las que se crea el token (las completas llegan por session.update). */
export function staticInstructions(mode: 'chat' | 'tour'): string {
  return buildInstructions({
    mode,
    lang: 'es',
    nowText: nowText(new Date(), TRIP_TZ),
    user: { name: null, interests: [], avoid: [], dietary: [], pace: null },
    trip: null,
    memories: [],
    location: null,
    focus: null,
  }).full;
}

const fail = (err: unknown) => {
  if (err instanceof ToolFailure) return { status: err.status, body: { ok: false as const, error: err.toError() } };
  console.error('[voice]', err);
  return { status: 500, body: { ok: false as const, error: { code: 'internal', message: (err as Error)?.message ?? 'Error interno' } } };
};

async function readJson(text: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function voiceRoutes(deps: VoiceDeps = { createClientSecret, createCall }) {
  const r = new Hono<{ Variables: AuthVars }>();
  r.use('*', requireAuth);

  r.post('/session', async (c) => {
    const t0 = Date.now();
    const raw = await readJson(await c.req.text());
    if (!raw.ok) return c.json({ ok: false, error: { code: 'invalid_input', message: 'El body no es JSON válido.' } }, 400);
    const parsed = VoiceSessionInput.safeParse(raw.value);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'invalid_input', message: 'Input inválido.', issues: parsed.error.issues } }, 400);
    }
    const input = parsed.data;
    const ctx = c.get('ctx');
    // El token se pide en paralelo con el contexto (OpenAI tarda ~1 s): se crea con instrucciones estáticas y el celu
    // aplica las completas (session_config) con session.update antes del primer response.create.
    const ctx0 = c.get('ctx');
    const minimal = buildRealtimeSession({ instructions: staticInstructions(input.mode), lang: input.lang ?? 'es' });
    // Con sdp (interfaz unificada) la API crea la llamada; sin sdp, devuelve un token temporal.
    const secretP: Promise<{ value: string | null; expires_at: number | null; answer: string | null }> = input.sdp
      ? (deps.createCall ?? createCall)(input.sdp, minimal, {
          safetyId: createHash('sha256').update(ctx0.userId).digest('hex').slice(0, 32),
        }).then((answer) => ({ value: null, expires_at: null, answer }))
      : deps.createClientSecret(minimal).then((s) => ({ value: s.value, expires_at: s.expires_at, answer: null }));
    secretP.catch(() => {}); // si falla el contexto antes, que no quede un rechazo sin manejar
    try {
      const tourCheck = async () => {
        if (!input.tour_id) return;
        const { data, error } = await ctx.db.from('tours').select('id').eq('id', input.tour_id).maybeSingle();
        if (error) throw dbError(error, 'tours');
        if (!data) throw notFound('No encontré ese tour.');
      };
      const [vc, extraRules] = await Promise.all([
        loadVoiceContext(ctx, input),
        Promise.resolve(deps.modeRules?.(input.mode, input.tour_id) ?? []),
        tourCheck(),
      ]);
      const ii: InstructionsInput = { ...vc, mode: input.mode, nowText: nowText(new Date(), TRIP_TZ), extraRules };
      const { base, full } = buildInstructions(ii);
      const session = buildRealtimeSession({ instructions: full, lang: vc.lang });
      const tCtx = Date.now();

      const [secret, inserted] = await Promise.all([
        secretP,
        ctx.admin
          .from('voice_sessions')
          .insert({
            trip_id: input.trip_id ?? null,
            tour_id: input.tour_id ?? null,
            mode: input.mode,
            participants: [ctx.userId],
            persona_id: vc.personaId,
            purpose: input.purpose ?? null,
          })
          .select('id')
          .single(),
      ]);
      if (inserted.error) throw dbError(inserted.error, 'voice_sessions');
      console.log(`[voice] session ${inserted.data.id} ctx=${tCtx - t0}ms total=${Date.now() - t0}ms`);
      const data: VoiceSessionStart = {
        client_secret: secret.value,
        answer_sdp: secret.answer,
        expires_at: secret.expires_at,
        voice_session_id: inserted.data.id as string,
        session_config: session,
        instructions_base: base,
        lang: vc.lang,
        scout: { name: SCOUT.name, voice: SCOUT.voice },
      };
      return c.json({ ok: true, data });
    } catch (err) {
      const f = fail(err);
      return c.json(f.body, f.status as 500);
    }
  });

  r.post('/session/:id/end', async (c) => {
    const raw = await readJson(await c.req.text());
    if (!raw.ok) return c.json({ ok: false, error: { code: 'invalid_input', message: 'El body no es JSON válido.' } }, 400);
    const parsed = VoiceSessionEndInput.safeParse(raw.value);
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'invalid_input', message: 'Input inválido.', issues: parsed.error.issues } }, 400);
    }
    const ctx = c.get('ctx');
    const id = c.req.param('id');
    try {
      const { data: row, error } = await ctx.admin
        .from('voice_sessions')
        .select('id,trip_id,started_at,ended_at,participants')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        if (error.code === '22P02') return c.json({ ok: false, error: { code: 'invalid_input', message: 'id inválido.' } }, 400);
        throw dbError(error, 'voice_sessions');
      }
      if (!row || !(row.participants as string[] | null)?.includes(ctx.userId)) throw notFound('No encontré esa llamada.');
      if (row.ended_at) {
        return c.json({ ok: false, error: { code: 'already_ended', message: 'La llamada ya estaba cerrada.' } }, 409);
      }
      const ended_at = new Date().toISOString();
      const { error: e2 } = await ctx.admin
        .from('voice_sessions')
        .update({ ended_at, transcript: parsed.data.transcript })
        .eq('id', id);
      if (e2) throw dbError(e2, 'voice_sessions');
      const jobId = await createJob(ctx.admin, {
        kind: 'voice_summary',
        trip_id: (row.trip_id as string | null) ?? null,
        user_id: ctx.userId,
        firstLine: 'Armando el resumen…',
      });
      runInBackground(
        `voice_summary/${jobId}`,
        runVoiceSummary({
          admin: ctx.admin,
          jobId,
          userId: ctx.userId,
          session: { id, trip_id: (row.trip_id as string | null) ?? null, started_at: row.started_at as string, ended_at },
          transcript: parsed.data.transcript,
          scoutName: SCOUT.name,
          llm: deps.summaryLLM,
        }),
      );
      return c.json({ ok: true, data: { job_id: jobId } });
    } catch (err) {
      const f = fail(err);
      return c.json(f.body, f.status as 500);
    }
  });

  return r;
}
