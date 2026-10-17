// Smoke barato de la FORMA de las requests del planificador (no arma un viaje).
// 1) esqueleto con effort low sobre una conversación mínima, 2) un runner con las 5 herramientas reales
// pero pidiendo que no las use (valida schemas, thinking, effort, fallbacks y cache_control). ~USD 0.05.
// Uso: cd apps/api && npx tsx scripts/planner-smoke.ts
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { anthropicPlanner, plannerConfig } = await import('../src/agents/llm');
const { PLANNER_TOOLS, compactForPlanner } = await import('../src/agents/planTrip');
const { toClaudeTools } = await import('../src/tools/claude');
const { serviceClient } = await import('../src/supabase');
const { estimateCostUsd } = await import('../src/agents/schemas');

const llm = anthropicPlanner();
const config = { ...plannerConfig(), effort: 'low' as const, maxTokens: 4000, maxIterations: 1 };

const sk = await llm.skeleton({
  system: 'Armá el esqueleto del viaje. Respondé corto.',
  user: 'Hoy es 2026-10-17. Conversación:\nOrganizador: Colonia del Sacramento, 2 días desde el 2026-10-24, solo yo.',
  config,
});
console.log('skeleton OK', JSON.stringify(sk.skeleton).slice(0, 300));
console.log('usage', sk.usage, 'USD', estimateCostUsd(sk.usage));

const admin = serviceClient();
const tools = toClaudeTools({ userId: '00000000-0000-0000-0000-000000000001', actor: 'agent', db: admin, admin }, PLANNER_TOOLS, compactForPlanner);
const res = await llm.fillLeg({
  system: [
    { type: 'text', text: 'Sos un asistente de prueba.', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'NO uses ninguna herramienta. Respondé solo "ok".' },
  ],
  user: 'Respondé "ok" sin usar herramientas.',
  tools: tools as never,
  config,
  signal: new AbortController().signal,
});
console.log('fillLeg OK', res.stop_reason, res.text, 'iter', res.iterations);
console.log('usage', res.usage, 'USD', estimateCostUsd(res.usage));
