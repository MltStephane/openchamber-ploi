// Builds the Work Status section from the inventory and the checks. Pure: no I/O, so it is tested as is.
import type { GuestStatusRow, GuestStatusTone, GuestStatusView } from '@openchamber/sdk';

import type { Locale, Translate } from './i18n.ts';
import { ploiServerUrl, ploiSiteUrl, siteUrl, type Server, type Site } from './ploi.ts';
import { healthOf, type CheckResult, type Health, type Probe } from './probe.ts';
import { relativeTime } from './relative-time.ts';
import type { ProjectIdentity, SiteMatch } from './project.ts';

export type View = 'overview' | 'sites';
export const VIEWS: View[] = ['overview', 'sites'];

export type Problem = { key: 'ploi.tokenMissing' | 'ploi.tokenRefused' | 'ploi.forbidden' | 'ploi.hostUnavailable' | 'ploi.network' | 'ploi.failed'; params?: Record<string, string> };

export type ViewInput = {
  t: Translate;
  locale: Locale;
  now: number;
  view: View;
  problem: Problem | null;
  servers: Server[] | null;
  sites: Site[] | null;
  checks: Map<number, Probe>;
  history: Map<number, number[]>;
  /** Sites the user hid: left out everywhere, the open project's included. */
  hidden: ReadonlySet<number>;
  project: { identity: ProjectIdentity; matches: SiteMatch[] } | null;
};

const ROWS_MAX = 16;
const MATCHES_MAX = 3;
const TEXT_MAX = 200;

const DOT: Record<Health, GuestStatusTone> = { up: 'success', slow: 'warning', degraded: 'warning', down: 'error', unknown: 'muted' };

const cut = (text: string, max = TEXT_MAX): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The value shown for a check (`200 · 84 ms`, `timeout`) and its tone. */
export const checkValue = (t: Translate, check: CheckResult | undefined): { value: string; tone: GuestStatusTone } => {
  const health = healthOf(check);
  if (!check) return { value: t('health.unknown'), tone: 'muted' };
  if (check.status === null) return { value: t(`error.${check.error ?? 'network'}`), tone: 'error' };
  const value = t('value.ok', { status: check.status, ms: check.ms ?? 0 });
  return { value, tone: health === 'up' ? 'muted' : DOT[health] };
};

const siteTooltip = (input: ViewInput, site: Site, extra?: string): string => {
  const { t, locale, now, servers, checks } = input;
  const server = servers?.find((item) => item.id === site.serverId);
  const check = checks.get(site.id);
  const text = t('tooltip.site', {
    url: siteUrl(site),
    server: server?.name ?? `#${site.serverId}`,
    deploy: site.lastDeployAt ?? t('never'),
    checked: check ? relativeTime(locale, check.at, now) : '—',
  });
  return cut(extra ? `${text}\n${extra}` : text);
};

const siteLine = (input: ViewInput, site: Site, id: string, options: { chart?: boolean; extra?: string } = {}): GuestStatusRow => {
  const check = input.checks.get(site.id);
  const { value, tone } = checkValue(input.t, check);
  const history = input.history.get(site.id) ?? [];
  const server = input.servers?.find((item) => item.id === site.serverId);
  const row: GuestStatusRow = {
    kind: 'line',
    id,
    label: cut(site.domain, 80),
    dot: DOT[healthOf(check)],
    value,
    valueTone: tone,
    tooltip: siteTooltip(input, site, options.extra),
  };
  if (options.chart && history.length >= 2) {
    row.content = { kind: 'chart', values: history, unit: 'count', tone: 'accent', step: 15 };
  } else {
    row.content = { kind: 'chips', chips: [
      { id: `ploi-${site.id}`, label: input.t('ploi'), url: ploiSiteUrl(site) },
      { id: `open-${site.id}`, label: input.t('open'), url: siteUrl(site) },
    ] };
  }
  if (options.chart && server) row.badge = { label: cut(server.name, 40) };
  return row;
};

