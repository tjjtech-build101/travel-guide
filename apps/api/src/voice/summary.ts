// Resumen al cortar (PRD 05): job voice_summary → voice_sessions.summary + memories (personal por defecto).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { VoiceSummary, type TranscriptLine, type VoiceSummaryResult } from '@build101/shared';
import { PLANNER_MODEL } from '../agents/llm';
import { env } from '../env';
import { jobErrorFields, notConfigured, providerFailure } from '../errors';
import { JobProgress } from '../jobs';
import type { Db } from '../supabase';

export type SummaryLLM = (args: { system: string; user: string }) => Promise<VoiceSummary>;

const SYSTEM = [
  'Resumís una llamada de voz entre una persona y su guía de viaje (el scout).',
  'summary: 1 a 3 frases en español rioplatense, en segunda persona ("Hablaron de…", "Te agendé…"), con lo que se habló y lo que se hizo.',
  'memories: hechos duraderos y útiles para próximas charlas (gustos, restricciones, planes, pedidos). Máximo 8, cada una una frase corta.',
  'scope "personal" por defecto: lo dicho en una llamada 1 a 1 es privado. "trip" solo si la persona dijo explícitamente que es para el grupo.',
  'kind: preference | constraint | plan | fact | request.',
  'No guardes datos sensibles de terceros (salud, plata, relaciones de otra gente). No inventes nada que no esté en el transcript.',
].join('\n');

export const anthropicSummary: SummaryLLM = async ({ system, user }) => {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw notConfigured('Anthropic (ANTHROPIC_API_KEY)', 'anthropic');
  const client = new Anthropic({ apiKey });
  const format = betaZodOutputFormat(VoiceSummary);
  // Mismo patrón que agents/llm.ts: output_config no está tipado en el SDK 0.70 → cast.
  const params = {
    model: PLANNER_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: format.schema } },
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  };
  const msg = (await client.beta.messages.create(params as never)) as unknown as {
    stop_reason: string | null;
    content: { type: string; text?: string }[];
  };
  if (msg.stop_reason === 'refusal') throw providerFailure('provider_refused', 'anthropic', 'refusal', 'Claude no quiso resumir la charla.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return format.parse(text);
};

export function transcriptText(lines: TranscriptLine[], scoutName: string): string {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => `${l.role === 'user' ? 'Persona' : scoutName}: ${l.text.trim()}`)
    .join('\n');
}

type SessionRow = { id: string; trip_id: string | null; started_at: string; ended_at: string };

export async function runVoiceSummary(args: {
  admin: Db;
  jobId: string;
  userId: string;
  session: SessionRow;
  transcript: TranscriptLine[];
  scoutName: string;
  llm?: SummaryLLM;
}): Promise<VoiceSummaryResult> {
  const { admin, jobId, userId, session, transcript } = args;
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: 'Armando el resumen…' }]);
  await progress.set({ status: 'running' });
  const duration_s = Math.max(0, Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000));
  // Acciones del agente durante la llamada (lo que hizo la voz con x-actor: agent).
  let actions: VoiceSummaryResult['actions'] = [];
  try {
    if (session.trip_id) {
      const { data, error } = await admin
        .from('activity_feed')
        .select('id,kind,payload,undo_token,created_at')
        .eq('trip_id', session.trip_id)
        .eq('actor_user_id', userId)
        .eq('actor_agent', true)
        .gte('created_at', session.started_at)
        .lte('created_at', session.ended_at)
        .order('created_at');
      if (error) console.warn('[voice_summary] feed:', error.message);
      actions = (data ?? []).map((r) => ({
        feed_id: r.id as string,
        kind: r.kind as string,
        summary: ((r.payload as { summary?: string } | null)?.summary ?? r.kind) as string,
        undo_token: (r.undo_token as string | null) ?? null,
        at: r.created_at as string,
      }));
    }

    const text = transcriptText(transcript, args.scoutName);
    let summary = 'La llamada fue muy corta: no hay nada para resumir.';
    let memories: VoiceSummary['memories'] = [];
    if (text.length > 0) {
      const done = actions.length ? `\n\nAcciones hechas:\n${actions.map((a) => `- ${a.summary}`).join('\n')}` : '';
      const out = await (args.llm ?? anthropicSummary)({ system: SYSTEM, user: `Transcript:\n${text}${done}` });
      summary = out.summary;
      memories = out.memories;
    }

    const rows = memories
      .filter((m) => m.text.trim())
      .map((m) => {
        const trip = m.scope === 'trip' && session.trip_id;
        return {
          scope: trip ? 'trip' : 'personal',
          user_id: trip ? null : userId,
          trip_id: trip ? session.trip_id : null,
          kind: m.kind,
          text: m.text.trim(),
          source_session_id: session.id,
        };
      });
    if (rows.length) {
      const { error } = await admin.from('memories').insert(rows);
      if (error) console.warn('[voice_summary] memories:', error.message);
    }
    const { error: e2 } = await admin.from('voice_sessions').update({ summary }).eq('id', session.id);
    if (e2) console.warn('[voice_summary] voice_sessions:', e2.message);

    const result: VoiceSummaryResult = {
      voice_session_id: session.id,
      summary,
      memories: rows.length,
      duration_s,
      actions,
    };
    await progress.push('Listo');
    await progress.set({ status: 'done', result });
    return result;
  } catch (err) {
    // Las acciones se muestran igual aunque falle el texto (PRD 05).
    const result: VoiceSummaryResult = { voice_session_id: session.id, summary: '', memories: 0, duration_s, actions };
    await progress.push('No pude armar el resumen');
    await progress.set({ status: 'failed', ...jobErrorFields(err), result });
    throw err;
  }
}
