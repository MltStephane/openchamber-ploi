import { describe, expect, test } from 'bun:test';
import { guestStatusViewSchema } from '@openchamber/sdk/schemas';

import { translator } from '../src/i18n.ts';
import type { Server, Site } from '../src/ploi.ts';
import type { Probe } from '../src/probe.ts';
import { buildView, type ViewInput } from '../src/status-view.ts';

const server = (id: number, extra: Partial<Server> = {}): Server => ({
  id, name: `vps-${id}`, status: 'active', ip: '10.0.0.1', rebootRequired: false, securityUpdates: 0, uptime: 'Online', php: '8.5', ...extra,
});
const site = (id: number, serverId: number, extra: Partial<Site> = {}): Site => ({
  id, serverId, domain: `site${id}.fr`, healthUrl: null, lastDeployAt: '2026-11-15 10:00:00', repository: null, ...extra,
});
const ok = (ms = 120): Probe => ({ at: 1000, status: 200, ms, error: null });
const down: Probe = { at: 1000, status: null, ms: null, error: 'timeout' };

const input = (extra: Partial<ViewInput> = {}): ViewInput => ({
  t: translator('en'), locale: 'en', now: 5000, view: 'overview', problem: null,
  servers: [server(1), server(2, { rebootRequired: true })],
  sites: [site(10, 1), site(11, 1), site(20, 2)],
  checks: new Map(), history: new Map(), hidden: new Set(), project: null, ...extra,
});

const valid = (view: ReturnType<typeof buildView>) => {
  const parsed = guestStatusViewSchema.safeParse(view);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return view;
};

describe('buildView', () => {
  test('a missing MCP server is the only row', () => {
    const view = valid(buildView(input({ servers: null, sites: null, problem: { key: 'ploi.tokenMissing' } })));
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ kind: 'note', tone: 'error' });
  });

  test('loading, then empty account', () => {
    expect(valid(buildView(input({ servers: null, sites: null }))).rows[0]).toMatchObject({ id: 'loading' });
    expect(valid(buildView(input({ sites: [] }))).rows[0]).toMatchObject({ id: 'empty' });
  });

  test('overview: servers with up counts, failing sites listed', () => {
    const checks = new Map([[10, ok()], [11, down], [20, ok()]]);
    const view = valid(buildView(input({ checks })));
    const ids = view.rows.map((row) => row.id);
    expect(ids).toEqual(['server-1', 'server-2', 'site-11']);
    expect(view.rows[0]).toMatchObject({ dot: 'error', value: '1/2 up' });
    expect(view.rows[1]).toMatchObject({ dot: 'success', badge: { label: 'reboot' } });
    expect(view.rows[2]).toMatchObject({ dot: 'error', value: 'timeout' });
  });

  test('overview says so when every site answers', () => {
    const checks = new Map([[10, ok()], [11, ok()], [20, ok()]]);
    expect(valid(buildView(input({ checks }))).rows.at(-1)).toMatchObject({ id: 'all-up' });
  });

  test('the project site comes first, with a latency chart', () => {
    const checks = new Map([[10, ok()], [11, ok()], [20, ok()]]);
    const history = new Map([[20, [100, 140, 120]]]);
    const project = { identity: { remote: { host: 'github.com', owner: 'me', name: 'app' }, appHosts: [] }, matches: [{ site: site(20, 2), by: 'repository' as const }] };
    const view = valid(buildView(input({ checks, history, project })));
    expect(view.rows[0]).toMatchObject({ id: 'project-20', badge: { label: 'vps-2' }, content: { kind: 'chart' } });
  });

  test('a project without a site says which repository it looked for', () => {
    const project = { identity: { remote: { host: 'github.com', owner: 'me', name: 'app' }, appHosts: [] }, matches: [] };
    const view = valid(buildView(input({ project, t: translator('fr'), locale: 'fr' })));
    expect(view.rows[0]).toMatchObject({ kind: 'note', text: 'Aucun site Ploi n’est déployé depuis me/app.' });
  });

  test('all sites view stays within 16 rows', () => {
    const sites = Array.from({ length: 30 }, (_, index) => site(100 + index, 1));
    const view = valid(buildView(input({ view: 'sites', sites })));
    expect(view.rows).toHaveLength(16);
    expect(view.rows.at(-1)).toMatchObject({ id: 'more', text: '15 more sites not shown' });
    expect(view.rows[0]).toMatchObject({ content: { kind: 'chips' } });
  });

  test('hidden sites are left out, and a server with only hidden sites too', () => {
    const checks = new Map([[10, ok()], [11, down], [20, down]]);
    const view = valid(buildView(input({ checks, hidden: new Set([11, 20]) })));
    expect(view.rows.map((row) => row.id)).toEqual(['server-1', 'all-up']);
    expect(view.rows[0]).toMatchObject({ value: '1/1 up' });
    const sites = valid(buildView(input({ view: 'sites', hidden: new Set([11]) })));
    expect(sites.rows.map((row) => row.id)).toEqual(['site-10', 'site-20']);
  });

  test('a hidden project site stays hidden, without a "no site" note', () => {
    const project = { identity: { remote: null, appHosts: ['site20.fr'] }, matches: [{ site: site(20, 2), by: 'app-url' as const }] };
    const view = valid(buildView(input({ project, hidden: new Set([20]) })));
    expect(view.rows.map((row) => row.id)).not.toContain('project-20');
    expect(view.rows.map((row) => row.id)).not.toContain('project-none');
    expect(view.rows.map((row) => row.id)).not.toContain('server-2');
  });

  test('lines link to the Ploi dashboard', () => {
    const view = valid(buildView(input({ view: 'sites' })));
    expect(view.rows[0]).toMatchObject({ content: { kind: 'chips', chips: [{ url: 'https://ploi.io/panel/servers/1/sites/10' }, { url: 'https://site10.fr/' }] } });
    const overview = valid(buildView(input()));
    expect(overview.rows[0]).toMatchObject({ content: { kind: 'chips', chips: [{ url: 'https://ploi.io/panel/servers/1' }] } });
  });

  test('a refresh error stays visible above the data', () => {
    const view = valid(buildView(input({ problem: { key: 'ploi.tokenRefused' } })));
    expect(view.rows[0]).toMatchObject({ id: 'problem', tone: 'error' });
  });
});
