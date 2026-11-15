import { describe, expect, test } from 'bun:test';

import { buildFixPrompt, FIX_PROMPT_MAX } from '../src/fix-prompt.ts';
import type { Site } from '../src/ploi.ts';
import { projectsBySite } from '../src/project.ts';

const finding = (title: string, extra = {}) => ({ severity: 'high' as const, package: 'axios', title, cve: null, fixAvailable: true, url: 'https://github.com/advisories/GHSA-x', ...extra });

describe('fix prompt', () => {
  test('names the site, lists each finding, says what to do and not to deploy', () => {
    const text = buildFixPrompt({
      domain: 'app.fr', siteId: 7, serverName: 'vps-prod', serverId: 3,
      items: [
        { type: 'npm-vulnerabilities', summary: 'npm', findings: [finding('ReDoS'), finding('Injection', { severity: 'critical', package: 'shell-quote', cve: 'CVE-2026-1' })] },
        { type: 'disk-usage', summary: 'Disk almost full', findings: [] },
      ],
    });
    expect(text).toContain('app.fr (Ploi site_id 7 on vps-prod (server_id 3))');
    expect(text).toContain('## npm vulnerabilities (2)');
    expect(text).toContain('- [HIGH] axios: ReDoS — fix available — https://github.com/advisories/GHSA-x');
    expect(text).toContain('- [CRITICAL] shell-quote: Injection (CVE-2026-1) — fix available');
    expect(text).toContain('## disk usage (0)\n- Disk almost full');
    expect(text).toContain('Do not deploy');
  });

  test('stays under the host limit and says how many were left out', () => {
    const findings = Array.from({ length: 400 }, (_, index) => finding(`Vulnerability number ${index} `.repeat(4)));
    const text = buildFixPrompt({ domain: 'a.fr', siteId: 1, serverName: null, serverId: 2, items: [{ type: 'composer-vulnerabilities', summary: '', findings }] });
    expect(text.length).toBeLessThanOrEqual(FIX_PROMPT_MAX + 50);
    expect(text).toMatch(/\(\d+ more findings are not listed here/);
    expect(text).toContain('## What to do');
  });
});

describe('projects by site', () => {
  const site = (id: number, domain: string, owner: string | null): Site => ({
    id, serverId: 1, domain, healthUrl: null, lastDeployAt: null,
    repository: owner ? { provider: 'github', owner, name: 'app', branch: 'main' } : null,
  });
  const sites = [site(1, 'app.fr', 'me'), site(2, 'staging.app.fr', 'me'), site(3, 'other.fr', null)];

  test('a repository match beats an APP_URL match, the first project wins a tie', () => {
    const map = projectsBySite([
      { id: 'by-url', identity: { remote: null, appHosts: ['app.fr', 'other.fr'] } },
      { id: 'repo-a', identity: { remote: { host: 'github.com', owner: 'me', name: 'app' }, appHosts: [] } },
      { id: 'repo-b', identity: { remote: { host: 'github.com', owner: 'me', name: 'app' }, appHosts: [] } },
    ], sites);
    expect(Object.fromEntries(map)).toEqual({
      1: { projectId: 'repo-a', by: 'repository' },
      2: { projectId: 'repo-a', by: 'repository' },
      3: { projectId: 'by-url', by: 'app-url' },
    });
  });
});
