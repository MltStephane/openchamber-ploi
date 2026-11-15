// Builds the `GET /sites` answer from the service state. Pure, so it is tested as is.
import type { Insight } from './insights.ts';
import { ploiInsightsUrl, ploiServerUrl, ploiSiteUrl, siteUrl, type Server, type Site } from './ploi.ts';
import { healthOf, type Probe } from './probe.ts';
import type { ProjectIdentity, SiteMatch } from './project.ts';
import type { SitesPayload } from './sites-contract.ts';
import type { Problem } from './status-view.ts';

export type PayloadInput = {
  problem: Problem | null;
  servers: Server[] | null;
  sites: Site[] | null;
  checks: Map<number, Probe>;
  history: Map<number, number[]>;
  hidden: number[];
  insights: Insight[] | null;
  project: { identity: ProjectIdentity; matches: SiteMatch[] } | null;
};

const repositoryName = (site: Site): string | null => {
  const repo = site.repository;
  return repo ? `${repo.owner}/${repo.name}${repo.branch ? `@${repo.branch}` : ''}` : null;
};

export const buildSitesPayload = (input: PayloadInput): SitesPayload => ({
  problem: input.problem,
  loaded: !!input.sites,
  servers: (input.servers ?? []).map(({ id, name, status, ip, php, uptime, rebootRequired, securityUpdates }) =>
    ({ id, name, status, ip, php, uptime, rebootRequired, securityUpdates, ploiUrl: ploiServerUrl(id) })),
  sites: (input.sites ?? []).map((site) => {
    const check = input.checks.get(site.id);
    return {
      id: site.id,
      serverId: site.serverId,
      domain: site.domain,
      url: siteUrl(site),
      ploiUrl: ploiSiteUrl(site),
      health: healthOf(check),
      status: check?.status ?? null,
      ms: check?.ms ?? null,
      error: check?.error ?? null,
      checkedAt: check?.at ?? null,
      history: input.history.get(site.id) ?? [],
      lastDeployAt: site.lastDeployAt,
      repository: repositoryName(site),
    };
  }),
  hidden: input.hidden,
  insights: input.insights && input.insights.map((insight) => ({ ...insight, ploiUrl: ploiInsightsUrl(insight.serverId) })),
  project: input.project && {
    repository: input.project.identity.remote ? `${input.project.identity.remote.owner}/${input.project.identity.remote.name}` : null,
    matches: input.project.matches.map(({ site, by }) => ({ siteId: site.id, by })),
  },
});
