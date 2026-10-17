// API Hono (Vercel la detecta por el export default). Runtime Node.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TOOL_NAMES } from '@build101/shared';
import { requireAuth, type AuthVars } from './auth';
import { env, missingSupabaseEnv } from './env';
import { dbError } from './errors';
import { runTool } from './tools/registry';
import { realtimeModel } from './voice/openai';
import { voiceRoutes } from './voice/routes';

const app = new Hono<{ Variables: AuthVars }>();

app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'x-actor'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));

app.get('/', (c) => c.json({ ok: true, name: 'build101-api' }));

app.get('/health', (c) => {
  const e = env();
  return c.json({
    ok: true,
    time: new Date().toISOString(),
    missing_env: missingSupabaseEnv(),
    google: !!e.GOOGLE_MAPS_API_KEY,
    anthropic: !!e.ANTHROPIC_API_KEY,
    openai: !!e.OPENAI_API_KEY,
    realtime_model: realtimeModel(),
    tools: TOOL_NAMES,
  });
});

// 404 de herramienta desconocida antes que el 401 (así se puede descubrir qué existe).
app.post('/tools/:name', async (c, next) => {
  const name = c.req.param('name');
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return c.json({ ok: false, error: { code: 'unknown_tool', message: `No existe la herramienta ${name}.` } }, 404);
  }
  await next();
});

app.post('/tools/:name', requireAuth, async (c) => {
  let body: unknown = {};
  const text = await c.req.text();
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ ok: false, error: { code: 'invalid_input', message: 'El body no es JSON válido.' } }, 400);
    }
  }
  const { status, body: out } = await runTool(c.req.param('name'), body, c.get('ctx'));
  return c.json(out, status as 200);
});

// Voz (PRD 05): token temporal de OpenAI Realtime y cierre con resumen.
app.route('/voice', voiceRoutes());

app.get('/jobs/:id', requireAuth, async (c) => {
  const { db } = c.get('ctx'); // RLS: dueño del job o miembro del viaje
  const { data, error } = await db.from('agent_jobs').select('*').eq('id', c.req.param('id')).maybeSingle();
  if (error) {
    const f = dbError(error, 'agent_jobs');
    // id con formato inválido → 400 en vez de 500
    if (error.code === '22P02') return c.json({ ok: false, error: { code: 'invalid_input', message: 'id inválido.' } }, 400);
    return c.json({ ok: false, error: f.toError() }, 500);
  }
  if (!data) return c.json({ ok: false, error: { code: 'not_found', message: 'No encontré ese job.' } }, 404);
  return c.json({ ok: true, data });
});

app.notFound((c) => c.json({ ok: false, error: { code: 'not_found', message: 'Ruta inexistente.' } }, 404));
app.onError((err, c) => {
  console.error('[api]', err);
  return c.json({ ok: false, error: { code: 'internal', message: err.message } }, 500);
});

export default app;
