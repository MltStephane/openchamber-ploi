// Local service started by OpenChamber (see GUEST_SERVICES.md in @openchamber/sdk).
// Reads the Ploi inventory through Ploi's MCP server with the token from the integration card, checks every site over
// HTTP, and answers the Work Status section. Read-only: it never deploys, restarts or changes anything.
import http from 'node:http';

import { createServiceHost } from '@openchamber/sdk';

import { resolveLocale, translator } from './i18n.ts';
import { CARD_MESSAGES, PLOI_MCP_URL, readCredential, type Credential } from './credentials.ts';
import { McpClient, McpError } from './mcp-client.ts';
import { explanationOf, parseInsightList, parseInsightSites, type Insight } from './insights.ts';
import { normaliseHidden, readPreferences, writePreferences } from './preferences.ts';
import { parseRepository, parseServers, parseSites, siteUrl, type Repository, type Server, type Site } from './ploi.ts';
import { probe, type Probe } from './probe.ts';
import { matchSites, projectsBySite, readIdentity, type ProjectIdentity, type ProjectRef, type SiteMatch } from './project.ts';
import { buildSitesPayload } from './sites-payload.ts';
import { buildView, VIEWS, type Problem, type View } from './status-view.ts';

const VERSION = '3.0.1';
const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!port || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}

/** The token is read again this often, so a new one on the card is used without a restart. */
const CREDENTIAL_TTL = 30_000;
const INVENTORY_TTL = 5 * 60_000;
const REPOSITORY_TTL = 30 * 60_000;
const CHECK_TTL = 60_000;
const IDENTITY_TTL = 60_000;
const INSIGHTS_TTL = 15 * 60_000;
const INSIGHTS_CONCURRENCY = 4;
const PROJECTS_MAX = 200;
const HISTORY_MAX = 40;
const CHECK_CONCURRENCY = 6;
const REPOSITORY_CONCURRENCY = 4;

const host = (() => {
  try { return createServiceHost({ env: process.env }); } catch { return null; }
})();

const state = {
  view: 'overview' as View,
  credential: null as { value: Credential; at: number } | null,
  /** What the integration card says now, so it is set only when it changes. */
  cardMessage: undefined as string | null | undefined,
  client: null as McpClient | null,
  servers: null as Server[] | null,
  sites: null as Site[] | null,
  inventoryAt: 0,
  inventoryError: null as Problem | null,
  inventoryLoad: null as Promise<void> | null,
  repositories: new Map<number, Repository | null>(),
  repositoriesAt: 0,
  checks: new Map<number, Probe>(),
  history: new Map<number, number[]>(),
  checking: new Map<number, Promise<void>>(),
  identities: new Map<string, { value: ProjectIdentity; at: number }>(),
  instructions: new Map<string, string>(),
  hidden: new Set<number>(),
  insights: null as Insight[] | null,
  insightsAt: 0,
  insightsLoad: null as Promise<void> | null,
};

const preferencesReady = readPreferences().then(({ hidden }) => { state.hidden = new Set(hidden); });

const within = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([promise, new Promise<undefined>((resolve) => { setTimeout(resolve, ms); })]);

/** Tells open panels to read again: something they asked for finished after they got their answer. */
const notifyPanels = (): void => { host?.emit('sites-updated').catch(() => undefined); };

/** Waits up to `ms` for `task`; when it takes longer, the panels hear about it once it is done. */
const awaitOrNotify = async (task: Promise<unknown>, ms: number): Promise<void> => {
  if ((await within(task.then(() => true), ms)) === undefined) void task.then(notifyPanels);
};

/** The sites the user did not hide: the only ones checked and shown. */
const shownSites = (): Site[] => (state.sites ?? []).filter((site) => !state.hidden.has(site.id));

const pool = async <T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> => {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
};

/** Shows `message` on the integration card, or clears it with `null`; only when it changes. */
const setCardMessage = (message: string | null): void => {
  if (!host || state.cardMessage === message) return;
  state.cardMessage = message;
  host.needsConfiguration(message).catch(() => { state.cardMessage = undefined; });
};

