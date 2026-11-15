// Side panel: every Ploi server and site with its live check, the Insights tab, and the choice of the
// sites shown. A click opens the site or server in the Ploi dashboard. Data comes from the local service.
import { connectHost, HostRequestError, type GuestProject } from '@openchamber/sdk';
import { applyHostReady, mountBanner, mountButton, mountCheckbox, mountEmpty, mountSearchField, mountSpinner, mountTabs } from '@openchamber/sdk/ui';

import { buildFixPrompt } from '../fix-prompt.ts';
import { resolveLocale, translator, type Locale, type Translate } from '../i18n.ts';
import { parsePloiDate, relativeTime } from '../relative-time.ts';
import type { SiteEntry, SitesPayload } from '../sites-contract.ts';
import { checkValue } from '../status-view.ts';
import { buildInsightsModel } from './insights-model.ts';
import { renderInsights, type FixState } from './insights-view.ts';
import { buildModel, type ServerGroup, type Tab } from './model.ts';
import { createServiceClient } from './service-client.ts';
import { button, dot, element, heading, STYLE } from './view.ts';

const REFRESH_MS = 60_000;
/** While insights are still loading, read again this often in case the service's event is missed. */
const INSIGHTS_RETRY_MS = 8000;
const TABS: Tab[] = ['all', 'problems', 'insights'];

const host = connectHost();
const service = createServiceClient(host);
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing #root');
const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

// ----- State -----

let locale: Locale = 'en';
let t: Translate = translator(locale);
let directory: string | null = null;
let payload: SitesPayload | null = null;
let failed = false;
let loading = false;
let refreshing = false;
let tab: Tab = 'all';
let query = '';
let choosing = false;
let generation = 0;
let mounted = false;
/** Sites whose insights are unfolded, kept across re-renders. */
const openInsightSites = new Set<number>();
/** OpenChamber projects (`null` until known) and the project each site is deployed from. */
let projects: GuestProject[] | null = null;
let projectsDenied = false;
let siteProjects = new Map<number, string>();
let matchKey = '';
const startingFix = new Set<number>();

// ----- Layout -----

const toolbar = element('div', 'toolbar');
const notice = element('div', 'notice');
const content = element('div', 'content');
root.append(toolbar, notice, content);
const tabsRoot = toolbar.appendChild(element('div'));
const searchRoot = toolbar.appendChild(element('div', 'search'));
const actionsRoot = toolbar.appendChild(element('div', 'actions'));
const chooseRoot = actionsRoot.appendChild(element('div'));
const refreshRoot = actionsRoot.appendChild(element('div'));

const tabs = mountTabs(tabsRoot, {
  items: [],
  activeId: tab,
  onChange: (next) => {
    const found = TABS.find((item) => item === next);
    if (!found) return;
    tab = found;
    render();
  },
});
const search = mountSearchField(searchRoot, {
  value: query,
  onChange: (next) => { query = next; search.update({ value: next }); render(); },
});
const chooseButton = mountButton(chooseRoot, { label: '', size: 'sm', variant: 'ghost', onClick: () => { choosing = !choosing; render(); } });
const refreshButton = mountButton(refreshRoot, { label: '', size: 'sm', variant: 'outline', onClick: () => { void refresh(); } });

const toastError = (message: string): void => { void host.toast({ kind: 'error', message }); };

// ----- Loading -----

const load = async (): Promise<void> => {
  const current = ++generation;
  loading = true;
  render();
  try {
    const next = await service.readSites(directory);
    if (current !== generation) return;
    payload = next;
    failed = false;
    void matchProjects();
    if (next.loaded && next.insights === null) {
      setTimeout(() => { if (current === generation && document.visibilityState === 'visible') void load(); }, INSIGHTS_RETRY_MS);
    }
  } catch {
    if (current === generation) failed = true;
  } finally {
    if (current === generation) { loading = false; render(); }
  }
};

