// Decide si ofrecer "Generar tour" para un bloque del itinerario (OpenAI Decisions API, predicate).
import type { ToolInput } from '@build101/shared';
import { predicate } from '../openai/decisions';
import type { ToolCtx, ToolOk } from './types';

const INSTRUCTIONS =
  'Tiene sentido ofrecerle a esta persona un tour guiado A PIE, con varias paradas narradas, para este bloque del itinerario? ' +
  'Respondé que SÍ para un museo, un barrio o zona histórica, un parque grande, una ruta de arquitectura o algo para explorar caminando. ' +
  'Respondé que NO para una comida puntual en un restaurante, un traslado, un alojamiento (check-in/check-out), o cualquier bloque sin un lugar fijo para recorrer.';

export function blockText(input: ToolInput<'should_generate_tour'>): string {
  return [
    `Bloque del itinerario: "${input.block_title}" (tipo: ${input.block_type}).`,
    input.place_name ? `Lugar: ${input.place_name}.` : '',
    input.description ? `Descripción: ${input.description}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function should_generate_tour(input: ToolInput<'should_generate_tour'>, _ctx: ToolCtx): Promise<ToolOk> {
  const probability = await predicate(blockText(input), 'should_tour', INSTRUCTIONS);
  return { ok: true, data: { should_tour: probability >= 0.5, probability } };
}
