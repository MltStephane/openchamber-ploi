// Ploi insights: server findings (vulnerable dependencies, failed certificate renewals…). Ploi files them
// per server, but each explanation links the sites it concerns (`/panel/servers/{id}/sites/{id}`), so
// they are split per site from there. Pure: parsing only, tested against real answers in test/fixtures.

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'info';

export type Finding = {
  severity: Severity | null;
  /** The dependency, for a vulnerability. */
  package: string | null;
  title: string;
  cve: string | null;
  fixAvailable: boolean;
  /** An advisory or documentation link (https only). */
  url: string | null;
};

export type InsightSite = { siteId: number; findings: Finding[] };

export type Insight = {
  id: number;
  serverId: number;
  type: string;
  priority: string;
  summary: string;
  createdAt: string | null;
  sites: InsightSite[];
};

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', centerdot: '·', middot: '·', hellip: '…', mdash: '—', ndash: '–',
};

export const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === '#') {
    const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[name.toLowerCase()] ?? whole;
});

/** Plain text of an HTML fragment, whitespace collapsed. */
const textOf = (html: string): string =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The description is short Markdown (`**bold**`); keep the words. */
export const plainSummary = (markdown: string): string => markdown.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

const SEVERITIES: Record<string, Severity> = { critical: 'critical', high: 'high', moderate: 'moderate', medium: 'moderate', low: 'low', info: 'info' };

const parseFinding = (html: string): Finding | null => {
  const severityMatch = /<span[^>]*>\s*(CRITICAL|HIGH|MODERATE|MEDIUM|LOW|INFO)\s*<\/span>/i.exec(html);
  const severity = severityMatch ? SEVERITIES[severityMatch[1]!.toLowerCase()] ?? null : null;
  const packageMatch = /<strong>([\s\S]*?)<\/strong>\s*:/.exec(html);
  const pkg = packageMatch ? textOf(packageMatch[1]!) : null;
  const url = /<a\s[^>]*href="(https:\/\/[^"]+)"/i.exec(html)?.[1] ?? null;
  const cve = /\b(CVE-\d{4}-\d{4,})\b/.exec(html)?.[1] ?? null;
  const fixAvailable = /fix available/i.test(html);
  let body = html;
  if (severityMatch) body = body.replace(severityMatch[0], ' ');
  if (packageMatch) body = body.replace(packageMatch[0], ' ');
  body = body.replace(/<a\s[^>]*>\s*More info[\s\S]*?<\/a>/gi, ' ').replace(/<span[^>]*>\s*\((?:fix available|CVE-[^)]*)\)\s*<\/span>/gi, ' ');
  const title = decodeEntities(textOf(body)).replace(/^[·:\s]+/, '');
  if (!title && !pkg) return null;
  return { severity, package: pkg, title: decodeEntities(title || pkg || ''), cve, fixAvailable, url: url ? decodeEntities(url) : null };
};

const SITE_LINK = /<a\s[^>]*href="\/panel\/servers\/(\d+)\/sites\/(\d+)"[^>]*>[\s\S]*?<\/a>/gi;

/** Splits an insight explanation into the sites it links, each with its findings. */
export const parseInsightSites = (html: string): InsightSite[] => {
  const links = [...html.matchAll(SITE_LINK)];
  const bySite = new Map<number, Finding[]>();
  links.forEach((link, index) => {
    const siteId = Number(link[2]);
    const start = link.index! + link[0].length;
    const next = links[index + 1]?.index ?? html.length;
    const heading = html.slice(start).search(/<h[23][\s>]/i);
    let segment = html.slice(start, Math.min(next, heading === -1 ? html.length : start + heading));
    const items = [...segment.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]!);
    const findings: Finding[] = [];
    if (items.length) {
      for (const item of items) { const finding = parseFinding(item); if (finding) findings.push(finding); }
    } else {
      // The link sits inside the item itself (certificate failures): the item's rest is the detail.
      const end = segment.search(/<\/li>/i);
      if (end !== -1) segment = segment.slice(0, end);
      const finding = parseFinding(segment);
      if (finding) findings.push(finding);
    }
    bySite.set(siteId, [...(bySite.get(siteId) ?? []), ...findings]);
  });
  return [...bySite].map(([siteId, findings]) => ({ siteId, findings }));
};

const list = (payload: unknown): Record<string, unknown>[] => {
  const data = (payload as { data?: unknown })?.data ?? payload;
  return Array.isArray(data) ? data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
};

/** The open insights of one server (`list-server-insights`), without their explanation yet. */
export const parseInsightList = (payload: unknown, serverId: number): Insight[] => list(payload)
  .filter((raw) => (raw.status ?? 'open') === 'open')
  .map((raw) => ({
    id: Number(raw.id),
    serverId: Number(raw.server_id ?? serverId),
    type: typeof raw.type === 'string' ? raw.type : 'insight',
    priority: typeof raw.priority === 'string' ? raw.priority : 'low',
    summary: plainSummary(typeof raw.description === 'string' ? raw.description : ''),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
    sites: [],
  }))
  .filter((insight) => Number.isInteger(insight.id) && insight.id > 0);

/** The explanation of one insight (`get-server-insight`). */
export const explanationOf = (payload: unknown): string => {
  const data = ((payload as { data?: unknown })?.data ?? payload) as { html?: unknown } | null;
  return typeof data?.html === 'string' ? data.html : '';
};

const RANK: Record<Severity, number> = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };

export const severityRank = (severity: Severity | null): number => (severity ? RANK[severity] : -1);

/** The severity a Ploi priority stands for, for an insight whose findings carry none. */
export const prioritySeverity = (priority: string | undefined): Severity | null =>
  priority === 'high' ? 'high' : priority === 'medium' ? 'moderate' : priority === 'low' ? 'low' : null;

export const worstSeverity = (findings: Finding[], priority?: string): Severity | null => {
  const worst = findings.reduce<Severity | null>((best, finding) => (severityRank(finding.severity) > severityRank(best) ? finding.severity : best), null);
  return worst ?? prioritySeverity(priority);
};