const refresh = async (): Promise<void> => {
  if (refreshing) return;
  refreshing = true;
  render();
  try {
    await service.refresh();
  } catch (error) {
    toastError(error instanceof Error ? error.message : t('panel.serviceFailed.title'));
  } finally {
    refreshing = false;
    await load();
  }
};

/** Saves which sites are hidden. The list changes at once and goes back if the save fails. */
let saveQueue: Promise<void> = Promise.resolve();
const setHidden = (next: number[]): void => {
  if (!payload) return;
  const previous = payload.hidden;
  const hidden = [...new Set(next)].sort((a, b) => a - b);
  payload = { ...payload, hidden };
  render();
  saveQueue = saveQueue.then(async () => {
    try {
      await service.saveHidden(hidden);
    } catch (error) {
      if (payload) { payload = { ...payload, hidden: previous }; render(); }
      toastError(t('panel.saveFailed', { message: (error as Error).message }));
    }
  });
};

const toggle = (ids: number[], show: boolean): void => {
  if (!payload) return;
  const hidden = new Set(payload.hidden);
  for (const id of ids) { if (show) hidden.delete(id); else hidden.add(id); }
  setHidden([...hidden]);
};

// ----- Fix sessions -----

/** Asks the service which project each site is deployed from, when the projects or the sites changed. */
const matchProjects = async (): Promise<void> => {
  if (!projects || !payload?.loaded) return;
  const key = `${projects.map((project) => `${project.id}=${project.directory}`).join('|')}#${payload.sites.map((site) => site.id).join(',')}`;
  if (key === matchKey) return;
  try {
    const matches = await service.matchProjects(projects);
    if (!matches) return;
    siteProjects = matches;
    matchKey = key;
    render();
  } catch { /* the button stays hidden; the next read tries again */ }
};

const projectOf = (siteId: number): GuestProject | undefined => projects?.find((item) => item.id === siteProjects.get(siteId));

const fixState = (siteId: number): FixState => {
  if (projectsDenied) return { kind: 'denied' };
  if (!projects) return { kind: 'unknown' };
  const project = projectOf(siteId);
  return project ? { kind: 'ready', project: project.name, starting: startingFix.has(siteId) } : { kind: 'no-project' };
};

const startFix = async (siteId: number): Promise<void> => {
  if (!payload || startingFix.has(siteId)) return;
  // The whole site, not what the filter shows.
  const group = buildInsightsModel(payload).sites.find((item) => item.site.id === siteId);
  const project = projectOf(siteId);
  if (!group || !project) return;
  startingFix.add(siteId);
  render();
  try {
    const result = await host.startSession({
      providerId: 'ploi',
      id: `insights-${siteId}`,
      title: t('fix.title', { domain: group.site.domain }),
      url: group.site.ploiUrl,
      text: buildFixPrompt({
        domain: group.site.domain,
        siteId,
        serverName: group.server?.name ?? null,
        serverId: group.site.serverId,
        items: group.items.map(({ insight, findings }) => ({ type: insight.type, summary: insight.summary, findings })),
      }),
      projectId: project.id,
      navigation: 'open',
    });
    if (result.sent === 'sent') void host.toast({ kind: 'success', message: t('fix.started', { project: project.name }) });
    else void host.toast({ kind: 'error', message: t('fix.notSent', { project: project.name }), persistent: true });
  } catch (error) {
    if (error instanceof HostRequestError && error.code === 'NOT_GRANTED') projectsDenied = true;
    toastError(t('fix.failed', { message: (error as Error).message }));
  } finally {
    startingFix.delete(siteId);
    render();
  }
};

// ----- Rendering -----

const when = (date: string | number): string => {
  const at = typeof date === 'number' ? date : parsePloiDate(date);
  return at === null ? String(date) : relativeTime(locale, at);
};

