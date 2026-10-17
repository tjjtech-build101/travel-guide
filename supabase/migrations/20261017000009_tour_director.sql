-- Tour director (PRD 06 v2): el tour guarda el brief con el que se armó y su tesis narrativa.
-- Aditivo: columnas nuevas, nullable, sin cambiar las existentes.
alter table public.tours add column if not exists brief jsonb;   -- {summary, audience, answers, weather, place}
alter table public.tours add column if not exists thesis text;   -- la idea que hilvana el tour, una frase
