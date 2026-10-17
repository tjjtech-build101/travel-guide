# Setup para el equipo (sábado 17/10)

## 1. Clonar e instalar (10 min)
```bash
git clone https://github.com/tjjtech-build101/travel-guide.git && cd travel-guide
npm i -g pnpm            # pnpm 12
pnpm install
pnpm approve-builds esbuild   # si pnpm lo pide
```

## 2. Variables de entorno
Pedile a Juan el archivo **secretos-equipo.txt** (por privado, nunca al repo) y copiá cada bloque a:
- `apps/api/.env`
- `apps/mobile/.env`

Todo apunta a la infra compartida:
- **Supabase (nube):** `https://veavkvhxmzzkgxhkqrub.supabase.co`, con los usuarios demo Juan, Ana, Leo y Sofi (`<nombre>@demo.build101.dev` / `build101-demo`).
- **API (Vercel):** https://travel-guide-api-ten.vercel.app (`/health` muestra qué keys faltan).

## 3. App en el simulador de iOS (arrancalo YA: tarda 15–25 min)
```bash
cd apps/mobile
npx expo run:ios --device "iPhone 17 Pro"     # o el simulador que tengas
```
Después, para el día a día: `pnpm dev:mobile` (Metro) y abrís la app "Compañero". Login: "Entrar como demo".

## 4. API local (si tu PRD toca la API)
```bash
pnpm dev:api            # http://localhost:8787, usa apps/api/.env (base de la nube)
```
Para que la app use tu API local, en `apps/mobile/.env` poné `EXPO_PUBLIC_API_URL=http://<tu-ip>:8787`.

## 5. Reglas de trabajo
- **Antes de programar:** leé `CLAUDE.md`, `docs/CONTRACTS.md` y tu PRD en `docs/prd/`. Tu Claude también.
- **Una rama por PRD** (`prd-05-voz`, …), PRs chicos y merge a `main` seguido. Marcá el PRD en Notion: En curso → Hecho.
- **Migraciones:** la red de FIUM bloquea Postgres, así que `supabase db push` no anda. Una migración nueva se crea en `supabase/migrations/`, se avisa al equipo y una sola persona la aplica: `pnpm db:bundle --since <version>` arma `supabase/.temp/bundle.sql` (una transacción que además la registra en `schema_migrations`), `pbcopy < supabase/.temp/bundle.sql` y se pega y corre en el SQL Editor (https://supabase.com/dashboard/project/veavkvhxmzzkgxhkqrub/sql/new). Para ver qué hay aplicado: `select version, name from supabase_migrations.schema_migrations order by 1;`.
- **Deploy de la API:** `npx vercel deploy --prod --scope tjj-tech` desde la raíz (o pedíselo a Juan).
- **Claude (Anthropic):** saldo muy chico en la key actual. Usá la cuenta del evento en cuanto esté. Probá con mocks y hacé pocas corridas reales.
- **Ningún P1 hasta que el P0 corra de punta a punta.** Primer recorrido de punta a punta: 18:00.

## Carriles
| Carril | Quién | PRDs |
|---|---|---|
| Voz y nativo | Sistemas #2 | 05 Voz → 07 Tour en vivo → 08 Cámara |
| Contenido y tours | Data | 06 Tours + contenido curado → 09 Simulador GPS → 16 Clima/eventos |
| App y producto | Agentes de Juan → Juan desde 17:30 | 04 Multiplayer → 03 Mapa 3D → 10 Onboarding |
