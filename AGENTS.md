# AGENTS.md — openchamber-ploi

Working rules for this repository. Read together with `CONTEXT.md` (product).

## Stack

- Strict TypeScript (`noUncheckedIndexedAccess`), ESM, no runtime dependency besides `@openchamber/sdk` 2.7.2.
- Work Status section drawn by the app from `GET /status` (`statusSection.source`), plus a rail panel (`src/panel/` → `panel/main.js`) that reads `GET /sites`.
- Bundle: `openchamber-guest-bundle` (Bun 1.3.14, pinned in CI: another Bun minifies with other names and the built-files check fails): panel as a browser IIFE, service with `--node`. Tests: `bun test`. Typecheck: `tsc --noEmit`.

## Commands

```sh
npm run build && npm test && npm run typecheck && bunx openchamber-guest-check
```

Manual service test against the real Ploi account (`scripts/dev-host.mjs` answers `readSettings()` with the token):

```sh
PLOI_API_TOKEN=… node scripts/dev-host.mjs 4597 &
OPENCHAMBER_HOST_CALLBACK_URL=http://127.0.0.1:4597 OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js &
curl -H 'Authorization: Bearer t' 'http://127.0.0.1:4599/status?locale=en&directory=/path/to/project'
fuser -k 4597/tcp 4599/tcp
```

## Conventions

1. **Read-only.** Only Ploi read tools (`list-*`, `get-*`). Never a deploy, restart, update tool, nor `fix-`/`ignore-`/`delete-server-insight`.
2. The Ploi API token comes only from the integration card's `secret` field `api-token`, through `readSettings()` (`src/credentials.ts`), as the SDK intends. Never read another app's config or secrets, never log the token, never send it anywhere but `https://ploi.io/api/mcp`, never put it in the section or a page. Missing or refused: `needsConfiguration` on the card and a note in the section; cleared once Ploi answers. The `token` block in the manifest exists only because OpenChamber requires an auth block; its "API token" field is required by the card, capped at 800 characters by OpenChamber 2.7.2 (a Ploi token is longer), and unused (a service cannot read it): the description tells the user to type any short word. Never declare `token.account`, or OpenChamber would send that word to Ploi as a token and refuse it. Drop it once OpenChamber accepts an integration with settings only.
3. `src/status-view.ts` and `src/sites-payload.ts` stay pure. Every answer must pass `guestStatusViewSchema` (`test/status-view.test.ts`): 16 rows max, 200 characters per text, unique ids.
4. All visible text goes through `translator()` (`src/i18n.ts`); every key exists in English and French (tested).
5. Failures are rows, never a 500: a missing or refused token, an unreachable Ploi or an unreachable site is a note or a red dot.
6. The panel never polls faster than once a minute, and only while visible; it re-reads when the service emits `sites-updated` (checks or insights that finished after the answer). Only exception: while `insights` is still `null`, it reads again every 8 s until they arrive. Panel layout: `main.ts` holds the state and the site list, `insights-view.ts` the Insights tab, `service-client.ts` every service call. Logic that decides anything lives in `model.ts` and `insights-model.ts` (tested), styles in `view.ts` with `--oc-*` variables only.
7. Insight explanations are HTML: `src/insights.ts` parses them with regexes, never renders them. When Ploi changes the markup, refresh `test/fixtures/insight-*.html` from `get-server-insight` and adapt the parser.
8. "Fix the findings" only starts a session (`host.startSession`, capabilities `sessions` + `prompt`) after a click; the first message comes from `src/fix-prompt.ts` (tested, under 16 000 characters) and always says not to deploy.
9. The only file the service writes is `~/.config/openchamber-ploi/preferences.json` (`src/preferences.ts`; the former `openchamber-sites` file is only read): hidden site ids, nothing else. Hidden sites are never checked nor shown, the open project's included.
10. Instructions for agents hold only stable facts (ids, server, branch), never live check results: each change rewrites them.

## Git

- No commits by the agent: the user commits themselves.
- Conventional Commits (`feat(status): …`).
