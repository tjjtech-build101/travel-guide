// should_generate_tour (OpenAI Decisions API, ~150ms): decide si mostrar "Generar tour" en un bloque.
// staleTime Infinity: la decisión no cambia para el mismo bloque, se pide una sola vez por sesión.
import type { BlockType } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';

import { callTool } from '../../lib/api';

type ShouldTourResult = { should_tour: boolean; probability: number };

export function useShouldGenerateTour(
  block: { id: string; title: string; type: BlockType; place_name: string | null; description: string | null } | null,
) {
  return useQuery({
    queryKey: ['should_generate_tour', block?.id],
    enabled: !!block,
    staleTime: Infinity,
    queryFn: async (): Promise<ShouldTourResult> => {
      const res = await callTool<'should_generate_tour', ShouldTourResult>('should_generate_tour', {
        block_title: block!.title,
        block_type: block!.type,
        place_name: block!.place_name ?? undefined,
        description: block!.description ?? undefined,
      });
      // Si la API de OpenAI no está configurada todavía (OPENAI_API_KEY vacía) o falla: no se muestra
      // el botón en vez de romper la pantalla (nunca pantalla vacía/rota, regla 7 de CLAUDE.md).
      return res.ok ? res.data : { should_tour: false, probability: 0 };
    },
  });
}
