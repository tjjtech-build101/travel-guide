// tour_brief: la entrevista previa al tour. Mira el brief (perfiles, viaje, clima, hora, zona) y devuelve SOLO las
// preguntas que cambian el tour de verdad (máx. 3 + "algo que sí o sí"), con un valor por defecto sensato.
// Determinístico a propósito: responde en < 3 s, no gasta tokens y se puede testear.
import { INTEREST_TAGS, type TourBriefResult, type TourQuestion } from '@build101/shared';
import type { GroupProfile, TourBrief } from './tourContext';

const THEME_LABEL: Record<string, string> = {
  historia: 'Historia',
  arquitectura: 'Arquitectura',
  arte: 'Arte',
  museos: 'Museos',
  comida: 'Comida',
  mercados: 'Mercados',
  vida_nocturna: 'Noche',
  musica: 'Música',
  naturaleza: 'Naturaleza',
  playa: 'Playa',
  compras: 'Compras',
  deporte: 'Deporte',
  fotografia: 'Fotos',
  religion: 'Religión',
  tecnologia: 'Tecnología',
  curiosidades: 'Curiosidades',
  para_chicos: 'Para chicos',
};

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

function mealInWindow(startMin: number, durationMin: number): 'almuerzo' | 'merienda' | 'cena' | null {
  const end = startMin + durationMin;
  if (overlaps(startMin, end, 12 * 60, 14 * 60 + 30)) return 'almuerzo';
  if (overlaps(startMin, end, 20 * 60 + 30, 22 * 60 + 30)) return 'cena';
  if (overlaps(startMin, end, 16 * 60 + 30, 18 * 60)) return 'merienda';
  return null;
}

