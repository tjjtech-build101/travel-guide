import { describe, expect, it } from 'vitest';
import { blockText } from './should_generate_tour';

describe('blockText', () => {
  it('arma el texto con lo que haya, sin campos vacíos', () => {
    expect(blockText({ block_title: 'Museo Torres García', block_type: 'activity' })).toBe(
      'Bloque del itinerario: "Museo Torres García" (tipo: activity).',
    );
  });

  it('incluye lugar y descripción si vienen', () => {
    const t = blockText({
      block_title: 'Almuerzo',
      block_type: 'meal',
      place_name: 'Mercado del Puerto',
      description: 'Parrilla tradicional',
    });
    expect(t).toContain('Lugar: Mercado del Puerto.');
    expect(t).toContain('Descripción: Parrilla tradicional.');
  });
});
