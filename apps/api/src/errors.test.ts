import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { classifyAnthropic, classifyHttp, jobErrorFields, orFallback, toFailure, ToolFailure } from './errors';

const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers());

describe('clasificación de errores de proveedores', () => {
  it('Anthropic sin créditos → provider_no_credits 402', () => {
    const f = classifyAnthropic(apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'));
    expect(f).toMatchObject({ status: 402, code: 'provider_no_credits', provider: 'anthropic' });
  });

  it('Anthropic 401 / 429 / 529', () => {
    expect(classifyAnthropic(apiError(401, 'authentication_error', 'invalid x-api-key'))?.code).toBe('provider_auth');
    expect(classifyAnthropic(apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit'))?.code).toBe('provider_rate_limited');
    expect(classifyAnthropic(apiError(529, 'overloaded_error', 'Overloaded'))?.code).toBe('provider_overloaded');
  });

  it('Anthropic 400 de pedido mal armado no es del proveedor (bug nuestro)', () => {
    expect(classifyAnthropic(apiError(400, 'invalid_request_error', 'messages: field required'))).toBeNull();
  });

  it('OpenAI / Google por status y cuerpo', () => {
    expect(classifyHttp('openai', 429, JSON.stringify({ error: { code: 'insufficient_quota' } }))).toBe('provider_no_credits');
    expect(classifyHttp('openai', 429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } }))).toBe('provider_rate_limited');
    expect(classifyHttp('openai', 401, '{}')).toBe('provider_auth');
    expect(classifyHttp('google', 403, JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Places API (New) has not been used' } }))).toBe(
      'provider_denied',
    );
    expect(classifyHttp('google', 400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.' } }))).toBe('provider_auth');
    expect(classifyHttp('google', 403, JSON.stringify({ error: { message: 'This API requires billing to be enabled' } }))).toBe('provider_no_credits');
  });

  it('toFailure no filtra el mensaje crudo como texto para la persona', () => {
    const f = toFailure(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(f).toMatchObject({ status: 500, code: 'internal' });
    expect(f.message).not.toMatch(/undefined/);
    expect(f.detail).toMatch(/undefined/);
  });

  it('orFallback degrada salvo error fatal', () => {
    expect(orFallback([])(new Error('timeout de Google'))).toEqual([]);
    expect(() => orFallback([])(new ToolFailure(402, 'provider_no_credits', 'x', undefined, 'google'))).toThrow(ToolFailure);
  });

  it('jobErrorFields guarda código y proveedor', () => {
    expect(jobErrorFields(apiError(400, 'invalid_request_error', 'Your credit balance is too low'))).toMatchObject({
      error_code: 'provider_no_credits',
      error_provider: 'anthropic',
    });
  });
});
