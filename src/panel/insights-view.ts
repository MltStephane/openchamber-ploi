// The Insights tab: open Ploi insights per site, unfolded on demand, with the "Fix the findings" button.
import { mountButton, mountSpinner } from '@openchamber/sdk/ui';

import { DICTIONARIES, type MessageKey, type Translate } from '../i18n.ts';
import { prioritySeverity, type Finding, type Severity } from '../insights.ts';
import type { SitesPayload } from '../sites-contract.ts';
import { buildInsightsModel, type ServerInsight, type SiteInsights } from './insights-model.ts';
import { button, element, heading } from './view.ts';

/** Whether a site can get a fix session, and in which project. */
export type FixState =
  | { kind: 'unknown' }
  | { kind: 'denied' }
  | { kind: 'no-project' }
  | { kind: 'ready'; project: string; starting: boolean };

export type InsightsContext = {
  t: Translate;
  query: string;
  openUrl: (url: string) => void;
  isOpen: (siteId: number) => boolean;
  setOpen: (siteId: number, open: boolean) => void;
  fixState: (siteId: number) => FixState;
  onFix: (siteId: number) => void;
};

const typeLabel = (t: Translate, type: string): string => {
  const key = `insight.type.${type}`;
  return key in DICTIONARIES.en ? t(key as MessageKey) : type.replace(/[-_]+/g, ' ').replace(/^./, (first) => first.toUpperCase());
};

const severityPill = (severity: Severity | null, text: string): HTMLElement => element('span', `pill sev-${severity ?? 'none'}`, text);

const findingRow = (ctx: InsightsContext, finding: Finding): HTMLElement => {
  const { t } = ctx;
  const url = finding.url;
  const row = url ? button('finding', () => { ctx.openUrl(url); }) : element('div', 'finding');
  if (finding.severity) row.append(severityPill(finding.severity, t(`severity.name.${finding.severity}`)));
  const text = row.appendChild(element('span', 'text'));
  if (finding.package) text.append(element('strong', '', finding.package), ' ');
  text.append(finding.title);
  if (finding.fixAvailable) row.append(element('span', 'fix', t('insights.fix')));
  row.title = [finding.package, finding.title, finding.cve, url ? t('insights.openAdvisory') : null].filter(Boolean).join('\n');
  return row;
};

const fixRow = (ctx: InsightsContext, siteId: number): HTMLElement => {
  const { t } = ctx;
  const row = element('div', 'fix-row');
  const state = ctx.fixState(siteId);
  if (state.kind === 'denied') row.append(element('span', 'hint', t('fix.notGranted')));
  if (state.kind === 'no-project') row.append(element('span', 'hint', t('fix.noProject')));
  if (state.kind === 'ready') {
    const holder = row.appendChild(element('div'));
    holder.title = t('fix.tooltip', { project: state.project });
    mountButton(holder, {
      label: t('fix.button'), size: 'xs', variant: 'default', loading: state.starting, disabled: state.starting,
      onClick: () => { ctx.onFix(siteId); },
    });
    row.append(element('span', 'hint', state.project));
  }
  return row;
};

const siteSection = (ctx: InsightsContext, group: SiteInsights): HTMLElement => {
  const { t } = ctx;
  const siteId = group.site.id;
  const details = element('details', 'insight-site');
  details.open = ctx.isOpen(siteId);
  details.addEventListener('toggle', () => { ctx.setOpen(siteId, details.open); });

  const summary = details.appendChild(element('summary'));
  summary.append(severityPill(group.worst, String(group.count)), element('span', 'domain', group.site.domain));
  if (group.server) summary.append(element('span', 'tag', group.server.name));
  const counts = group.bySeverity.map(({ severity, count }) => t(`severity.${severity}`, { count })).join(' · ');
  summary.title = counts || t('insights.findings', { count: group.count });

  const body = details.appendChild(element('div', 'insight-body'));
  if (counts) body.append(element('div', 'hint', counts));
  body.append(fixRow(ctx, siteId));
  for (const { insight, findings } of group.items) {
    const head = body.appendChild(button('insight-head', () => { ctx.openUrl(insight.ploiUrl); }));
    head.append(element('span', 'name', typeLabel(t, insight.type)), element('span', 'count', t('insights.findings', { count: findings.length })), element('span', 'go', '↗'));
    head.title = `${insight.summary}\n${t('insights.openPloi')}`;
    for (const finding of findings) body.append(findingRow(ctx, finding));
  }
  const site = body.appendChild(button('insight-head site-link', () => { ctx.openUrl(group.site.ploiUrl); }));
  site.append(element('span', 'name', t('panel.openPloi')), element('span', 'go', '↗'));
  return details;
};

const serverRow = (ctx: InsightsContext, { insight, server }: ServerInsight): HTMLElement => {
  const { t } = ctx;
  const row = button('insight-head server-insight', () => { ctx.openUrl(insight.ploiUrl); });
  row.append(
    severityPill(prioritySeverity(insight.priority) ?? 'low', server?.name ?? `#${insight.serverId}`),
    element('span', 'name', `${typeLabel(t, insight.type)} — ${insight.summary}`),
    element('span', 'go', '↗'),
  );
  row.title = `${insight.summary}\n${t('insights.openPloi')}`;
  return row;
};

export const renderInsights = (content: HTMLElement, payload: SitesPayload, ctx: InsightsContext): void => {
  const { t } = ctx;
  if (payload.insights === null) { mountSpinner(content, { label: t('insights.loading') }); return; }
  const model = buildInsightsModel(payload, ctx.query);
  if (!model.total) { content.append(element('div', 'hint', ctx.query.trim() ? t('panel.noMatch') : t('insights.none'))); return; }
  if (model.sites.length) {
    content.append(heading(t('insights.sites')));
    for (const group of model.sites) content.append(siteSection(ctx, group));
  }
  if (model.servers.length) {
    content.append(heading(t('insights.server')));
    for (const entry of model.servers) content.append(serverRow(ctx, entry));
  }
};
