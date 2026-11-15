// What the panel shows, from the `/sites` answer: pure, so it is tested without a DOM.
import type { Health } from '../probe.ts';
import type { ServerEntry, SiteEntry, SitesPayload } from '../sites-contract.ts';

export type Tab = 'all' | 'problems' | 'insights';
export type ServerGroup = {
  server: ServerEntry | null;
  serverId: number;
  sites: SiteEntry[];
  /** Counts over the server's shown sites. */
  up: number;
  failing: number;
  total: number;
  /** Every site of the server, hidden ones included: what the server's checkbox toggles. */
  allSiteIds: number[];
};
export type PanelModel = {
  project: { site: SiteEntry; by: 'repository' | 'app-url' }[];
  groups: ServerGroup[];
  problems: number;
  /** Sites shown outside the choose mode, project included. */
  visibleCount: number;
  hiddenCount: number;
};

const FAILING: Health[] = ['down', 'degraded'];
const isProblem = (site: SiteEntry): boolean => FAILING.includes(site.health) || site.health === 'slow';

const matches = (query: string, site: SiteEntry, server: ServerEntry | undefined): boolean => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [site.domain, site.repository ?? '', server?.name ?? '', server?.ip ?? ''].some((text) => text.toLowerCase().includes(needle));
};

/**
 * `choosing` lists every site, hidden ones included, so the user can tick them; otherwise hidden sites
 * are left out, the open project's one included.
 */
export const buildModel = (payload: SitesPayload, query: string, tab: Tab, choosing = false): PanelModel => {
  const servers = new Map(payload.servers.map((server) => [server.id, server]));
  const hidden = new Set(payload.hidden);
  const project = (payload.project?.matches ?? []).flatMap(({ siteId, by }) => {
    const site = payload.sites.find((item) => item.id === siteId);
    return site ? [{ site, by }] : [];
  });
  const needle = query.trim();
  const shownSites = payload.sites.filter((site) => !hidden.has(site.id));

  const visible = payload.sites
    .filter((site) => choosing || !hidden.has(site.id))
    .filter((site) => (tab === 'problems' && !choosing ? isProblem(site) : true))
    .filter((site) => matches(needle, site, servers.get(site.serverId)));

  const order = [...payload.servers.map((server) => server.id), ...payload.sites.map((site) => site.serverId)];
  const groups: ServerGroup[] = [...new Set(order)].flatMap((serverId) => {
    const own = payload.sites.filter((site) => site.serverId === serverId);
    const shown = own.filter((site) => !hidden.has(site.id));
    const sites = visible.filter((site) => site.serverId === serverId).sort((a, b) => a.domain.localeCompare(b.domain));
    const server = servers.get(serverId) ?? null;
    const serverMatches = !!needle && !!server && server.name.toLowerCase().includes(needle.toLowerCase());
    // A server whose every site is hidden disappears, unless the user is choosing.
    const keepEmpty = tab === 'all' && (choosing || (!own.length || shown.length > 0)) && (serverMatches || (!needle && !!server));
    if (!sites.length && !keepEmpty) return [];
    const failing = shown.filter((site) => FAILING.includes(site.health)).length;
    const checked = shown.filter((site) => site.health !== 'unknown').length;
    return [{ server, serverId, sites, up: checked - failing, failing, total: shown.length, allSiteIds: own.map((site) => site.id) }];
  });

  return {
    project: choosing ? [] : project,
    groups,
    problems: shownSites.filter(isProblem).length,
    visibleCount: shownSites.length,
    hiddenCount: payload.sites.filter((site) => hidden.has(site.id)).length,
  };
};
