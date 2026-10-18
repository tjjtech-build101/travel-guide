// pnpm --filter mobile test:fresh — posición fresca en las herramientas de voz (puro, sin React Native).

import { withFreshPosition } from './freshPositionToolsPure';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.error('✗', msg);
  }
};
const assert = {
  deepEqual: (a: unknown, b: unknown, msg = '') => check(JSON.stringify(a) === JSON.stringify(b), `${msg} ${JSON.stringify(a)} != ${JSON.stringify(b)}`),
  equal: (a: unknown, b: unknown, msg = '') => check(a === b, msg || 'no es el mismo objeto'),
};

const here = { lat: -34.88, lng: -56.08 };

assert.deepEqual(withFreshPosition('search_places', { query: 'café' }, here), { query: 'café', near: here });
const withNear = { query: 'café', near: { lat: 1, lng: 2 } };
assert.equal(withFreshPosition('search_places', withNear, here), withNear, 'respeta el near del modelo');
assert.deepEqual(
  withFreshPosition('route_eta', { mode: 'walk', stops: [{}, { lat: 1, lng: 2 }] }, here),
  { mode: 'walk', stops: [{ lat: here.lat, lng: here.lng }, { lat: 1, lng: 2 }] },
);
const placeStops = { mode: 'walk', stops: [{ google_place_id: 'x' }, { lat: 1, lng: 2 }] };
assert.equal(withFreshPosition('route_eta', placeStops, here), placeStops, 'con place id no toca');
assert.deepEqual(withFreshPosition('search_places', { query: 'a' }, null), { query: 'a' }, 'sin posición no toca');
assert.deepEqual(withFreshPosition('where_am_i', {}, here), { lat: here.lat, lng: here.lng });
assert.deepEqual(withFreshPosition('where_am_i', {}, { ...here, accuracy: 12 }), { lat: here.lat, lng: here.lng, accuracy_m: 12 });
assert.deepEqual(withFreshPosition('search_places', {}, { ...here, accuracy: 12 }), { near: here }, 'near sin accuracy');
const pinned = { lat: 1, lng: 2 };
assert.equal(withFreshPosition('where_am_i', pinned, here), pinned, 'respeta coords del modelo (foco del mapa)');
assert.deepEqual(withFreshPosition('weather', { lat: 1 }, here), { lat: 1 }, 'otras herramientas no');
if (failures) {
  console.error(`fresh: ${failures} fallas`);
  process.exit(1);
}
console.log('fresh: ok');
