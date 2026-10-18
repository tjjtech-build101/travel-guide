import { describe, expect, it } from 'vitest';

import { countryKey, countryZones, deviceTimeZone, isValidTimeZone, legTimeZone, zonedParts, zonedUtc } from './timezone';

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

describe('legTimeZone', () => {
  it('país simple por nombre (es/en), ISO y sin tildes/mayúsculas', () => {
    expect(legTimeZone({ country: 'Uruguay' })).toBe('America/Montevideo');
    expect(legTimeZone({ country: 'UY' })).toBe('America/Montevideo');
    expect(legTimeZone({ country: 'argentina' })).toBe('America/Argentina/Buenos_Aires');
    expect(legTimeZone({ country: 'Perú' })).toBe('America/Lima');
    expect(legTimeZone({ country: 'Japón' })).toBe('Asia/Tokyo');
    expect(legTimeZone({ country: 'Reino Unido' })).toBe('Europe/London');
    expect(legTimeZone({ country: 'France' })).toBe('Europe/Paris');
    expect(legTimeZone({ country: 'EE.UU.', lat: 40.71, lng: -74 })).toBe('America/New_York');
  });

  it('desconocido o vacío → zona del celu', () => {
    expect(legTimeZone({ country: 'Narnia' })).toBe(deviceTimeZone());
    expect(legTimeZone({ country: null })).toBe(deviceTimeZone());
    expect(legTimeZone({})).toBe(deviceTimeZone());
  });

  it('Estados Unidos por longitud', () => {
    const z = (lat: number, lng: number) => legTimeZone({ country: 'Estados Unidos', lat, lng });
    expect(z(40.71, -74.0)).toBe('America/New_York');
    expect(z(25.76, -80.19)).toBe('America/New_York'); // Miami
    expect(z(41.88, -87.63)).toBe('America/Chicago');
    expect(z(39.74, -104.99)).toBe('America/Denver');
    expect(z(33.45, -112.07)).toBe('America/Phoenix');
    expect(z(34.05, -118.24)).toBe('America/Los_Angeles');
    expect(z(36.17, -115.14)).toBe('America/Los_Angeles'); // Las Vegas
    expect(z(21.31, -157.86)).toBe('Pacific/Honolulu');
    expect(z(61.22, -149.9)).toBe('America/Anchorage');
    expect(legTimeZone({ country: 'USA' })).toBe('America/New_York');
  });

  it('otros países con varias zonas', () => {
    expect(legTimeZone({ country: 'Canadá', lat: 49.28, lng: -123.12 })).toBe('America/Vancouver');
    expect(legTimeZone({ country: 'Canada', lat: 45.5, lng: -73.57 })).toBe('America/Toronto');
    expect(legTimeZone({ country: 'México', lat: 21.16, lng: -86.85 })).toBe('America/Cancun');
    expect(legTimeZone({ country: 'Mexico', lat: 19.43, lng: -99.13 })).toBe('America/Mexico_City');
    expect(legTimeZone({ country: 'mexico', lat: 32.51, lng: -117.04 })).toBe('America/Tijuana');
    expect(legTimeZone({ country: 'Brasil', lat: -22.9, lng: -43.2 })).toBe('America/Sao_Paulo');
    expect(legTimeZone({ country: 'Brazil', lat: -3.1, lng: -60.02 })).toBe('America/Manaus');
    expect(legTimeZone({ country: 'Brasil', lat: -27.6, lng: -48.5 })).toBe('America/Sao_Paulo'); // Florianópolis
    expect(legTimeZone({ country: 'Australia', lat: -33.87, lng: 151.21 })).toBe('Australia/Sydney');
    expect(legTimeZone({ country: 'Australia', lat: -37.81, lng: 144.96 })).toBe('Australia/Melbourne');
    expect(legTimeZone({ country: 'Australia', lat: -27.47, lng: 153.03 })).toBe('Australia/Brisbane');
    expect(legTimeZone({ country: 'Australia', lat: -31.95, lng: 115.86 })).toBe('Australia/Perth');
    expect(legTimeZone({ country: 'Rusia', lat: 55.75, lng: 37.62 })).toBe('Europe/Moscow');
    expect(legTimeZone({ country: 'Indonesia', lat: -8.65, lng: 115.22 })).toBe('Asia/Makassar'); // Bali
    expect(legTimeZone({ country: 'Indonesia', lat: -6.2, lng: 106.85 })).toBe('Asia/Jakarta');
    expect(legTimeZone({ country: 'Chile', lat: -33.45, lng: -70.67 })).toBe('America/Santiago');
    expect(legTimeZone({ country: 'Chile', lat: -27.1, lng: -109.35 })).toBe('Pacific/Easter');
    expect(legTimeZone({ country: 'España', lat: 40.42, lng: -3.7 })).toBe('Europe/Madrid');
    expect(legTimeZone({ country: 'España', lat: 28.12, lng: -15.43 })).toBe('Atlantic/Canary');
    expect(legTimeZone({ country: 'Portugal', lat: 37.74, lng: -25.67 })).toBe('Atlantic/Azores');
    expect(legTimeZone({ country: 'Ecuador', lat: -0.74, lng: -90.31 })).toBe('Pacific/Galapagos');
  });

  it('todas las zonas del mapa existen en Intl', () => {
    const zones = countryZones();
    expect(zones.length).toBeGreaterThan(70);
    for (const z of zones) expect(isValidTimeZone(z), z).toBe(true);
    expect(legTimeZone({ country: 'Emiratos Árabes Unidos' })).toBe('Asia/Dubai');
    expect(legTimeZone({ country: 'Corea del Sur' })).toBe('Asia/Seoul');
  });

  it('countryKey normaliza', () => {
    expect(countryKey(' Estados Unidos ')).toBe('estadosunidos');
    expect(countryKey('EE.UU.')).toBe('eeuu');
    expect(countryKey('Perú')).toBe('peru');
  });
});

