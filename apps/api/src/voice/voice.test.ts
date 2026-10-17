import { describe, expect, it } from 'vitest';
import { SCOUT, TOOL_NAMES, voiceLangLine, type BlockVisibleRow } from '@build101/shared';
import { topInterests, upcomingLines } from './context';
import { buildInstructions, nowHHMM, nowText, type InstructionsInput } from './instructions';
import { buildRealtimeSession, createClientSecret, turnDetection, vadConfig, voiceToolNames } from './openai';
import { runVoiceSummary, transcriptText } from './summary';
import type { Db } from '../supabase';

const base: InstructionsInput = {
  mode: 'chat',
  lang: 'es',
  nowText: 'sábado 17/10, 15:42',
  user: { name: 'Juan', interests: ['arquitectura'], avoid: ['museos'], dietary: [], pace: 'relaxed' },
  trip: { summary: 'Montevideo + Buenos Aires.', upcoming: ['16:00 Café (Teatro Solís)'], companions: ['Ana', 'Leo'] },
  memories: ['No le gusta madrugar'],
  location: { lat: -34.9, lng: -56.2 },
  focus: null,
};

describe('instrucciones del scout', () => {
  it('usan SCOUT, el contexto del viaje y la línea de idioma al final', () => {
    const { base: b, full } = buildInstructions(base);
    expect(b).toContain(`Sos ${SCOUT.name}.`);
    expect(b).toContain(SCOUT.persona);
    expect(b).toContain('Montevideo + Buenos Aires.');
    expect(b).toContain('- 16:00 Café (Teatro Solís)');
    expect(b).toContain('Ana, Leo');
    expect(b).toContain('- No le gusta madrugar');
    expect(b).toContain('le interesa arquitectura');
    expect(b).toContain('-34.90000, -56.20000');
    expect(b).toContain('saludá en una frase');
    expect(full).toBe(`${b}\n${voiceLangLine('es')}`);
  });

  it('con focus abre hablando de eso; sin viaje lo dice', () => {
    const { base: b } = buildInstructions({ ...base, trip: null, focus: 'el bloque «Teatro Solís» del plan' });
    expect(b).toContain('abrió la llamada desde el bloque «Teatro Solís» del plan');
    expect(b).not.toContain('saludá en una frase');
    expect(b).toContain('No hay un viaje abierto');
  });

  it('reglas extra (modo tour) entran antes de la apertura', () => {
    const { base: b } = buildInstructions({ ...base, extraRules: ['REGLA TOUR'] });
    expect(b.indexOf('REGLA TOUR')).toBeLessThan(b.indexOf('Apertura:'));
  });

  it('idioma: en → inglés', () => {
    expect(voiceLangLine('en')).toContain('inglés');
    expect(buildInstructions({ ...base, lang: 'en' }).full.endsWith(voiceLangLine('en'))).toBe(true);
  });

  it('hora en Montevideo', () => {
    const d = new Date('2026-10-17T18:42:00Z'); // 15:42 en UY (UTC-3)
    expect(nowText(d)).toBe('sábado 17/10, 15:42');
    expect(nowHHMM(d)).toBe('15:42');
  });
});

describe('contexto', () => {
  it('topInterests: ≥3 ordenados', () => {
    expect(topInterests({ comida: 4, arte: 2, arquitectura: 5 })).toEqual(['arquitectura', 'comida']);
    expect(topInterests(null)).toEqual([]);
  });

  it('upcomingLines: saltea ideas, variantes y lo que ya terminó', () => {
    const b = (o: Partial<BlockVisibleRow>) =>
      ({ status: 'confirmed', plan_variant: 'main', masked: false, place_name: null, end_time: null, start_time: null, ...o }) as BlockVisibleRow;
    const lines = upcomingLines(
      [
        b({ title: 'Desayuno', start_time: '09:00:00', end_time: '10:00:00' }),
        b({ title: 'Idea', status: 'idea' }),
        b({ title: 'Plan lluvia', plan_variant: 'rain', start_time: '16:00:00' }),
        b({ title: 'Café', start_time: '16:00:00', end_time: '17:00:00', place_name: 'Teatro Solís' }),
        b({ title: 'Ocupado', start_time: '18:00:00', masked: true }),
      ],
      '15:42',
    );
    expect(lines).toEqual(['16:00 Café (Teatro Solís)', '18:00 Ocupado [privado de otra persona]']);
  });
});