const siteRow = (site: SiteEntry, matchedBy?: string): HTMLElement => {
  const row = element('div', `site${matchedBy ? ' project' : ''}`);
  const main = row.appendChild(button('main', () => { void host.openUrl(site.ploiUrl); }));
  const { value, tone } = checkValue(t, site.checkedAt === null ? undefined : site);
  main.append(dot(site.health), element('span', 'domain', site.domain), element('span', `value ${tone === 'error' || tone === 'warning' ? tone : ''}`, value));
  main.title = [
    t('panel.openPloi'),
    site.repository ?? '',
    site.lastDeployAt ? t('panel.deployed', { when: when(site.lastDeployAt) }) : t('panel.neverDeployed'),
    site.checkedAt ? t('panel.checked', { when: when(site.checkedAt) }) : '',
    matchedBy ?? '',
  ].filter(Boolean).join('\n');
  const external = row.appendChild(button('external', () => { void host.openUrl(site.url); }, '↗'));
  external.title = `${t('panel.openSite')}\n${site.url}`;
  external.setAttribute('aria-label', `${t('panel.openSite')} ${site.domain}`);
  return row;
};

/** A site with its checkbox, in the choose mode. */
const chooseRow = (site: SiteEntry, hidden: Set<number>): HTMLElement => {
  const row = element('div', 'choose');
  mountCheckbox(row, { label: site.domain, checked: !hidden.has(site.id), onChange: (checked) => { toggle([site.id], checked); } });
  return row;
};

const chooseServerRow = (group: ServerGroup, hidden: Set<number>): HTMLElement => {
  const line = element('div', 'server choose');
  const ids = group.allSiteIds;
  mountCheckbox(line, {
    label: group.server?.name ?? `#${group.serverId}`,
    checked: ids.length > 0 && ids.every((id) => !hidden.has(id)),
    disabled: !ids.length,
    description: t('panel.sites', { count: ids.length }),
    onChange: (checked) => { toggle(ids, checked); },
  });
  return line;
};

const serverRow = (group: ServerGroup): HTMLElement => {
  const { server, total } = group;
  const line = server ? button('server', () => { void host.openUrl(server.ploiUrl); }) : element('div', 'server');
  const active = server?.status === 'active';
  const allChecked = group.up + group.failing === total;
  line.append(dot(!active || group.failing ? 'down' : allChecked && total ? 'up' : 'unknown'));
  line.append(element('span', 'name', server?.name ?? `#${group.serverId}`));
  if (server?.ip) line.append(element('span', 'ip', server.ip));
  if (server && server.securityUpdates > 0) line.append(element('span', 'pill error', t('server.security', { count: server.securityUpdates })));
  const count = server && !active ? server.status : t('server.sites', { up: group.up, total });
  line.append(element('span', `count${group.failing ? ' bad' : ''}`, count));
  if (server) line.title = [t('panel.openPloi'), t('tooltip.server', { ip: server.ip ?? '—', php: server.php ?? '—', uptime: server.uptime ?? '' }).trim()].join('\n');
  return line;
};

const renderToolbar = (): void => {
  const overview = payload?.loaded ? buildModel(payload, '', 'all') : null;
  tabs.update({
    items: [
      { id: 'all', label: t('panel.tab.all'), count: overview?.visibleCount },
      { id: 'problems', label: t('panel.tab.problems'), count: overview?.problems },
      { id: 'insights', label: t('panel.tab.insights'), count: payload?.loaded && payload.insights ? buildInsightsModel(payload).total : undefined },
    ],
    activeId: tab,
  });
  tabsRoot.hidden = choosing;
  refreshRoot.hidden = choosing;
  search.update({ placeholder: t('panel.search') });
  chooseButton.update({ label: choosing ? t('panel.done') : t('panel.choose'), variant: choosing ? 'default' : 'ghost', disabled: !payload?.sites.length });
  refreshButton.update({ label: t('control.refresh'), loading: refreshing, disabled: refreshing });
};

