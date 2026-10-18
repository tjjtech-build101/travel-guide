import { describe, expect, it } from 'vitest';
import { emptyUsage } from './schemas';
import { finishStops, verifyPoints, type IndoorResearchOutT } from './indoorTour';

const PAGE = 'El Museo Torres García abrió en 1955. En la planta baja se exhibe el Autorretrato de 1902. Los juguetes de madera fueron creados en Nueva York.';
const fact = (text: string, quote: string, url = 'https://museo.test/coleccion') => ({ text, quote, source_url: url, source_title: 'Museo', kind: 'detail' as const });

const POINTS: IndoorResearchOutT['points'] = [
  { name: 'Autorretrato', where: 'Planta baja', look_at: 'Un óleo oscuro', facts: [fact('El Autorretrato es de 1902', 'se exhibe el Autorretrato de 1902')] },
  { name: 'Juguetes', where: 'Primer piso', look_at: 'Juguetes de madera pintados', facts: [fact('Los juguetes se crearon en Nueva York', 'Los juguetes de madera fueron creados en Nueva York')] },
  // Cita inventada (no está en la página) → afuera, y el punto se cae por quedar sin datos.
  { name: 'Sala oculta', where: 'Sótano', look_at: '—', facts: [fact('La sala oculta es de 1800', 'una sala secreta de 1800')] },
  // Página que no se puede bajar → verificación de Claude con web_fetch.
  { name: 'Patio', where: 'Al fondo', look_at: 'Un patio', facts: [fact('El patio tiene un mural', 'un mural en el patio', 'https://js.test/patio')] },
];

const deps = {
  fetchPageText: async (url: string) => (url.includes('museo.test') ? PAGE : null),
  verifyFact: async () => ({ supported: true, quote: 'un mural en el patio', usage: emptyUsage() }),
  judge: async (_v: string, pairs: { id: string }[]) => ({ supported: new Set(pairs.map((p) => p.id)), usage: emptyUsage() }),
};

describe('tour interno · verifyPoints', () => {
  it('la cita tiene que estar en la página; sin página, web_fetch de Claude; puntos sin datos se caen', async () => {
    const r = await verifyPoints('Museo Torres García', POINTS, deps, emptyUsage());
    expect(r.points.map((p) => p.name)).toEqual(['Autorretrato', 'Juguetes', 'Patio']);
    expect(r.points.map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);
    expect(r).toMatchObject({ verified: 3, rejected: 1 });
    expect(r.points[0].facts[0]).toMatchObject({ id: 'f1', quote: 'se exhibe el Autorretrato de 1902' });
  });

  it('el juez puede descartar un dato aunque la cita esté', async () => {
    const r = await verifyPoints('Museo', POINTS.slice(0, 2), { ...deps, judge: async () => ({ supported: new Set(['c2']), usage: emptyUsage() }) }, emptyUsage());
    expect(r.points.map((p) => p.name)).toEqual(['Juguetes']);
  });
});

describe('tour interno · finishStops', () => {
  it('borra oraciones con datos sin respaldo, saca las marcas y arma nav/fuentes', async () => {
    const v = await verifyPoints('Museo Torres García', POINTS, deps, emptyUsage());
    const stops = finishStops('Museo Torres García', v.points, {
      title: 'Torres García por dentro',
      stops: [
        { id: 'p1', narration_short: 'Mirá este óleo oscuro. El Autorretrato es de 1902 [f1]. Lo pintó en 1899 en Barcelona.', narration_more: '', transition_to_next: 'Ahora, a jugar.', nav_to_next: 'Subí al primer piso.' },
        { id: 'p2', narration_short: 'Estos juguetes se crearon en Nueva York [f1].', narration_more: '', transition_to_next: '', nav_to_next: '' },
        { id: 'p3', narration_short: 'El patio tiene un mural [f1].', narration_more: '', transition_to_next: '', nav_to_next: '' },
      ],
    });
    expect(stops).toHaveLength(3);
    expect(stops[0].narration_short).toBe('Mirá este óleo oscuro. El Autorretrato es de 1902.');
    expect(stops[0].dropped).toBe(1);
    expect(stops[0].look_at).toBe('Planta baja. Un óleo oscuro');
    expect(stops[0].sources).toEqual([{ title: 'Museo', url: 'https://museo.test/coleccion' }]);
    // Sin nav del escritor: se arma con el "dónde" de la próxima; la última no tiene.
    expect(stops[1].nav_to_next).toBe('Seguimos a Patio: Al fondo.');
    expect(stops[2].nav_to_next).toBeNull();
  });
});
