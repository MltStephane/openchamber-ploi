// The Ploi inventory read through the MCP server: servers, sites and each site's repository.
export type Server = {
  id: number;
  name: string;
  status: string;
  ip: string | null;
  rebootRequired: boolean;
  securityUpdates: number;
  uptime: string | null;
  php: string | null;
};

export type Repository = { provider: string; owner: string; name: string; branch: string | null };

export type Site = {
  id: number;
  serverId: number;
  domain: string;
  healthUrl: string | null;
  lastDeployAt: string | null;
  repository?: Repository | null;
};

const list = (payload: unknown): Record<string, unknown>[] => {
  const data = (payload as { data?: unknown })?.data ?? payload;
  return Array.isArray(data) ? data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
};

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

export const parseServers = (payload: unknown): Server[] => list(payload).map((raw) => {
  const updates = (raw.updates ?? {}) as Record<string, unknown>;
  return {
    id: num(raw.id),
    name: str(raw.name) ?? `#${num(raw.id)}`,
    status: str(raw.status) ?? 'unknown',
    ip: str(raw.ip_address),
    rebootRequired: raw.reboot_required === true,
    securityUpdates: num(updates.security),
    uptime: str(raw.uptime_human),
    php: str(raw.php_version),
  };
});

export const parseSites = (payload: unknown): Site[] => list(payload)
  .map((raw) => ({
    id: num(raw.id),
    serverId: num(raw.server_id),
    domain: str(raw.domain) ?? '',
    healthUrl: str(raw.health_url),
    lastDeployAt: str(raw.last_deploy_at),
  }))
  .filter((site) => site.domain);

export const parseRepository = (payload: unknown): Repository | null => {
  const data = ((payload as { data?: unknown })?.data ?? payload) as { repository?: Record<string, unknown> | null } | null;
  const repo = data?.repository;
  const owner = str(repo?.user);
  const name = str(repo?.name);
  if (!repo || !owner || !name) return null;
  return { provider: str(repo.provider) ?? 'github', owner, name, branch: str(repo.branch) };
};

const PANEL = 'https://ploi.io/panel/servers';

/** The server's page in the Ploi dashboard. */
export const ploiServerUrl = (serverId: number): string => `${PANEL}/${serverId}`;

/** The server's insights page in the Ploi dashboard. */
export const ploiInsightsUrl = (serverId: number): string => `${PANEL}/${serverId}/insights`;

/** The site's page in the Ploi dashboard. */
export const ploiSiteUrl = (site: Pick<Site, 'id' | 'serverId'>): string => `${PANEL}/${site.serverId}/sites/${site.id}`;

/** The URL a check fetches: the site's health URL when Ploi has one, else its domain over https. */
export const siteUrl = (site: Site): string => {
  if (site.healthUrl && /^https?:\/\//.test(site.healthUrl)) return site.healthUrl;
  return `https://${site.domain}/`;
};
