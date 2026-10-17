import { describe, expect, it } from 'vitest';
import { fetchForecast, MAX_FORECAST_DAYS } from './openMeteo';

describe('fetchForecast', () => {
  it('fecha a más de 16 días → available:false sin pegarle a la red', async () => {
    const far = new Date(Date.now() + (MAX_FORECAST_DAYS + 5) * 86_400_000).toISOString().slice(0, 10);
    const r = await fetchForecast({ lat: -34.9, lng: -56.2, date_from: far, date_to: far });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