describe('zonedParts', () => {
  it('Montevideo es UTC−3 todo el año', () => {
    expect(zonedParts(Date.parse('2026-10-18T13:30:45Z'), 'America/Montevideo')).toEqual({ date: '2026-10-18', minutes: 630, seconds: 45 });
    expect(zonedParts(Date.parse('2026-01-15T13:30:00Z'), 'America/Montevideo').minutes).toBe(630);
  });

  it('medianoche UTC cae el día anterior en Montevideo', () => {
    expect(zonedParts(Date.parse('2026-10-19T00:00:00Z'), 'America/Montevideo')).toEqual({ date: '2026-10-18', minutes: 21 * 60, seconds: 0 });
  });

  it('medianoche local da 0 minutos (no 24:00)', () => {
    expect(zonedParts(Date.parse('2026-10-18T03:00:00Z'), 'America/Montevideo')).toEqual({ date: '2026-10-18', minutes: 0, seconds: 0 });
  });

  it('Europe/Paris con DST: UTC+1 en invierno, UTC+2 en verano', () => {
    expect(zonedParts(Date.parse('2026-03-29T00:59:00Z'), 'Europe/Paris').minutes).toBe(1 * 60 + 59);
    expect(zonedParts(Date.parse('2026-03-29T01:00:00Z'), 'Europe/Paris').minutes).toBe(3 * 60);
    expect(zonedParts(Date.parse('2026-10-25T00:59:00Z'), 'Europe/Paris').minutes).toBe(2 * 60 + 59);
    expect(zonedParts(Date.parse('2026-10-25T01:00:00Z'), 'Europe/Paris').minutes).toBe(2 * 60);
  });

  it('zona inválida → no explota (usa la del celu)', () => {
    expect(() => zonedParts(Date.now(), 'Nope/Nada')).not.toThrow();
  });
});

describe('zonedUtc', () => {
  it('10:30 en Montevideo = 13:30Z', () => {
    expect(iso(zonedUtc('2026-10-18T10:30', 'America/Montevideo'))).toBe('2026-10-18T13:30:00.000Z');
    expect(iso(zonedUtc('2026-10-18 10:30', 'America/Montevideo'))).toBe('2026-10-18T13:30:00.000Z');
  });

  it('rechaza basura', () => {
    expect(zonedUtc('ayer', 'America/Montevideo')).toBeNull();
    expect(zonedUtc('2026-13-01T10:00', 'America/Montevideo')).toBeNull();
    expect(zonedUtc('2026-10-18T25:00', 'America/Montevideo')).toBeNull();
  });

  it('America/New_York: EDT en octubre, EST en diciembre', () => {
    expect(iso(zonedUtc('2026-10-18T10:00', 'America/New_York'))).toBe('2026-10-18T14:00:00.000Z');
    expect(iso(zonedUtc('2026-12-18T10:00', 'America/New_York'))).toBe('2026-12-18T15:00:00.000Z');
  });

  it('Europe/Paris alrededor de los cambios de hora', () => {
    expect(iso(zonedUtc('2026-03-28T12:00', 'Europe/Paris'))).toBe('2026-03-28T11:00:00.000Z');
    expect(iso(zonedUtc('2026-03-29T12:00', 'Europe/Paris'))).toBe('2026-03-29T10:00:00.000Z');
    expect(iso(zonedUtc('2026-03-29T01:30', 'Europe/Paris'))).toBe('2026-03-29T00:30:00.000Z');
    expect(iso(zonedUtc('2026-03-29T03:30', 'Europe/Paris'))).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 no existe: se corre a 03:30.
    expect(iso(zonedUtc('2026-03-29T02:30', 'Europe/Paris'))).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 pasa dos veces: la primera (CEST).
    expect(iso(zonedUtc('2026-10-25T02:30', 'Europe/Paris'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(zonedUtc('2026-10-25T12:00', 'Europe/Paris'))).toBe('2026-10-25T11:00:00.000Z');
  });

  it('ida y vuelta con zonedParts', () => {
    for (const tz of ['America/Montevideo', 'Europe/Paris', 'America/New_York', 'Asia/Kathmandu', 'Australia/Sydney']) {
      for (const local of ['2026-01-10T08:15', '2026-04-01T23:59', '2026-07-20T00:00', '2026-11-02T13:45']) {
        const t = zonedUtc(local, tz);
        const p = zonedParts(t!, tz);
        const hh = String(Math.floor(p.minutes / 60)).padStart(2, '0');
        const mm = String(p.minutes % 60).padStart(2, '0');
        expect(`${p.date}T${hh}:${mm}`).toBe(local);
      }
    }
  });
});
