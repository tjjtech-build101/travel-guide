import { describe, expect, it } from 'vitest';
import { eventsCacheKey, sanitizeEvents } from './eventsSearch';
import type { EventItemT } from './eventsSchemas';

const ev = (over: Partial<EventItemT> = {}): EventItemT => ({
  title: 'Feria de candombe',
  date: '2026-10-19',
  start_time: '18:00',
  venue: 'Parque Rodó',
  address: null,
  price_text: 'gratis',
  url: 'https://example.com/evento',
  source_url: 'https://im.gub.uy/eventos/candombe',
  ...over,
});

describe('eventsCacheKey', () => {
  it('misma ciudad/fechas (sin importar mayúsculas/espacios) → misma clave', () => {
    const a = eventsCacheKey({ city: 'Montevideo', country: 'UY', date_from: '2026-10-17', date_to: '2026-10-19' });
    const b = eventsCacheKey({ city: ' montevideo ', country: 'uy', date_from: '2026-10-17', date_to: '2026-10-19' });
    expect(a).toBe(b);
  });

  it('ciudad distinta → clave distinta', () => {
    const a = eventsCacheKey({ city: 'Montevideo', date_from: '2026-10-17', date_to: '2026-10-19' });
    const b = eventsCacheKey({ city: 'Buenos Aires', date_from: '2026-10-17', date_to: '2026-10-19' });
    expect(a).not.toBe(b);
  });
});

describe('sanitizeEvents', () => {
  it('descarta eventos fuera del rango de fechas', () => {
    const out = sanitizeEvents([ev({ date: '2026-10-19' }), ev({ date: '2026-11-01' })], '2026-10-17', '2026-10-24');
    expect(out).toHaveLength(1);
  });

  it('descarta eventos sin source_url', () => {
    const out = sanitizeEvents([ev({ source_url: '' }), ev()], '2026-10-17', '2026-10-24');
    expect(out).toHaveLength(1);
  });

  it('corta en 10', () => {
    const many = Array.from({ length: 15 }, (_, i) => ev({ title: `Evento ${i}` }));
    expect(sanitizeEvents(many, '2026-10-17', '2026-10-24')).toHaveLength(10);
  });
});
