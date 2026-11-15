// The `GET /sites` answer the side panel reads. Shared by the service and the panel.
import type { InsightSite } from './insights.ts';
import type { Health, ProbeError } from './probe.ts';
import type { Problem } from './status-view.ts';

export type SiteEntry = {
  id: number;
  serverId: number;
  domain: string;
  url: string;
  /** The site's page in the Ploi dashboard. */
  ploiUrl: string;
  health: Health;
  status: number | null;
  ms: number | null;
  error: ProbeError | null;
  checkedAt: number | null;
  history: number[];
  lastDeployAt: string | null;
  repository: string | null;
};

export type ServerEntry = {
  id: number;
  name: string;
  status: string;
  ip: string | null;
  php: string | null;
  uptime: string | null;
  rebootRequired: boolean;
  securityUpdates: number;
  /** The server's page in the Ploi dashboard. */
  ploiUrl: string;
};

export type InsightEntry = {
  id: number;
  serverId: number;
  type: string;
  priority: string;
  summary: string;
  createdAt: string | null;
  /** The server's insights page in the Ploi dashboard. */
  ploiUrl: string;
  /** The sites the explanation links, with their findings. Empty for a server-wide insight. */
  sites: InsightSite[];
};

export type SitesPayload = {
  problem: Problem | null;
  /** `false` until the first Ploi read finished. */
  loaded: boolean;
  servers: ServerEntry[];
  /** Every site, hidden ones included, so the panel can show them again. */
  sites: SiteEntry[];
  /** Ids of the sites the user hid. They are neither checked nor shown, the open project's included. */
  hidden: number[];
  /** Open Ploi insights; `null` until the first read finished. */
  insights: InsightEntry[] | null;
  project: { repository: string | null; matches: { siteId: number; by: 'repository' | 'app-url' }[] } | null;
};

export const isSitesPayload = (body: unknown): body is SitesPayload => {
  const value = body as Partial<SitesPayload> | null;
  return !!value && typeof value === 'object' && typeof value.loaded === 'boolean'
    && Array.isArray(value.servers) && Array.isArray(value.sites) && Array.isArray(value.hidden);
};