/** Top intereses del grupo (peso ≥ 3), de mayor a menor. */
function groupTop(weights: Record<string, number>): string[] {
  return Object.entries(weights)
    .filter(([, w]) => w >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

/** ¿Los intereses chocan? (2+ personas cuyos favoritos no se pisan). */
function interestsConflict(brief: TourBrief): boolean {
  const tops = brief.members
    .map((m) => Object.entries(m.interests ?? {}).filter(([, w]) => w >= 4).map(([k]) => k))
    .filter((t) => t.length);
  if (tops.length < 2) return false;
  return tops.some((a, i) => tops.some((b, j) => j > i && !a.some((x) => b.includes(x))));
}

export type BriefInputLite = { mode: 'planned' | 'spontaneous' | 'explorer'; duration_min: number; end_point?: { lat: number; lng: number } | null };

export function briefQuestions(brief: TourBrief, group: GroupProfile, input: BriefInputLite): TourQuestion[] {
  const eligible: TourQuestion[] = [];
  const rain = brief.weather?.max_precip_prob ?? 0;

  // 1) Lluvia: cambia todo el recorrido.
  if (rain >= 40) {
    eligible.push({
      id: 'indoor',
      text: `Puede llover durante el tour (${rain}%). ¿Lo armo más cubierto?`,
      why: 'Con lluvia priorizo iglesias, mercados, galerías y museos.',
      kind: 'single',
      options: [
        { value: 'indoor', label: 'Más cubierto' },
        { value: 'mixed', label: 'Mezclado' },
        { value: 'outdoor', label: 'Afuera igual' },
      ],
      default: rain >= 60 ? 'indoor' : 'mixed',
      optional: false,
    });
  }

  // 2) Chicos: si hay pistas pero no sabemos edades.
  if (group.hasKids && !brief.answers.kids) {
    eligible.push({
      id: 'kids',
      text: '¿Van chicos? ¿De qué edad?',
      why: 'Les armo misiones en cada parada y acorto las historias.',
      kind: 'multi',
      options: [
        { value: 'menores_5', label: 'Menos de 5' },
        { value: '5_a_9', label: '5 a 9' },
        { value: '10_a_13', label: '10 a 13' },
        { value: 'adolescentes', label: 'Adolescentes' },
        { value: 'none', label: 'No van chicos' },
      ],
      default: null,
      optional: false,
    });
  }

  // 3) Temas: espontáneo sin perfil claro, o intereses que chocan.
  const top = groupTop(group.weights);
  const clearProfile = brief.members.length === 1 && top.length >= 2;
  if (input.mode !== 'planned' && (!clearProfile || interestsConflict(brief)) && !brief.answers.themes?.length) {
    const options = [...new Set([...top.slice(0, 4), 'historia', 'arquitectura', 'curiosidades', 'comida', 'arte', ...(group.hasKids ? ['para_chicos'] : [])])]
      .filter((t) => (INTEREST_TAGS as readonly string[]).includes(t) || t === 'curiosidades' || t === 'para_chicos')
      .filter((t) => !group.avoid.some((a) => a.toLowerCase().startsWith(t.slice(0, 5))))
      .slice(0, 6);
    eligible.push({
      id: 'themes',
      text: interestsConflict(brief) ? 'Tienen gustos distintos: ¿qué priorizo hoy?' : '¿Qué les tira más hoy?',
      why: 'Elijo las paradas y el ángulo de cada historia según esto.',
      kind: 'multi',
      options: options.map((t) => ({ value: t, label: THEME_LABEL[t] ?? t })),
      default: top.length ? top.slice(0, 2) : ['historia', 'curiosidades'],
      optional: false,
    });
  }

  // 4) Comida: si el tour cruza una comida o es largo.
  const meal = mealInWindow(brief.local.minutes, input.duration_min);
  if ((meal || input.duration_min >= 120) && brief.answers.food_stop === undefined) {
    const diet = group.dietary.length ? ` (busco opciones ${group.dietary.join(', ')})` : '';
    eligible.push({
      id: 'food_stop',
      text: meal ? `El tour cruza la hora de ${meal === 'almuerzo' ? 'almorzar' : meal === 'cena' ? 'cenar' : 'la merienda'}: ¿metemos una parada para comer?${diet}` : `Es un tour largo: ¿metemos una parada para comer o tomar algo?${diet}`,
      why: 'La pongo en el medio o al final, según el recorrido.',
      kind: 'single',
      options: [
        { value: 'true', label: 'Sí, dale' },
        { value: 'false', label: 'No hace falta' },
      ],
      default: meal === 'almuerzo' || meal === 'cena' ? 'true' : 'false',
      optional: false,
    });
  }

  // 5) Energía: tours largos, de noche, o ritmo desconocido.
  const paceKnown = brief.members.some((m) => m.pace);
  if (!brief.answers.energy && (input.duration_min >= 90 || brief.local.minutes >= 18 * 60 || (!paceKnown && input.duration_min >= 60))) {
    eligible.push({
      id: 'energy',
      text: '¿Cómo vienen de energía?',
      why: 'Cambia cuántas paradas meto y cuánto caminan.',
      kind: 'single',
      options: [
        { value: 'tranqui', label: 'Tranqui' },
        { value: 'normal', label: 'Normal' },
        { value: 'a_full', label: 'A full' },
      ],
      default: group.pace === 'relaxed' ? 'tranqui' : group.pace === 'intense' ? 'a_full' : 'normal',
      optional: false,
    });
  }

  // 6) Final: sin punto final, en tours de 45+ min.
  if (!input.end_point && input.duration_min >= 45 && !brief.answers.finish) {
    eligible.push({
      id: 'finish',
      text: '¿Cómo querés terminar?',
      why: 'El cierre es lo que más se recuerda.',
      kind: 'single',
      options: [
        { value: 'view', label: 'Con una vista' },
        { value: 'food', label: 'Comiendo algo' },
        { value: 'start', label: 'Volviendo acá' },
        { value: 'any', label: 'Donde quede' },
      ],
      default: 'any',
      optional: false,
    });
  }

  // 7) Primera vez o ya conocen.
  const pastHere = brief.itinerary.some((i) => i.when === 'past');
  if (brief.told.size === 0 && brief.previousTourPlaceIds.size === 0 && !pastHere && !brief.answers.familiarity) {
    eligible.push({
      id: 'familiarity',
      text: '¿Es la primera vez por acá?',
      why: 'Si ya conocen, voy a lo menos conocido.',
      kind: 'single',
      options: [
        { value: 'first_time', label: 'Primera vez' },
        { value: 'returning', label: 'Ya vine' },
        { value: 'local', label: 'Soy de acá' },
      ],
      default: 'first_time',
      optional: false,
    });
  }

  // 8) Entradas pagas.
  const avoidsMuseums = group.avoid.some((a) => /museo|museum/i.test(a));
  if (!avoidsMuseums && input.duration_min >= 90 && group.budget !== 'high' && group.budget !== 'no_limit' && brief.answers.include_paid_entries === undefined) {
    eligible.push({
      id: 'include_paid_entries',
      text: '¿Entramos a lugares con entrada paga o solo afuera?',
      why: 'Adentro hay más para ver, pero lleva tiempo y plata.',
      kind: 'single',
      options: [
        { value: 'true', label: 'Entramos' },
        { value: 'false', label: 'Solo afuera' },
      ],
      default: 'false',
      optional: false,
    });
  }

  const open: TourQuestion = {
    id: 'notes',
    text: '¿Qué te gustaría que tenga el tour?',
    why: 'Contame con tus palabras qué esperás: lo armo alrededor de eso.',
    kind: 'text',
    options: [],
    default: null,
    optional: true,
    placeholder: 'Ej.: historias de la época de las quintas, algo con misterio, ver casas lindas…',
  };
  const must: TourQuestion = {
    id: 'must_include',
    text: '¿Hay algún lugar que no te quieras perder?',
    why: 'Lo meto en el recorrido sí o sí, aunque no esté en mi lista.',
    kind: 'text',
    options: [],
    default: null,
    optional: true,
    placeholder: 'Ej.: los Portones de Carrasco, la Iglesia de Carrasco',
  };
  return [open, ...eligible.slice(0, 4), must];
}

export function briefSummary(brief: TourBrief, durationMin: number): string {
  const names = brief.members.map((m) => m.name).filter(Boolean) as string[];
  const who = names.length > 1 ? `para ${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names.length ? `para ${names[0]}` : '';
  const where = brief.place?.neighborhood ?? brief.place?.city;
  const w = brief.weather;
  const weather = w ? ` ${w.temp_c != null ? `${Math.round(w.temp_c)} °C` : ''}${w.max_precip_prob >= 40 ? `, ${w.max_precip_prob}% de lluvia` : ', sin lluvia'}.` : '';
  return `Tour de ${durationMin} min${where ? ` en ${where}` : ''}${who ? ` ${who}` : ''}, ${brief.local.text}.${weather}`.replace(/\s+/g, ' ').trim();
}

/** Guía de entrevista para la voz (temas en orden, adaptados: lo que ya se sabe se aclara para no repreguntarlo). */
export function interviewGuide(brief: TourBrief, group: GroupProfile, questions: TourQuestion[]): string[] {
  const names = brief.members.map((m) => m.name).filter(Boolean);
  const top = groupTop(group.weights).slice(0, 3);
  return [
    'Qué esperan del tour hoy y qué los entusiasma (con sus palabras; repreguntá si es vago).',
    'Si hay algún lugar que no se quieran perder: nombre exacto; si es ambiguo, aclaralo.',
    top.length ? `Ya sé que les gusta ${top.join(', ')}: confirmá si hoy va por ahí o prefieren otra cosa.` : 'Qué temas les interesan (historia, arquitectura, curiosidades, comida, arte…).',
    group.avoid.length ? `Ya sé que evitan ${group.avoid.join(', ')}: preguntá si hay algo más que no quieran.` : 'Si hay algo que no quieran (lugares, temas, subidas, multitudes).',
    names.length > 1 ? `Van ${names.join(', ')}: confirmá si se suma alguien más y cómo vienen de energía.` : 'Con quién van y cómo vienen de energía.',
    ...questions.filter((q) => q.id !== 'notes' && q.id !== 'must_include').map((q) => `${q.text} (${q.why})`),
    'Resumí en una frase lo que entendiste y pedí confirmación antes de armarlo.',
  ];
}

export function buildBriefResult(brief: TourBrief, group: GroupProfile, input: BriefInputLite, context: string[]): TourBriefResult {
  const questions = briefQuestions(brief, group, input);
  return {
    summary: briefSummary(brief, input.duration_min),
    city: brief.place?.city ?? null,
    neighborhood: brief.place?.neighborhood ?? null,
    context,
    questions,
    interview: interviewGuide(brief, group, questions),
  };
}
