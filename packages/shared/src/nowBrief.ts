// Frase de Scout en Ahora (docs/AHORA-V2.md). nowBriefRules es la versión por reglas: la usa la app al instante
// y la API cuando no hay Claude. Una sola frase, voseo, ≤ 110 caracteres, con números exactos.
import type { NowBriefSnapshotT } from './tools/nowTools';

/** Largo máximo de la frase (app y API). */
export const NOW_BRIEF_MAX = 110;

export function nowBriefRules(s: NowBriefSnapshotT): string {
  return clampBrief(rawRules(s));
}

function rawRules(s: NowBriefSnapshotT): string {
  const next = s.next?.title?.trim() || null;
  const rain = s.weather?.rain_soon === true;
  switch (s.hero) {
    case 'leave': {
      const to = next ? ` a ${next}` : '';
      const toward = next ? ` para ${next}` : '';
      const walk = s.walk_min ? `: son ${s.walk_min} min a pie` : '';
      if (s.leave_in_min == null) return next ? `Lo próximo es ${next}${walk}.` : `Ya casi es hora de salir.`;
      if (s.leave_in_min < 0) return `Vas ${-s.leave_in_min} min tarde${to}. ¿Aviso al grupo?`;
      if (s.leave_in_min === 0) return `Salí ya${toward}${walk}.`;
      return `Salí en ${s.leave_in_min} min${toward}${walk}.`;
    }
    case 'tour': {
      // Tour en curso: es `current`; próximo: es `next` (con su hora).
      const tour = s.current?.type === 'tour' ? s.current : s.next ?? s.current ?? null;
      const name = tourName(tour?.title);
      const ready = name ? `Tu tour por ${name} está listo.` : `Tu tour está listo.`;
      const startsLater = tour && tour !== s.current && tour.start_time;
      return startsLater ? `${ready} Arranca a las ${tour.start_time!.slice(0, 5)}.` : `${ready} Cuando quieras arrancamos.`;
    }
    case 'current': {
      // La fila "Después" ya dice qué sigue y cuándo salir: acá, algo del lugar.
      const here = s.current?.place_name?.trim() || s.current?.title?.trim() || null;
      return here ? `Disfrutá. ¿Te cuento algo de ${here}?` : `Disfrutá, no hay apuro.`;
    }
    case 'free': {
      // El protagonista ya dice cuánto tiempo libre hay: la frase no lo repite.
      const sug = s.suggestions?.[0];
      if (rain) return `Se viene lluvia: ¿te busco algo bajo techo?`;
      if (sug) return sug.walk_min != null ? `${sug.title} queda a ${sug.walk_min} min: ¿lo sumamos?` : `${sug.title} te puede gustar.`;
      return `¿Te armo algo cerca?`;
    }
    default:
      return `Acá estoy cuando me necesites.`;
  }
}

/** "Tour por Ciudad Vieja" → "Ciudad Vieja" (para no decir "tu tour por Tour por…"). */
function tourName(title: string | null | undefined): string | null {
  const t = title?.trim().replace(/^(tour|recorrido)\s+((por|de|en)\s+)?((la|el|los|las)\s+)?/i, '').trim();
  return t || null;
}

/** Corta a NOW_BRIEF_MAX en un límite de palabra (con "…"). */
export function clampBrief(text: string, max = NOW_BRIEF_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.:;·-]+$/, '')}…`;
}
