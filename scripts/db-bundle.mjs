// Arma un único .sql para pegar en el SQL Editor de Supabase (la red de FIUM bloquea Postgres,
// así que `supabase db push` no anda). Todo va en una transacción: o entra entero o no entra nada.
// Registra cada migración en supabase_migrations.schema_migrations, igual que `db push`.
//
//   pnpm db:bundle                         → todas las migraciones + seed
//   pnpm db:bundle --since 20261017000007  → solo las migraciones desde esa versión (sin seed)
//   pnpm db:bundle --no-seed
//
// Salida: supabase/.temp/bundle.sql (no se commitea).
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migDir = join(root, 'supabase/migrations');
const args = process.argv.slice(2);
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
const withSeed = !args.includes('--no-seed') && !since;

const files = readdirSync(migDir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort()
  .filter((f) => !since || f.split('_')[0] >= since);

const dollar = (s) => `$bundle$${s}$bundle$`;
const parts = [
  '-- Generado por scripts/db-bundle.mjs. Pegar entero en el SQL Editor y correr una sola vez.',
  'begin;',
  'create schema if not exists supabase_migrations;',
  'create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);',
];
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  const name = rest.join('_');
  const sql = readFileSync(join(migDir, f), 'utf8');
  parts.push(`\n-- ===== ${f} =====`, sql);
  parts.push(
    `insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${name}', array[${dollar(sql)}]);`,
  );
}
if (withSeed) parts.push('\n-- ===== seed.sql =====', readFileSync(join(root, 'supabase/seed.sql'), 'utf8'));
parts.push('\ncommit;\n');

const out = join(root, 'supabase/.temp/bundle.sql');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join('\n'));
console.log(`${out}\n${files.length} migraciones${withSeed ? ' + seed' : ''}: ${files.join(', ')}`);
