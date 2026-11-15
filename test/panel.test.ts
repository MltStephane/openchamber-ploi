import { describe, expect, test } from 'bun:test';

import { buildInsightsModel } from '../src/panel/insights-model.ts';
import { buildModel } from '../src/panel/model.ts';
import type { Server, Site } from '../src/ploi.ts';
import type { Probe } from '../src/probe.ts';
import { isSitesPayload, type SitesPayload } from '../src/sites-contract.ts';
import { buildSitesPayload } from '../src/sites-payload.ts';

const server = (id: number, name: string): Server => ({
  id, name, status: 'active', ip: `10.0.0.${id}`, rebootRequired: false, securityUpdates: 0, uptime: null, php: '8.5',
});
const site = (id: number, serverId: number, domain: string): Site => ({
  id, serverId, domain, healthUrl: null, lastDeployAt: null,
  repository: id === 1 ? { provider: 'github', owner: 'me', name: 'app', branch: 'main' } : null,
});
const check = (status: number | null, ms: number | null = 100): Probe => ({ at: 1, status, ms, error: status === null ? 'timeout' : null });

const payload = (hidden: number[] = []): SitesPayload => buildSitesPayload({
  hidden,
  insights: null,
  problem: null,
  servers: [server(1, 'prod'), server(2, 'poc')],
  sites: [site(1, 1, 'app.fr'), site(2, 1, 'blog.fr'), site(3, 2, 'down.fr'), site(4, 2, 'zeta.fr')],
  checks: new Map([[1, check(200)], [2, check(200, 3000)], [3, check(null)], [4, check(200)]]),
  history: new Map([[1, [90, 100]]]),
  project: { identity: { remote: { host: 'github.com', owner: 'me', name: 'app' }, appHosts: [] }, matches: [{ site: site(1, 1, 'app.fr'), by: 'repository' }] },
});

describe('sites payload', () => {
  test('carries health, url, history and the project match', () => {
    const body = payload();
    expect(isSitesPayload(JSON.parse(JSON.stringify(body)))).toBe(true);
    expect(body.servers[0]).toMatchObject({ ploiUrl: 'https://ploi.io/panel/servers/1' });
    expect(body.sites[0]).toMatchObject({ domain: 'app.fr', url: 'https://app.fr/', ploiUrl: 'https://ploi.io/panel/servers/1/sites/1', health: 'up', history: [90, 100], repository: 'me/app@main' });
    expect(body.sites[2]).toMatchObject({ health: 'down', status: null, error: 'timeout' });
    expect(body.project).toEqual({ repository: 'me/app', matches: [{ siteId: 1, by: 'repository' }] });
  });
  test('before the first read nothing is loaded', () => {
    const body = buildSitesPayload({ hidden: [], insights: null, problem: { key: 'mcp.notConfigured' }, servers: null, sites: null, checks: new Map(), history: new Map(), project: null });
    expect(body).toMatchObject({ loaded: false, sites: [], problem: { key: 'mcp.notConfigured' } });
  });
});