const renderChoose = (data: SitesPayload): void => {
  const hidden = new Set(data.hidden);
  const model = buildModel(data, query, tab, true);
  const bar = content.appendChild(element('div', 'choosebar'));
  bar.append(element('span', 'hint', t('panel.chooseHint')));
  if (model.hiddenCount) mountButton(bar.appendChild(element('div')), { label: t('panel.showAll'), size: 'xs', variant: 'outline', onClick: () => { setHidden([]); } });
  if (!model.groups.length) content.append(element('div', 'hint', t('panel.noMatch')));
  for (const group of model.groups) {
    content.append(chooseServerRow(group, hidden));
    for (const site of group.sites) content.append(chooseRow(site, hidden));
  }
};

const renderSites = (data: SitesPayload): void => {
  const model = buildModel(data, query, tab);
  // The open project's site stays in its server's list, in bold, with how it was found.
  const matchedBy = new Map(model.project.map(({ site, by }) => [site.id, t('panel.matchedBy', {
    by: by === 'repository' ? t('project.by.repository', { repo: site.repository ?? '' }) : t('project.by.appUrl'),
  })]));
  content.append(heading(t('panel.servers'), model.hiddenCount ? `· ${t('panel.hiddenCount', { count: model.hiddenCount })}` : undefined));
  if (!model.groups.length) {
    let text = t('panel.noMatch');
    if (!query.trim() && tab === 'problems') text = t('problems.none');
    else if (!query.trim() && model.hiddenCount === data.sites.length) text = t('panel.allHidden');
    content.append(element('div', 'hint', text));
    return;
  }
  for (const group of model.groups) {
    content.append(serverRow(group));
    for (const site of group.sites) content.append(siteRow(site, matchedBy.get(site.id)));
  }
};

function render(): void {
  renderToolbar();
  notice.replaceChildren();
  content.replaceChildren();

  if (failed && !payload) {
    mountEmpty(content, {
      title: t('panel.serviceFailed.title'),
      body: t('panel.serviceFailed.body'),
      action: { label: t('panel.retry'), onClick: () => { void load(); } },
    });
    return;
  }
  if (payload?.problem) mountBanner(notice.appendChild(element('div')), { tone: 'error', title: t(payload.problem.key, payload.problem.params) });
  if (!payload?.loaded) {
    if (!payload?.problem) mountSpinner(content, { label: t('loading') });
    return;
  }
  if (!payload.sites.length) { mountEmpty(content, { title: t('empty') }); return; }

  if (choosing) renderChoose(payload);
  else if (tab === 'insights') {
    renderInsights(content, payload, {
      t,
      query,
      openUrl: (url) => { void host.openUrl(url); },
      isOpen: (siteId) => openInsightSites.has(siteId),
      setOpen: (siteId, open) => { if (open) openInsightSites.add(siteId); else openInsightSites.delete(siteId); },
      fixState,
      onFix: (siteId) => { void startFix(siteId); },
    });
  } else renderSites(payload);
}

// ----- Host events -----

host.onServiceEvent(({ topic }) => { if (topic === 'sites-updated') void load(); });

const loadIfVisible = (): void => { if (document.visibilityState === 'visible' && !loading) void load(); };
setInterval(loadIfVisible, REFRESH_MS);
document.addEventListener('visibilitychange', loadIfVisible);

const watchProjects = (): void => {
  host.onProjects((snapshot) => {
    // Only `ready` proves an empty list; a loading or failed snapshot without projects says nothing yet.
    if (snapshot.state !== 'ready' && !snapshot.projects.length) return;
    projects = snapshot.projects;
    void matchProjects();
    render();
  }).catch((error: unknown) => {
    projectsDenied = error instanceof HostRequestError && error.code === 'NOT_GRANTED';
    render();
  });
};

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  const nextLocale = resolveLocale(context.locale);
  const localeChanged = nextLocale !== locale;
  locale = nextLocale;
  t = translator(locale);
  const directoryChanged = context.directory !== directory;
  directory = context.directory;
  if (!mounted) watchProjects();
  if (!mounted || directoryChanged) {
    mounted = true;
    void load();
  } else if (localeChanged) {
    render();
  }
});

render();
