import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { decodeEntities, parseInsightList, parseInsightSites, plainSummary, worstSeverity } from '../src/insights.ts';

const fixture = (name: string) => readFileSync(path.join(import.meta.dir, 'fixtures', `insight-${name}.html`), 'utf8');

describe('insight explanations', () => {
  test('npm vulnerabilities are split per site, with every finding', () => {
    const sites = parseInsightSites(fixture('npm'));
    expect(sites.map((site) => [site.siteId, site.findings.length])).toEqual([[2001, 14], [2002, 15], [2003, 3], [2004, 9], [2005, 9], [2006, 3]]);
    expect(sites[2]!.findings[0]).toEqual({
      severity: 'critical',
      package: 'shell-quote',
      title: 'shell-quote: `quote()` command injection via a line terminator in a token after a `{ comment }` token',
      cve: null,
      fixAvailable: true,
      url: 'https://github.com/advisories/GHSA-pqg4-j6r4-53mv',
    });
  });

  test('composer findings keep their CVE and decode entities', () => {
    const [first] = parseInsightSites(fixture('composer'));
    expect(first!.siteId).toBe(2001);
    expect(first!.findings[0]).toMatchObject({ severity: 'critical', package: 'laravel/framework', cve: 'CVE-2026-114509', fixAvailable: false });
    expect(first!.findings[0]!.title).toBe('Laravel TokenGuard authentication bypass through non-string API credentials');
  });

  test('a certificate failure becomes one finding with its error, not the recommended actions', () => {
    const sites = parseInsightSites(fixture('cert'));
    expect(sites).toHaveLength(1);
    expect(sites[0]!.siteId).toBe(2007);
    expect(sites[0]!.findings).toHaveLength(1);
    expect(sites[0]!.findings[0]!.title).toContain('Failures detected: 2');
    expect(sites[0]!.findings[0]!.title).toContain('Some challenges have failed.');
    expect(sites[0]!.findings[0]!.title).not.toContain('Recommended');
  });

  test('an explanation without site links has no sites', () => {
    expect(parseInsightSites('<h2>Explanation</h2><p>Disk almost full</p>')).toEqual([]);
  });
});

describe('insight list', () => {
  test('only open insights, summary without markdown', () => {
    const list = parseInsightList({ data: [
      { id: 1, type: 'npm-vulnerabilities', status: 'open', priority: 'high', description: 'Found **53 NPM** issues', server_id: 9, created_at: '2026-08-26 05:43:15' },
      { id: 2, type: 'x', status: 'ignored' },
    ] }, 9);
    expect(list).toEqual([{ id: 1, serverId: 9, type: 'npm-vulnerabilities', priority: 'high', summary: 'Found 53 NPM issues', createdAt: '2026-08-26 05:43:15', sites: [] }]);
  });
  test('helpers', () => {
    expect(decodeEntities('a &#039;b&#039; &rarr; &amp;')).toBe("a 'b' → &");
    expect(plainSummary('There are **1 SSL**  certs')).toBe('There are 1 SSL certs');
    expect(worstSeverity([{ severity: 'high' } as never, { severity: 'critical' } as never])).toBe('critical');
    expect(worstSeverity([{ severity: null } as never], 'high')).toBe('high');
  });
});