const serverLine = (input: ViewInput, server: Server): GuestStatusRow => {
  const { t } = input;
  const own = (input.sites ?? []).filter((site) => site.serverId === server.id && !input.hidden.has(site.id));
  const checked = own.filter((site) => input.checks.has(site.id));
  const failing = own.filter((site) => ['down', 'degraded'].includes(healthOf(input.checks.get(site.id))));
  const up = checked.length - failing.length;
  const active = server.status === 'active';
  let dot: GuestStatusTone = 'muted';
  if (!active) dot = 'error';
  else if (failing.length) dot = 'error';
  else if (checked.length === own.length) dot = 'success';
  const tooltip = [
    t('tooltip.server', { ip: server.ip ?? '—', php: server.php ?? '—', uptime: server.uptime ?? '' }).trim(),
    failing.length ? t('tooltip.downSites', { sites: failing.map((site) => site.domain).join(', ') }) : '',
  ].filter(Boolean).join('\n');
  const row: GuestStatusRow = {
    kind: 'line',
    id: `server-${server.id}`,
    label: cut(server.name, 80),
    icon: 'server',
    dot,
    value: active ? t('server.sites', { up, total: own.length }) : t('server.inactive', { status: server.status }),
    valueTone: failing.length || !active ? 'error' : 'muted',
    tooltip: cut(tooltip),
    content: { kind: 'chips', chips: [{ id: `ploi-server-${server.id}`, label: t('ploi'), url: ploiServerUrl(server.id) }] },
  };
  if (server.securityUpdates > 0) row.badge = { label: t('server.security', { count: server.securityUpdates }), tone: 'error' };
  else if (server.rebootRequired) row.badge = { label: t('server.reboot'), tone: 'warning' };
  return row;
};

const projectRows = (input: ViewInput): GuestStatusRow[] => {
  const { project, t } = input;
  if (!project) return [];
  if (!project.matches.length) {
    const { remote } = project.identity;
    const text = remote ? t('project.noMatchRemote', { repo: `${remote.owner}/${remote.name}` }) : t('project.noMatch');
    return [{ kind: 'note', id: 'project-none', text, tone: 'muted' }];
  }
  // A hidden site stays hidden, even when the open project is deployed to it.
  return project.matches.filter(({ site }) => !input.hidden.has(site.id)).slice(0, MATCHES_MAX).map(({ site, by }) => {
    const repo = site.repository ? `${site.repository.owner}/${site.repository.name}${site.repository.branch ? `@${site.repository.branch}` : ''}` : '';
    const how = by === 'repository' ? t('project.by.repository', { repo }) : t('project.by.appUrl');
    return siteLine(input, site, `project-${site.id}`, { chart: true, extra: t('tooltip.match', { by: how }) });
  });
};

const controls = (t: Translate, view: View): GuestStatusView['controls'] => [
  { kind: 'select', id: 'view', label: t('control.view'), value: view,
    options: VIEWS.map((value) => ({ value, label: t(value === 'overview' ? 'control.view.overview' : 'control.view.sites') })) },
  { kind: 'button', id: 'refresh', label: t('control.refresh') },
];

/** Fills what is left of the 16 rows with `rows`, and says how many did not fit. */
const fill = (t: Translate, head: GuestStatusRow[], rows: GuestStatusRow[]): GuestStatusRow[] => {
  const room = ROWS_MAX - head.length;
  if (rows.length <= room) return [...head, ...rows];
  const shown = rows.slice(0, room - 1);
  return [...head, ...shown, { kind: 'note', id: 'more', text: t('more', { count: rows.length - shown.length }), tone: 'muted' }];
};

export const buildView = (input: ViewInput): GuestStatusView => {
  const { t, problem, servers, sites, view } = input;
  const header = controls(t, view);
  const problemRows: GuestStatusRow[] = problem ? [{ kind: 'note', id: 'problem', text: cut(t(problem.key, problem.params), 300), tone: 'error' }] : [];
  if (!servers || !sites) {
    return { rows: problemRows.length ? problemRows : [{ kind: 'note', id: 'loading', text: t('loading'), tone: 'muted' }], controls: header };
  }
  if (!sites.length) return { rows: [...problemRows, { kind: 'note', id: 'empty', text: t('empty'), tone: 'muted' }], controls: header };

  const head = [...problemRows, ...projectRows(input)];
  const projectSiteIds = new Set(input.project?.matches.map(({ site }) => site.id) ?? []);
  const others = [...sites].filter((site) => !projectSiteIds.has(site.id) && !input.hidden.has(site.id))
    .sort((a, b) => a.serverId - b.serverId || a.domain.localeCompare(b.domain));

  if (view === 'sites') return { rows: fill(t, head, others.map((site) => siteLine(input, site, `site-${site.id}`))), controls: header };

  const shownServers = servers.filter((server) => {
    const own = sites.filter((site) => site.serverId === server.id);
    return !own.length || own.some((site) => !input.hidden.has(site.id));
  });
  const serverRows = shownServers.map((server) => serverLine(input, server));
  const failing = others.filter((site) => ['down', 'degraded', 'slow'].includes(healthOf(input.checks.get(site.id))));
  const allChecked = others.every((site) => input.checks.has(site.id));
  const tail: GuestStatusRow[] = failing.length
    ? failing.map((site) => siteLine(input, site, `site-${site.id}`))
    : allChecked ? [{ kind: 'note', id: 'all-up', text: t('problems.none'), tone: 'muted' }] : [];
  return { rows: fill(t, [...head, ...serverRows], tail), controls: header };
};
