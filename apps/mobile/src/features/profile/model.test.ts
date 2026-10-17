// Tests del modelo del perfil (PRD 10 mínimo). `pnpm --filter mobile test:profile` (tsx).
import { ProfilePreferencesPatch } from '@build101/shared';

import {
  completedSections,
  draftFromProfile,
  emptyDraft,
  needsOnboarding,
  nextStars,
  patchFromDraft,
  starsToWeight,
  toggle,
  weightToStars,
} from './model';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} esperado ${b}, vino ${a}`);
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

test('estrellas ↔ pesos 1–5', () => {
  eq([0, 1, 2, 3].map((s) => starsToWeight(s as 0)), [null, 2, 4, 5]);
  eq([0, 1, 2, 3, 4, 5].map(weightToStars), [0, 1, 1, 2, 2, 3]);
  eq(weightToStars(null), 0);
});
test('tocar un interés cicla 0 → 1 → 2 → 3 → 0', () => {
  eq([nextStars(0), nextStars(1), nextStars(2), nextStars(3)], [1, 2, 3, 0]);
});
test('toggle agrega y saca', () => {
  eq(toggle(['a'], 'b'), ['a', 'b']);
  eq(toggle(['a', 'b'], 'a'), ['b']);
});
test('perfil vacío → borrador con idioma del locale', () => {
  eq(draftFromProfile(null).languages, ['es']);
  eq(draftFromProfile({ locale: 'en' }).languages, ['en']);
  eq(emptyDraft().interests, {});
});
test('ida y vuelta: perfil → borrador → patch válido (Zod)', () => {
  const profile = {
    interests: { arquitectura: 5, comida: 4, museos: 1, custom_tag: 3 },
    pace: 'relaxed' as const,
    chronotype: 'night' as const,
    budget_level: 'mid' as const,
    travel_style: null,
    dietary: ['vegetariano'],
    avoid: ['multitudes'],
    languages: ['es', 'en'],
    locale: 'es',
  };
  const d = draftFromProfile(profile);
  eq(d.interests, { arquitectura: 3, museos: 1, comida: 2 });
  const patch = patchFromDraft(d, profile.interests);
  // Sin cambios: conserva los pesos exactos y el tag desconocido.
  eq(patch.interests, { custom_tag: 3, arquitectura: 5, museos: 1, comida: 4 });
  ok(ProfilePreferencesPatch.safeParse(patch).success, 'patch válido');
});
test('cambiar estrellas recalcula el peso; 0 estrellas lo saca', () => {
  const d = draftFromProfile({ interests: { comida: 4, arte: 2 } });
  d.interests.comida = 3;
  d.interests.arte = 0;
  d.interests.playa = 1;
  eq(patchFromDraft(d, { comida: 4, arte: 2 }).interests, { comida: 5, playa: 2 });
});
test('sin intereses → null', () => {
  eq(patchFromDraft(emptyDraft()).interests, null);
});
test('secciones completas y needsOnboarding', () => {
  const d = emptyDraft();
  eq(completedSections(d), 1); // idioma por defecto
  d.pace = 'balanced';
  d.interests.historia = 2;
  eq(completedSections(d), 3);
  ok(needsOnboarding({ onboarded_at: null }), 'null → onboarding');
  ok(!needsOnboarding({ onboarded_at: '2026-10-17T12:00:00Z' }), 'ya hecho');
  ok(!needsOnboarding(null), 'sin perfil cargado no redirige');
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('\nTodo OK');
