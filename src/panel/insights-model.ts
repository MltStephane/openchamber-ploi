// What the Insights tab shows: open Ploi insights grouped per shown site, worst first. Pure, tested.
import { severityRank, worstSeverity, type Finding, type Severity } from '../insights.ts';
import type { InsightEntry, ServerEntry, SiteEntry, SitesPayload } from '../sites-contract.ts';

export type SiteInsightItem = { insight: InsightEntry; findings: Finding[] };
export type SiteInsights = {
  site: SiteEntry;
  server: ServerEntry | null;
  items: SiteInsightItem[];
  worst: Severity | null;
  count: number;
  /** Findings per severity, worst first, for the summary line. */
  bySeverity: { severity: Severity; count: number }[];
};
export type ServerInsight = { insight: InsightEntry; server: ServerEntry | null };
export type InsightsModel = { sites: SiteInsights[]; servers: ServerInsight[]; total: number };

const ORDER: Severity[] = ['critical', 'high', 'moderate', 'low', 'info'];

/** The sites shown outside the choose mode: every site the user did not hide. */
const shownIds = (payload: SitesPayload): Set<number> => {
  const hidden = new Set(payload.hidden);
  return new Set(payload.sites.filter((site) => !hidden.has(site.id)).map((site) => site.id));
};

const findingMatches = (needle: string, finding: Finding): boolean =>
  [finding.package ?? '', finding.title, finding.cve ?? ''].some((text) => text.toLowerCase().includes(needle));

export const buildInsightsModel = (payload: SitesPayload, query = ''): InsightsModel => {
  const insights = payload.insights ?? [];
  const shown = shownIds(payload);
  const sites = new Map(payload.sites.map((site) => [site.id, site]));
  const servers = new Map(payload.servers.map((server) => [server.id, server]));
  const needle = query.trim().toLowerCase();

  const perSite = new Map<number, SiteInsightItem[]>();
  for (const insight of insights) {
    for (const { siteId, findings } of insight.sites) {
      if (!shown.has(siteId) || !sites.has(siteId)) continue;
      const sorted = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
      perSite.set(siteId, [...(perSite.get(siteId) ?? []), { insight, findings: sorted }]);
    }
  }

  const siteGroups = [...perSite].flatMap(([siteId, items]): SiteInsights[] => {
    const site = sites.get(siteId)!;
    const server = servers.get(site.serverId) ?? null;
    const siteMatches = !needle || [site.domain, server?.name ?? ''].some((text) => text.toLowerCase().includes(needle));
    const kept = siteMatches ? items : items
      .map((item) => ({ ...item, findings: item.findings.filter((finding) => findingMatches(needle, finding)) }))
      .filter((item) => item.findings.length);
    if (!kept.length) return [];
    const all = kept.flatMap((item) => item.findings);
    const worst = kept.reduce<Severity | null>((best, item) => {
      const severity = worstSeverity(item.findings, item.insight.priority);
      return severityRank(severity) > severityRank(best) ? severity : best;
    }, null);
    const bySeverity = ORDER.map((severity) => ({ severity, count: all.filter((finding) => finding.severity === severity).length }))
      .filter((entry) => entry.count > 0);
    return [{ site, server, items: kept, worst, count: all.length || kept.length, bySeverity }];
  }).sort((a, b) => severityRank(b.worst) - severityRank(a.worst) || b.count - a.count || a.site.domain.localeCompare(b.site.domain));

  const serverWide = insights
    .filter((insight) => !insight.sites.length)
    .map((insight) => ({ insight, server: servers.get(insight.serverId) ?? null }))
    .filter(({ insight, server }) => !needle || [insight.summary, insight.type, server?.name ?? ''].some((text) => text.toLowerCase().includes(needle)));

  return { sites: siteGroups, servers: serverWide, total: siteGroups.length + serverWide.length };
};
