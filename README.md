# Visualizador presupuestario

Visor estatico para presentar montos presupuestarios por direccion y bloque,
construido sobre [vinext](https://github.com/cloudflare/vinext) para publicarse
facilmente tanto en Sites como en GitHub Pages.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Flujo de datos del visor

- `data/budget-viewer-data.json` es la fuente canonica del visor.
- `data/sync-source/latest.json` es la ruta fuente simple para publicar datos.
- `public/published-viewer.html` contiene solo la interfaz.
- `scripts/build-published-viewer.mjs` genera:
  - `public/budget-viewer-data.js`
  - `public/budget-viewer-data.json`
  - `public/sync-source/latest.json`
  - `dist/server/index.js`
- `scripts/sync-budget-viewer-data.mjs` actualiza el archivo canonico desde una
  fuente JSON o CSV.
- `scripts/validate-published-viewer.mjs` valida que el visor generado quede
  consistente.

## Sincronizacion automatica con GitHub

Ruta simple recomendada:

- actualiza `data/sync-source/latest.json`
- el workflow de sincronizacion toma esa ruta por defecto
- el build la publica tambien en:
  - `/sync-source/latest.json`

El repositorio incluye tres workflows:

- `.github/workflows/validate-viewer.yml`
  - valida el visor en cada `push` y `pull_request`
- `.github/workflows/sync-budget-viewer.yml`
  - ejecuta sincronizacion diaria y manual
  - si no hay variable externa, usa `data/sync-source/latest.json`
  - reconstruye los archivos publicos
  - hace commit automatico solo si detecta cambios
- `.github/workflows/deploy-pages.yml`
  - publica el visor en GitHub Pages cuando haya `push` a `main`

### Variables opcionales en GitHub

- `BUDGET_SYNC_SOURCE`
  - URL o ruta externa si luego quieres reemplazar la ruta simple interna
- `BUDGET_SYNC_FORMAT`
  - opcional, por ejemplo `json` o `csv`
- `BUDGET_SYNC_TOKEN`
  - secreto opcional si la fuente necesita autenticacion Bearer

## Ejemplos de sincronizacion local

```bash
node scripts/sync-budget-viewer-data.mjs --source data/budget-viewer-data.json
node scripts/build-published-viewer.mjs
node scripts/validate-published-viewer.mjs
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