describe('panel model', () => {
  test('the project site stays in its server\'s list', () => {
    const model = buildModel(payload(), '', 'all');
    expect(model.project.map(({ site }) => site.domain)).toEqual(['app.fr']);
    expect(model.groups.map((group) => [group.server?.name, group.sites.map((item) => item.domain), group.up, group.failing, group.total]))
      .toEqual([['prod', ['app.fr', 'blog.fr'], 2, 0, 2], ['poc', ['down.fr', 'zeta.fr'], 1, 1, 2]]);
    expect(model.problems).toBe(2);
  });
  test('problems tab keeps slow and failing sites only', () => {
    const model = buildModel(payload(), '', 'problems');
    expect(model.groups.flatMap((group) => group.sites.map((item) => item.domain))).toEqual(['blog.fr', 'down.fr']);
  });
  test('filter by domain or by server name', () => {
    expect(buildModel(payload(), 'zeta', 'all').groups.map((group) => group.sites.map((item) => item.domain))).toEqual([['zeta.fr']]);
    expect(buildModel(payload(), 'poc', 'all').groups.map((group) => group.server?.name)).toEqual(['poc']);
    expect(buildModel(payload(), 'nothing', 'all').groups).toEqual([]);
  });
  test('hidden sites leave the list and the counts; the choose mode lists them all', () => {
    const model = buildModel(payload([2, 3]), '', 'all');
    expect(model.groups.map((group) => [group.server?.name, group.sites.map((item) => item.domain), group.total])).toEqual([['prod', ['app.fr'], 1], ['poc', ['zeta.fr'], 1]]);
    expect([model.visibleCount, model.hiddenCount, model.problems]).toEqual([2, 2, 0]);
    const choosing = buildModel(payload([2, 3]), '', 'problems', true);
    expect(choosing.project).toEqual([]);
    expect(choosing.groups.map((group) => [group.sites.map((item) => item.domain), group.allSiteIds])).toEqual([[['app.fr', 'blog.fr'], [1, 2]], [['down.fr', 'zeta.fr'], [3, 4]]]);
  });
  test('a server whose sites are all hidden disappears; a hidden project site too', () => {
    const model = buildModel(payload([1, 3, 4]), '', 'all');
    expect(model.groups.map((group) => [group.server?.name, group.sites.map((item) => item.domain)])).toEqual([['prod', ['blog.fr']]]);
    expect(model.project.map(({ site }) => site.domain)).toEqual(['app.fr']);
  });
});

describe('insights model', () => {
  const finding = (severity: 'critical' | 'high' | null, pkg: string | null, title: string) =>
    ({ severity, package: pkg, title, cve: null, fixAvailable: false, url: null });
  const withInsights = (hidden: number[] = []): SitesPayload => {
    const base = payload(hidden);
    return { ...base, insights: [
      { id: 10, serverId: 2, type: 'npm-vulnerabilities', priority: 'high', summary: 'npm', createdAt: null, ploiUrl: 'https://ploi.io/panel/servers/2/insights',
        sites: [{ siteId: 3, findings: [finding('high', 'axios', 'ReDoS'), finding('critical', 'shell-quote', 'injection')] }, { siteId: 4, findings: [finding('high', 'vite', 'bypass')] }] },
      { id: 11, serverId: 1, type: 'failed-certificate-checks', priority: 'high', summary: 'ssl', createdAt: null, ploiUrl: 'https://ploi.io/panel/servers/1/insights',
        sites: [{ siteId: 2, findings: [finding(null, null, 'Failures detected: 2')] }] },
      { id: 12, serverId: 1, type: 'disk-usage', priority: 'low', summary: 'Disk almost full', createdAt: null, ploiUrl: 'https://ploi.io/panel/servers/1/insights', sites: [] },
    ] };
  };

  test('sites worst first, server-wide insights apart', () => {
    const model = buildInsightsModel(withInsights());
    expect(model.sites.map((group) => [group.site.domain, group.worst, group.count])).toEqual([['down.fr', 'critical', 2], ['blog.fr', 'high', 1], ['zeta.fr', 'high', 1]]);
    expect(model.sites[0]!.items[0]!.findings.map((item) => item.package)).toEqual(['shell-quote', 'axios']);
    expect(model.sites[0]!.bySeverity).toEqual([{ severity: 'critical', count: 1 }, { severity: 'high', count: 1 }]);
    expect(model.servers.map(({ insight }) => insight.id)).toEqual([12]);
    expect(model.total).toBe(4);
  });
  test('hidden sites drop out; the filter narrows findings', () => {
    expect(buildInsightsModel(withInsights([3])).sites.map((group) => group.site.domain)).toEqual(['blog.fr', 'zeta.fr']);
    const filtered = buildInsightsModel(withInsights(), 'axios');
    expect(filtered.sites.map((group) => [group.site.domain, group.items[0]!.findings.map((item) => item.package)])).toEqual([['down.fr', ['axios']]]);
    expect(filtered.servers).toEqual([]);
  });
});