describe('sesión de OpenAI Realtime', () => {
  it('herramientas = todas las de Contratos con handler; voz y transcripción', () => {
    expect(voiceToolNames()).toEqual(TOOL_NAMES);
    expect(voiceToolNames(['plan_trip'])).not.toContain('plan_trip');
    const s = buildRealtimeSession({ instructions: 'x', lang: 'en' });
    expect(s.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(s.audio.output.voice).toBe(SCOUT.voice);
    expect(s.audio.input.transcription.language).toBe('en');
    expect(s.audio.input.noise_reduction.type).toBe('far_field');
    expect(s.audio.input.turn_detection).toMatchObject({ type: 'server_vad', threshold: 0.6, interrupt_response: true });
  });

  it('VAD configurable por env', () => {
    expect(vadConfig({ VOICE_VAD_THRESHOLD: '0.75' })).toMatchObject({ type: 'server_vad', threshold: 0.75 });
    expect(vadConfig({ VOICE_VAD_THRESHOLD: '7' }).threshold).toBe(0.6);
    expect(turnDetection(vadConfig({ VOICE_VAD: 'semantic_vad' }))).toMatchObject({ type: 'semantic_vad' });
  });

  it('createClientSecret: error de OpenAI → upstream 502 sin tirar la key', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-secreta';
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'bad tool' } }), { status: 400 })) as typeof fetch;
    await expect(createClientSecret({}, fake)).rejects.toMatchObject({ status: 502, code: 'upstream_error' });
    await expect(createClientSecret({}, fake)).rejects.not.toThrow(/sk-test/);
    const ok = (async () => new Response(JSON.stringify({ value: 'ek_1', expires_at: 1 }))) as typeof fetch;
    await expect(createClientSecret({}, ok)).resolves.toEqual({ value: 'ek_1', expires_at: 1 });
  });
});

/** Db falso: registra inserts/updates y devuelve filas fijas para selects de activity_feed. */
function fakeAdmin(feed: unknown[] = []) {
  const calls: { table: string; op: string; value?: unknown }[] = [];
  const chain = (table: string, op: string, value?: unknown): Record<string, unknown> => {
    calls.push({ table, op, value });
    const result = { data: op === 'select' && table === 'activity_feed' ? feed : null, error: null };
    const c: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
    };
    for (const m of ['eq', 'gte', 'lte', 'order', 'select', 'single', 'maybeSingle']) c[m] = () => c;
    return c;
  };
  const admin = {
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      insert: (v: unknown) => chain(table, 'insert', v),
      update: (v: unknown) => chain(table, 'update', v),
    }),
  } as unknown as Db;
  return { admin, calls };
}

describe('resumen al cortar', () => {
  const session = { id: 'vs1', trip_id: 't1', started_at: '2026-10-17T18:00:00Z', ended_at: '2026-10-17T18:03:00Z' };
  const transcript = [
    { role: 'user' as const, text: 'Agendame un café a las 17', at: '' },
    { role: 'assistant' as const, text: 'Listo, te lo agendé.', at: '' },
  ];

  it('transcriptText usa el nombre del scout', () => {
    expect(transcriptText(transcript, 'Scout')).toBe('Persona: Agendame un café a las 17\nScout: Listo, te lo agendé.');
  });

  it('escribe summary, memorias personales (trip solo si lo dijo) y el result con acciones', async () => {
    const { admin, calls } = fakeAdmin([
      { id: 'f1', kind: 'block_added', payload: { summary: 'Agregué Café 17:00' }, undo_token: 'tok', created_at: 'x' },
    ]);
    let prompt = '';
    const result = await runVoiceSummary({
      admin,
      jobId: 'j1',
      userId: 'u1',
      session,
      transcript,
      scoutName: 'Scout',
      llm: async ({ user }) => {
        prompt = user;
        return {
          summary: 'Te agendé un café.',
          memories: [
            { scope: 'personal', kind: 'preference', text: 'Toma café a la tarde' },
            { scope: 'trip', kind: 'plan', text: 'El grupo quiere parrilla' },
          ],
        };
      },
    });
    expect(prompt).toContain('- Agregué Café 17:00');
    expect(result).toMatchObject({ summary: 'Te agendé un café.', memories: 2, duration_s: 180 });
    expect(result.actions).toEqual([{ feed_id: 'f1', kind: 'block_added', summary: 'Agregué Café 17:00', undo_token: 'tok', at: 'x' }]);
    const mem = calls.find((c) => c.table === 'memories' && c.op === 'insert')!.value as Record<string, unknown>[];
    expect(mem[0]).toMatchObject({ scope: 'personal', user_id: 'u1', trip_id: null, source_session_id: 'vs1' });
    expect(mem[1]).toMatchObject({ scope: 'trip', user_id: null, trip_id: 't1' });
    expect(calls.some((c) => c.table === 'voice_sessions' && c.op === 'update')).toBe(true);
    const last = calls.filter((c) => c.table === 'agent_jobs').at(-1)!.value as { status: string };
    expect(last.status).toBe('done');
  });

  it('sin transcript no llama a Claude; si Claude falla el job queda failed con las acciones', async () => {
    const { admin } = fakeAdmin();
    let called = false;
    const r = await runVoiceSummary({ admin, jobId: 'j', userId: 'u', session, transcript: [], scoutName: 'Scout', llm: async () => {
      called = true;
      throw new Error('no');
    } });
    expect(called).toBe(false);
    expect(r.memories).toBe(0);

    const f = fakeAdmin([{ id: 'f1', kind: 'block_added', payload: { summary: 'X' }, undo_token: null, created_at: 'x' }]);
    await expect(
      runVoiceSummary({ admin: f.admin, jobId: 'j', userId: 'u', session, transcript, scoutName: 'Scout', llm: async () => {
        throw new Error('boom');
      } }),
    ).rejects.toThrow('boom');
    const last = f.calls.filter((c) => c.table === 'agent_jobs').at(-1)!.value as { status: string; result: { actions: unknown[] } };
    expect(last.status).toBe('failed');
    expect(last.result.actions).toHaveLength(1);
  });
});
