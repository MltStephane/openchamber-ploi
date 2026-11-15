# AGENTS.md — openchamber-ploi

Working rules for this repository. Read together with `CONTEXT.md` (product).

## Stack

- Strict TypeScript (`noUncheckedIndexedAccess`), ESM, no runtime dependency besides `@openchamber/sdk` 2.7.2.
- Work Status section drawn by the app from `GET /status` (`statusSection.source`), plus a rail panel (`src/panel/` → `panel/main.js`) that reads `GET /sites`.
- Bundle: `openchamber-guest-bundle` (Bun): panel as a browser IIFE, service with `--node`. Tests: `bun test`. Typecheck: `tsc --noEmit`.

## Commands

```sh
npm run build && npm test && npm run typecheck && bunx openchamber-guest-check
```

Manual service test (reads the real Ploi account through the MCP configured in OpenCode):

```sh
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js &
curl -H 'Authorization: Bearer t' 'http://127.0.0.1:4599/status?locale=en&directory=/path/to/project'
fuser -k 4599/tcp
```

## Conventions

1. **Read-only.** Only Ploi read tools (`list-*`, `get-*`). Never a deploy, restart, update tool, nor `fix-`/`ignore-`/`delete-server-insight`.
2. The MCP credential comes from the OpenCode config (`src/opencode-config.ts`). Never log it, never send it anywhere but the configured MCP URL, never put it in the section.
3. `src/status-view.ts` and `src/sites-payload.ts` stay pure. Every answer must pass `guestStatusViewSchema` (`test/status-view.test.ts`): 16 rows max, 200 characters per text, unique ids.
4. All visible text goes through `translator()` (`src/i18n.ts`); every key exists in English and French (tested).
5. Failures are rows, never a 500: a missing MCP server, a refused token or an unreachable site is a note or a red dot.
6. The panel never polls faster than once a minute, and only while visible; it re-reads when the service emits `sites-updated` (checks or insights that finished after the answer). Only exception: while `insights` is still `null`, it reads again every 8 s until they arrive. Panel layout: `main.ts` holds the state and the site list, `insights-view.ts` the Insights tab, `service-client.ts` every service call. Logic that decides anything lives in `model.ts` and `insights-model.ts` (tested), styles in `view.ts` with `--oc-*` variables only.
7. Insight explanations are HTML: `src/insights.ts` parses them with regexes, never renders them. When Ploi changes the markup, refresh `test/fixtures/insight-*.html` from `get-server-insight` and adapt the parser.
8. "Fix the findings" only starts a session (`host.startSession`, capabilities `sessions` + `prompt`) after a click; the first message comes from `src/fix-prompt.ts` (tested, under 16 000 characters) and always says not to deploy.
9. The only file the service writes is `~/.config/openchamber-ploi/preferences.json` (`src/preferences.ts`; the former `openchamber-sites` file is only read): hidden site ids, nothing else. Hidden sites are never checked nor shown, the open project's included.
10. Instructions for agents hold only stable facts (ids, server, branch), never live check results: each change rewrites them.

## Git

- No commits by the agent: the user commits themselves.
- Conventional Commits (`feat(status): …`).