const errorProblem = (error: unknown): Problem => {
  if (error instanceof McpError && error.kind === 'auth') {
    setCardMessage(CARD_MESSAGES.refused);
    return { key: 'ploi.tokenRefused' };
  }
  if (error instanceof McpError && error.kind === 'network') return { key: 'ploi.network' };
  return { key: 'ploi.failed', params: { message: (error as Error).message.slice(0, 160) } };
};

/** The MCP client for the token on the integration card now; a changed token gets a new client. */
const currentClient = async (): Promise<McpClient | Problem> => {
  if (!state.credential || Date.now() - state.credential.at > CREDENTIAL_TTL) {
    state.credential = { value: await readCredential(() => (host ? host.readSettings() : Promise.reject(new Error('no host')))), at: Date.now() };
  }
  const credential = state.credential.value;
  if (!credential.ok) {
    if (credential.reason === 'host') return { key: 'ploi.hostUnavailable' };
    setCardMessage(CARD_MESSAGES.missing);
    return { key: 'ploi.tokenMissing' };
  }
  const endpoint = { url: PLOI_MCP_URL, headers: { Authorization: `Bearer ${credential.token}` } };
  if (!state.client?.sameEndpoint(endpoint)) state.client = new McpClient(endpoint, VERSION);
  return state.client;
};

const loadRepositories = async (client: McpClient, sites: Site[], force: boolean): Promise<void> => {
  const stale = force || Date.now() - state.repositoriesAt > REPOSITORY_TTL;
  const missing = sites.filter((site) => stale || !state.repositories.has(site.id));
  await pool(missing, REPOSITORY_CONCURRENCY, async (site) => {
    try {
      state.repositories.set(site.id, parseRepository(await client.callTool('get-site-repository', { server_id: site.serverId, site_id: site.id })));
    } catch {
      if (!state.repositories.has(site.id)) state.repositories.set(site.id, null);
    }
  });
  if (stale) state.repositoriesAt = Date.now();
  for (const site of sites) site.repository = state.repositories.get(site.id) ?? null;
};

const loadInventory = (force = false): Promise<void> => {
  if (state.inventoryLoad) return state.inventoryLoad;
  if (!force && state.sites && Date.now() - state.inventoryAt < INVENTORY_TTL) return Promise.resolve();
  state.inventoryLoad = (async () => {
    const client = await currentClient();
    if (!(client instanceof McpClient)) { state.inventoryError = client; return; }
    try {
      const [servers, sites] = await Promise.all([client.callTool('list-servers'), client.callTool('list-sites')]);
      const parsedSites = parseSites(sites);
      await loadRepositories(client, parsedSites, force);
      state.servers = parseServers(servers);
      state.sites = parsedSites;
      state.inventoryAt = Date.now();
      state.inventoryError = null;
      setCardMessage(null);
      const known = new Set(parsedSites.map((site) => site.id));
      for (const id of [...state.checks.keys()]) if (!known.has(id)) { state.checks.delete(id); state.history.delete(id); }
    } catch (error) {
      state.inventoryError = errorProblem(error);
    }
  })().finally(() => { state.inventoryLoad = null; });
  return state.inventoryLoad;
};

/** Open insights of every server, each with its explanation split per site. A failed read keeps the last one. */
const loadInsights = (force = false): Promise<void> => {
  if (state.insightsLoad) return state.insightsLoad;
  if (!state.servers) return Promise.resolve();
  if (!force && state.insights && Date.now() - state.insightsAt < INSIGHTS_TTL) return Promise.resolve();
  const servers = state.servers;
  state.insightsLoad = (async () => {
    const client = await currentClient();
    if (!(client instanceof McpClient)) return;
    const found: Insight[] = [];
    let failed = false;
    await pool(servers, INSIGHTS_CONCURRENCY, async (server) => {
      try { found.push(...parseInsightList(await client.callTool('list-server-insights', { server_id: server.id }), server.id)); } catch { failed = true; }
    });
    await pool(found, INSIGHTS_CONCURRENCY, async (insight) => {
      try {
        insight.sites = parseInsightSites(explanationOf(await client.callTool('get-server-insight', { server_id: insight.serverId, insight_id: insight.id })));
      } catch { /* keep the summary alone */ }
    });
    if (failed && state.insights) return;
    state.insights = found.sort((a, b) => a.serverId - b.serverId || a.id - b.id);
    state.insightsAt = Date.now();
  })().catch(() => undefined).finally(() => { state.insightsLoad = null; });
  return state.insightsLoad;
};

