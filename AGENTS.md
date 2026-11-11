# AGENTS.md

Notes for anyone (human or agent) changing Baleh.

## Commands

- `npm run check` (typecheck + oxlint + oxfmt check) and `npm test` must pass; CI runs both.
- `npm run format` to fix formatting. `npm run cf-typegen` after any binding change.
- Tests run in the Workers runtime; every migration is applied to a fresh DB per test file
  (`test/apply-migrations.ts`). Queues, email and `fetch` are faked; tests never send anything.

## Layout

- `src/` React SPA (`features/<domain>/`, `components/ui/` primitives, `locales/`).
- `worker/` `baleh-web`: `/api/*` router, `ChatRoom` Durable Object, routes, auth, media,
  email and push queue consumers. Everything else is served from static assets.
- `translator/` `baleh-translator`: translation queue consumer, DLQ handler, `*/5` outbox sweeper.
  Own `wrangler.jsonc`; binds `ChatRoom` via `script_name`, so it deploys **after** `baleh-web`.
- `shared/` Zod schemas, languages, media rules, WebSocket protocol (`shared/messages.ts`).
- `migrations/` plain SQL, numbered.

## Invariants (don't break these)

- User id always comes from the server session, never the request. Unknown body fields are
  rejected; every body (including Better Auth's, via a `before` hook) is Zod-validated.
- Writes need `application/json` and a trusted `Origin`.
- Room routes check membership in D1 (`worker/rooms.ts`). Non-members get **404** (same as
  missing room); members hitting owner routes get 403.
- D1 is the only store. `ChatRoom` holds sockets only. Messages are saved, then broadcast,
  then translated; translation never delays the original.
- Sends carry a `clientId`; same-`clientId` retries are no-ops.
- Translations: `(messageId, targetLanguage)` unique, finished rows never overwritten, so jobs
  are idempotent. Pending rows are a transactional outbox swept by cron.
- Message and translation text is stored only as AES-GCM ciphertext in `sealedText`
  (`worker/sealed.ts`, key `MESSAGE_KEY`, AAD = the row it belongs to). Plaintext columns stay
  empty; never read or write them except for legacy rows, which the sweeper seals. No SQL on
  message text (search, `substr`, `like`): decrypt in code. Missing key fails closed.
- Media is never public. Uploads are presigned R2 PUTs + HMAC token, verified (size, type,
  magic bytes) before recording. R2 objects are **not** removed by D1 cascades; delete in code.
- Invitations bind to the invited (verified) email; only the SHA-256 of the token is stored.
- Push: never include message text. Endpoints restricted to known push services. Only 404/410
  delete a subscription (so a VAPID misconfig can't wipe them all).
- Logs never contain email addresses, links, tokens, push endpoints or keys.
- Better Auth `update-user`, `change-email`, `delete-user` are disabled.
- New passwords (sign-up, change, reset) are checked against Pwned Passwords (k-anonymity,
  fails closed). Tests fake the API in `test/apply-migrations.ts`.
- 2FA is Better Auth `twoFactor` (TOTP + backup codes, stored encrypted). Email OTP paths are disabled.

## Database

- Singular table names, camelCase columns, text ids, ISO 8601 timestamps (matches Better Auth).
- Never edit an applied migration; add one (`npx wrangler d1 migrations create baleh <name>`).
- CI applies remote migrations **before** deploying code, so migrations must be backward
  compatible with the running Worker (keep them additive).
- Auth schema change: edit `worker/auth-options.ts`, `npm run auth:schema`, add the diff as a migration.

## Code conventions

- Imports: `@/` for `src/`, `@shared/` for `shared/`; `import type` for types.
- Named exports only (default exports are lint errors outside config and the Worker entry).
- Files `kebab-case.tsx`, one main PascalCase component each.
- Tailwind with tokens from `src/styles/index.css` (`bg-bg`, `bg-accent`, …). No hard-coded hex
  in components. Merge classes with `cn()`.
- RTL (Persian): logical utilities only (`ms-`, `pe-`, `start-`, `text-start`), never left/right.
  Mirror directional icons with `rtl:-scale-x-100`. Wrap user text in rows with `<bdi>`;
  free-text inputs `dir="auto"`, emails `dir="ltr"`.
- No user-facing English in components: add a key to `src/locales/en.ts` (TS forces it in `fa.ts`),
  use `useI18n().t`. Errors are translated via the locale error map keyed by English text.
- Icon-only buttons use `IconButton` (requires `label`). Touch targets ≥ 44px (`size-11`).
- Server state via TanStack Query + `apiFetch`. TS is `strict` + `noUncheckedIndexedAccess`.

## Config

Vars in `wrangler.jsonc`; secrets via `npx wrangler secret put`, locally in `.dev.vars`
(see `.dev.vars.example`). Key ones: `BETTER_AUTH_SECRET` (rotating signs everyone out),
`MESSAGE_KEY` (Secrets Store binding to `BALEH_MESSAGE_KEY`, shared by both Workers; read with
`await .get()`; tests seed it via `adminSecretsStore`; losing it loses every message, so keep a copy
outside Cloudflare), `SIGNUPS_ENABLED`, `R2_*` (production uploads), `VAPID_*` (push; generate with
`node scripts/generate-vapid-keys.ts`), `TURNSTILE_*` (bot check). With signups off, create
users with `PASSWORD='…' node scripts/create-user.ts <email> <name> [en|fa|ar|de] [--remote]`.

Bindings: `DB` (D1), `CHAT_ROOM` (DO), `MEDIA` (R2), `AI`, `EMAIL`, queues `TRANSLATIONS`,
`ACCOUNT_EMAILS`, `PUSH_NOTIFICATIONS` (+ DLQs), rate limiters `WRITE_LIMITER` (60/user/min)
and `PUSH_LIMITER`. Durable Object class changes need a new `migrations` entry in `wrangler.jsonc`.

## Deploy

CI deploys `main` on push (needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` secrets).
One-time setup: D1 `baleh`, queues (`message-translations`, `-dlq`, `baleh-account-emails`,
`baleh-push-notifications`, `-dlq`), R2 `baleh-media` with PUT CORS for the site origin,
Email Service domain onboarding for `baleh.dev`, secrets above. Ids in `wrangler.jsonc`
belong to the current account. Check configs with `npx wrangler deploy --dry-run`.

## Renaming

"Baleh" is a working name. It lives in `src/config/brand.ts`, `src/locales/*.ts`
(`brand.tagline`), `index.html`, `wrangler.jsonc`, `package.json`, `public/favicon.svg`,
`src/components/brand/logo.tsx`.
