import { describe, expect, it } from 'vitest';
import { checkNarration, quoteInText, sentenceClaims, sourcesFor, splitSentences, stripCitations, type CitedFact } from './tourCheck';

const facts: CitedFact[] = [
  { id: 'f1', text: 'El Teatro Solís se inauguró en 1856', source_url: 'https://a.uy/solis' },
  { id: 'f2', text: 'El nombre homenajea a Juan Díaz de Solís, navegante del siglo XVI', source_url: 'https://b.uy/nombre' },
  { id: 'f3', text: 'La sala tiene capacidad para 1.500 personas', source_url: 'https://a.uy/solis' },
];

describe('splitSentences', () => {
  it('corta por puntuación final sin romper abreviaturas de números', () => {
    expect(splitSentences('Hola. ¿Ven eso? ¡Miren! Tiene 1.500 lugares.')).toEqual(['Hola.', '¿Ven eso?', '¡Miren!', 'Tiene 1.500 lugares.']);
  });
});

describe('sentenceClaims', () => {
  it('años, números, siglos y nombres (no la primera palabra ni interjecciones)', () => {
    const c = sentenceClaims('Mirá: en 1856 abrió con 1.500 lugares, en el siglo XIX, por Juan.', new Set());
    expect(c.map((x) => x.value)).toEqual(expect.arrayContaining(['1856', '1500', 'XIX', 'Juan']));
    expect(c.map((x) => x.value)).not.toContain('Mirá');
  });
  it('ignora nombres permitidos (el grupo, la ciudad)', () => {
    expect(sentenceClaims('Fijate, Ana, qué linda Montevideo.', new Set(['ana', 'montevideo']))).toEqual([]);
  });
});

describe('checkNarration', () => {
  it('deja lo respaldado (aunque la cita apunte mal), borra lo inventado y saca las marcas', () => {
    const text =
      'Fijense en esas columnas. Se inauguró en 1856 [f1]. El nombre viene de Juan Díaz de Solís [f3]. En 1999 lo visitó Napoleón [f1]. Adentro entran 1.500 personas.';
    const r = checkNarration(text, facts, []);
    expect(r.text).toBe('Fijense en esas columnas. Se inauguró en 1856. El nombre viene de Juan Díaz de Solís. Adentro entran 1.500 personas.');
    expect(r.dropped).toEqual(['En 1999 lo visitó Napoleón.']);
    expect([...r.cited].sort()).toEqual(['f1', 'f2', 'f3']);
  });
  it('sin datos duros no pide cita', () => {
    const r = checkNarration('Respiren hondo y miren para arriba.', facts, []);
    expect(r.text).toBe('Respiren hondo y miren para arriba.');
    expect(r.dropped).toEqual([]);
  });
  it('texto vacío o null', () => {
    expect(checkNarration(null, facts, []).text).toBe('');
  });
});

describe('sourcesFor / stripCitations', () => {
  it('solo las fuentes citadas, sin repetir URL', () => {
    const s = sourcesFor(facts, new Set(['f1', 'f3']), 'Teatro Solís');
    expect(s).toEqual([{ title: 'Teatro Solís', url: 'https://a.uy/solis' }]);
  });
  it('saca marcas sin tocar el resto', () => {
    expect(stripCitations('Caminamos 4 minutos [f0].')).toBe('Caminamos 4 minutos.');
  });
});

describe('quoteInText', () => {
  const page = 'El Teatro Solís —el más antiguo del país— fue inaugurado el 25 de agosto de 1856 con la ópera Ernani de Verdi.';
  it('acepta la cita textual con otras comillas/acentos/espacios', () => {
    expect(quoteInText('el mas antiguo del pais— fue inaugurado el 25 de agosto de 1856', page)).toBe(true);
  });
  it('acepta un tramo largo aunque la cita venga con un final distinto', () => {
    expect(quoteInText('fue inaugurado el 25 de agosto de 1856 con la ópera Ernani de Verdi, un éxito total', page)).toBe(true);
  });
  it('rechaza lo que no está', () => {
    expect(quoteInText('Fue diseñado por Antoni Gaudí en persona en 1900.', page)).toBe(false);
    expect(quoteInText('1856', page)).toBe(false); // demasiado corta para probar algo
  });
});