const checkSite = (site: Site): Promise<void> => {
  const running = state.checking.get(site.id);
  if (running) return running;
  const task = probe(siteUrl(site)).then((result) => {
    state.checks.set(site.id, result);
    if (result.ms !== null) state.history.set(site.id, [...(state.history.get(site.id) ?? []), result.ms].slice(-HISTORY_MAX));
  }).finally(() => { state.checking.delete(site.id); });
  state.checking.set(site.id, task);
  return task;
};

const checkSites = (sites: Site[], force = false): Promise<void> => {
  const due = sites.filter((site) => force || Date.now() - (state.checks.get(site.id)?.at ?? 0) > CHECK_TTL);
  return pool(due, CHECK_CONCURRENCY, checkSite);
};

const identityOf = async (directory: string): Promise<ProjectIdentity> => {
  const cached = state.identities.get(directory);
  if (cached && Date.now() - cached.at < IDENTITY_TTL) return cached.value;
  const value = await readIdentity(directory);
  state.identities.set(directory, { value, at: Date.now() });
  return value;
};

/** Tells agents working in `directory` which Ploi site and server the project runs on. Only stable facts. */
const instructionsFor = (matches: SiteMatch[]): string => {
  if (!matches.length) return '';
  const lines = matches.map(({ site }) => {
    const server = state.servers?.find((item) => item.id === site.serverId);
    const branch = site.repository?.branch ? `, branch ${site.repository.branch}` : '';
    return `- ${site.domain}: site_id ${site.id} on server ${server?.name ?? '?'} (server_id ${site.serverId}${server?.ip ? `, ${server.ip}` : ''})${branch}`;
  });
  return ['This project is hosted on Ploi:', ...lines].join('\n');
};

const publishInstructions = (directory: string, matches: SiteMatch[]): void => {
  if (!host) return;
  const text = instructionsFor(matches);
  if ((state.instructions.get(directory) ?? '') === text) return;
  state.instructions.set(directory, text);
  host.setInstructions(directory, text).catch(() => { state.instructions.delete(directory); });
};

type Project = { identity: ProjectIdentity; matches: SiteMatch[] } | null;

/**
 * Brings the inventory, the project match and the checks up to date, within bounded waits, and tells open
 * panels when checks that were still running finish.
 */
const snapshot = async (directory: string | null): Promise<Project> => {
  await preferencesReady;
  await within(loadInventory(), state.sites ? 0 : 15_000);
  const sites = state.sites ?? [];
  let project: Project = null;
  if (directory && state.sites) {
    const identity = await identityOf(directory);
    const matches = matchSites(identity, sites);
    project = { identity, matches };
    publishInstructions(directory, matches);
  }
  await awaitOrNotify(checkSites(shownSites()), 4000);
  await awaitOrNotify(loadInsights(), 0);
  return project;
};

const readStatus = async (query: URLSearchParams) => {
  const locale = resolveLocale(query.get('locale'));
  const project = await snapshot(query.get('directory'));
  return buildView({
    t: translator(locale),
    locale,
    now: Date.now(),
    view: state.view,
    problem: state.inventoryError,
    servers: state.servers,
    sites: state.sites,
    checks: state.checks,
    history: state.history,
    hidden: state.hidden,
    project,
  });
};

const readSites = async (query: URLSearchParams) => {
  const project = await snapshot(query.get('directory'));
  return buildSitesPayload({
    problem: state.inventoryError, servers: state.servers, sites: state.sites, checks: state.checks, history: state.history, hidden: [...state.hidden], insights: state.insights, project,
  });
};

