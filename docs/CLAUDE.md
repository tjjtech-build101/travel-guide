# build101 — Guía de viaje con IA

Specs (leer antes de tocar algo). Copias locales en `docs/`; fuente de verdad del producto en Notion:
- Producto: [docs/PRODUCT.md](PRODUCT.md) · https://www.notion.so/3fc81924a5c681f1be4ce49704ebf276
- Arquitectura: [docs/ARCHITECTURE.md](ARCHITECTURE.md) · https://www.notion.so/3fc81924a5c681e0a1b8f8b260816f70
- Contratos: [docs/CONTRACTS.md](CONTRACTS.md) (incluida "Cambios v1.1") · https://www.notion.so/3fc81924a5c6814087e4e83bdd9916ef
- PRDs: [docs/README.md](README.md) (índice) y `docs/prd/NN-*.md` · base "PRDs" en Notion

## Reglas
1. Nombres de tablas/campos/herramientas EXACTOS de Contratos. Cambio de contrato = migración + `packages/shared` + nota en Notion/`docs/CONTRACTS.md`.
2. Las herramientas viven en el backend (`POST /tools/:name`, Zod de `packages/shared`). Nada de lógica de herramientas en el proveedor de voz.
3. El agente propone en lo compartido y aplica en lo personal; toda acción escribe `activity_feed` y devuelve `undo_token`.
4. Sync por Supabase Realtime. Nunca polling (excepción: seguidor web, PRD 27).
5. Todo lo que use ubicación consume `LocationProvider` (real | simulated).
6. Secretos solo en `apps/api`. El celu nunca ve keys de OpenAI/Anthropic/Google.
7. UI en español rioplatense (voseo). Nunca pantalla vacía: siempre estado vacío, cargando y error.
8. No se arranca un P1 hasta que el P0 corra punta a punta.
9. App: seguí `apps/mobile/AGENTS.md` (Expo SDK 58: consultá la doc versionada, `npx expo install` para paquetes).
10. Antes de arrancar un PRD, marcalo "En curso" en Notion; al terminar, "Hecho".

## Comandos
- `pnpm install` (root) · `pnpm dev:api` (API en :8787) · `pnpm dev:mobile` (Metro para el dev build)
- `pnpm db:start` / `pnpm db:reset` (Supabase local, requiere Docker)
- `pnpm --filter api test` · `pnpm typecheck`
- `cd apps/mobile && npx expo run:ios` (dev build en simulador o `--device`)
