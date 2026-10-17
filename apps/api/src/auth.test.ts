import { describe, expect, it } from 'vitest';
import { bearer, parseActor } from './auth';
import { newUndoToken } from './feed';
import app from './index';

describe('auth helpers', () => {
  it('x-actor: default user, agent solo si dice agent', () => {
    expect(parseActor(undefined)).toBe('user');
    expect(parseActor('AGENT')).toBe('agent');
    expect(parseActor('robot')).toBe('user');
  });
  it('bearer', () => {
    expect(bearer('Bearer abc.def')).toBe('abc.def');
    expect(bearer('Basic x')).toBeNull();
  });
  it('undo_token = 24 bytes base64url', () => {
    const t = newUndoToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(t, 'base64url').length).toBe(24);
  });
});

describe('HTTP', () => {
  it('herramienta desconocida → 404', async () => {
    const res = await app.request('/tools/no_existe', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });
  it('sin JWT → 401', async () => {
    process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
    process.env.SUPABASE_ANON_KEY ||= 'x';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x';
    const res = await app.request('/tools/add_block', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });
  it('/health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