/** Re-reads Ploi and re-checks every site. A failure with nothing to show is the only error. */
const refresh = async (): Promise<{ status: number; body: object }> => {
  state.credential = null;
  state.identities.clear();
  await within(loadInventory(true), 20_000);
  if (!state.sites && state.inventoryError) {
    return { status: 502, body: { message: translator('en')(state.inventoryError.key, state.inventoryError.params) } };
  }
  await within(Promise.all([
    checkSites(shownSites(), true),
    loadInsights(true),
  ]), 20_000);
  return { status: 200, body: { ok: true } };
};

/** Which OpenChamber project each site is deployed from, so the panel can start a session there. */
const matchProjects = async (body: string): Promise<{ status: number; body: object }> => {
  let projects: ProjectRef[];
  try {
    const raw = (JSON.parse(body || '{}') as { projects?: unknown }).projects;
    projects = (Array.isArray(raw) ? raw : [])
      .filter((item): item is ProjectRef => !!item && typeof item.id === 'string' && typeof item.directory === 'string' && item.directory.startsWith('/'))
      .slice(0, PROJECTS_MAX);
  } catch {
    return { status: 400, body: { message: 'Bad request' } };
  }
  await within(loadInventory(), state.sites ? 0 : 15_000);
  if (!state.sites) return { status: 200, body: { ready: false, matches: {} } };
  const identities: { id: string; identity: ProjectIdentity }[] = [];
  await pool(projects, 6, async ({ id, directory }) => { identities.push({ id, identity: await identityOf(directory) }); });
  // Keep the order the panel sent, so the first project wins on a tie.
  identities.sort((a, b) => projects.findIndex((item) => item.id === a.id) - projects.findIndex((item) => item.id === b.id));
  const matches = Object.fromEntries([...projectsBySite(identities, state.sites)].map(([siteId, match]) => [String(siteId), match]));
  return { status: 200, body: { ready: true, matches } };
};

/** Saves which sites are hidden, then checks the sites shown again, and tells open panels when done. */
const saveHidden = async (body: string): Promise<{ status: number; body: object }> => {
  let hidden: number[];
  try { hidden = normaliseHidden((JSON.parse(body || '{}') as { hidden?: unknown }).hidden); } catch { return { status: 400, body: { message: 'Bad request' } }; }
  await preferencesReady;
  try {
    await writePreferences({ hidden });
  } catch (error) {
    return { status: 500, body: { message: (error as Error).message.slice(0, 200) } };
  }
  state.hidden = new Set(hidden);
  void checkSites(shownSites()).then(notifyPanels);
  return { status: 200, body: { ok: true, hidden } };
};

const act = async (body: string): Promise<{ status: number; body: object }> => {
  let event: { id?: unknown; value?: unknown };
  try { event = JSON.parse(body || '{}'); } catch { return { status: 400, body: { message: 'Bad request' } }; }
  if (event.id === 'view' && VIEWS.includes(event.value as View)) {
    state.view = event.value as View;
    return { status: 200, body: { ok: true } };
  }
  if (event.id === 'refresh') return refresh();
  return { status: 404, body: { message: 'Unknown control' } };
};

const send = (res: http.ServerResponse, status: number, body: object): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
};

http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') { send(res, 200, {}); return; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const route = `${req.method} ${url.pathname}`;
    let work: Promise<{ status: number; body: object }>;
    if (route === 'GET /status') work = readStatus(url.searchParams).then((view) => ({ status: 200, body: view }));
    else if (route === 'POST /status') work = act(body);
    else if (route === 'GET /sites') work = readSites(url.searchParams).then((payload) => ({ status: 200, body: payload }));
    else if (route === 'POST /refresh') work = refresh();
    else if (route === 'POST /hidden') work = saveHidden(body);
    else if (route === 'POST /projects') work = matchProjects(body);
    else { send(res, 404, {}); return; }
    work.then(({ status, body: answer }) => send(res, status, answer), (error: unknown) => {
      const message = String((error as Error).message ?? error).slice(0, 300);
      if (url.pathname === '/status') send(res, 200, { rows: [{ kind: 'note', id: 'crash', text: message, tone: 'error' }] });
      else send(res, 500, { message });
    });
  });
}).listen(port, '127.0.0.1');
