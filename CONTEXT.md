# openchamber-ploi — Project context

## What the project is

An **OpenChamber** extension (id `ploi`, formerly `sites`) that monitors the user's Ploi servers and sites from a side panel and the Work Status panel, lists Ploi insights per site, and shows which site the open project is deployed to.

- Surfaces: a rail side panel with every server and site, a Work Status section drawn by the app, and per-project agent instructions.
- Data: the Ploi MCP server already configured in OpenCode. The extension needs it and says so when it is missing.
- Public repository: `git@github.com:MltStephane/openchamber-ploi.git`, branch `main`. Installs from its URL or a local path. CI (`.github/workflows/check.yml`) runs the tests, the typecheck, a built-files check and `openchamber-guest-check`.
- Nothing private goes in the repository: test fixtures and README screenshots use fictional domains, ids and IPs.

## Golden rule: READ-ONLY, QUIET

The extension shows and checks, it never changes a server or a site. It polls only while the section is on screen.

## What the product DOES

- Matches the open project to Ploi sites: git `origin` remote vs site repository, else `APP_URL`.
- HTTP check of each site (status, time, latency chart for the project's site).
- Server lines: sites up / total, reboot and security update badges.
- Ploi insights per site (vulnerabilities, SSL renewal failures), read-only on Ploi: no fix or ignore there. "Fix the findings" starts an OpenChamber session in the matching local project; the agent works on the code, never on the server.
- Choice of the sites shown (hidden sites are not checked), links to each site and server in the Ploi dashboard.
- Overview or All sites view in Work Status; full list, Problems tab and filter in the side panel; Refresh; English and French.

## What the product DOES NOT do

- No deploy, restart, log reading or `.env` reading beyond the `APP_URL` line.
- No alert when the section is closed (no schedule, no notifications).

## Log

Agent session changelog: Obsidian note `Historique des projets/OpenChamber Ploi.md` (vault "Vault").
