import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, toRealtimeTools, toolDefs } from '@build101/shared';
import { handlers, runTool } from './registry';
import { toClaudeTools } from './claude';
import type { ToolCtx } from './types';

const fakeCtx = { userId: '00000000-0000-0000-0000-000000000002', actor: 'user', db: {}, admin: {} } as unknown as ToolCtx;

describe('registro de herramientas', () => {
  it('cada nombre de TOOL_NAMES tiene schema, handler y JSON Schema type:object', () => {
    const realtime = toRealtimeTools();
    expect(realtime.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const name of TOOL_NAMES) {
      expect(toolDefs[name].input, name).toBeDefined();
      expect(typeof handlers[name], name).toBe('function');
      const tool = realtime.find((t) => t.name === name)!;
      expect(tool.type).toBe('function');
      expect((tool.parameters as { type?: string }).type, name).toBe('object');
      expect(tool.parameters).not.toHaveProperty('$schema');
    }
    expect(Object.keys(handlers).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('toClaudeTools arma una herramienta por nombre con input_schema object', () => {
    const tools = toClaudeTools(fakeCtx);
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const t of tools) expect((t as unknown as { input_schema: { type?: string } }).input_schema.type).toBe('object');
  });

  it('herramienta desconocida → 404', async () => {
    const r = await runTool('nope', {}, fakeCtx);
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });

  it('input inválido → 400 invalid_input con issues', async () => {
    const r = await runTool('add_block', { trip_id: 'x' }, fakeCtx);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    if (!r.body.ok) expect(Array.isArray(r.body.error.issues)).toBe(true);
  });

  it('validaciones en el handler (sin DB): search_places sin query ni near → 400', async () => {
    const r = await runTool('search_places', {}, fakeCtx);
    expect(r.status).toBe(400);
  });

  it('get_day_plan sin day_id ni trip_id+date → 400', async () => {
    const r = await runTool('get_day_plan', { trip_id: '10000000-0000-0000-0000-000000000001' }, fakeCtx);
    expect(r.status).toBe(400);
  });
});
