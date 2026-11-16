import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';

import { DICTIONARIES, resolveLocale, translator } from '../src/i18n.ts';
import { McpError, parseRpcBody, ploiMessage, toolPayload } from '../src/mcp-client.ts';
import { readCredential, TOKEN_SETTING } from '../src/credentials.ts';
import { parseRepository, parseServers, parseSites, siteUrl } from '../src/ploi.ts';
import { classifyError, healthOf, probe } from '../src/probe.ts';
import { appUrlHost, matchSites, parseRemote } from '../src/project.ts';

const shape = (dictionary: Record<string, string | object>) =>
  Object.entries(dictionary).map(([key, entry]) => [key, typeof entry === 'string' ? 'string' : Object.keys(entry).sort()]).sort();

describe('i18n', () => {
  test('French has the same keys and forms as English', () => {
    expect(shape(DICTIONARIES.fr)).toEqual(shape(DICTIONARIES.en));
  });
  test('locale falls back to English', () => {
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('pt-BR')).toBe('en');
    expect(resolveLocale(null)).toBe('en');
  });
  test('plurals and placeholders', () => {
    expect(translator('en')('server.security', { count: 2 })).toBe('2 security updates');
    expect(translator('fr')('server.sites', { up: 3, total: 4 })).toBe('3/4 en ligne');
  });
});

describe('credential', () => {
  test('the token comes from the integration card, trimmed', async () => {
    expect(await readCredential(async () => ({ [TOKEN_SETTING]: '  abc \n' }))).toEqual({ ok: true, token: 'abc' });
  });
  test('an empty or absent field is missing', async () => {
    expect(await readCredential(async () => ({ [TOKEN_SETTING]: '   ' }))).toEqual({ ok: false, reason: 'missing' });
    expect(await readCredential(async () => ({}))).toEqual({ ok: false, reason: 'missing' });
  });
  test('the manifest declares that field as a secret', async () => {
    const manifest = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text());
    expect(manifest.openchamber.contributes.integration.settings).toContainEqual(expect.objectContaining({ id: TOKEN_SETTING, secret: true }));
  });
  test('OpenChamber not answering is not a missing token', async () => {
    expect(await readCredential(() => Promise.reject(new Error('down')))).toEqual({ ok: false, reason: 'host' });
  });
});

describe('mcp client', () => {
  test('JSON and SSE answers', () => {
    expect(parseRpcBody('application/json', '{"id":3,"result":1}', 3).result).toBe(1);
    const sse = 'event: message\ndata: {"id":1,"result":"a"}\n\nevent: message\ndata: {"id":4,"result":"b"}\n\n';
    expect(parseRpcBody('text/event-stream', sse, 4).result).toBe('b');
  });
  test('Ploi error messages', () => {
    expect(ploiMessage('{"message":"This IP address is not allowed to interact with the API."}')).toBe('This IP address is not allowed to interact with the API.');
    expect(ploiMessage('<html>')).toBe('');
  });
  test('tool payloads', () => {
    expect(toolPayload({ content: [{ type: 'text', text: '{"data":[1]}' }] })).toEqual({ data: [1] });
    expect(toolPayload({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(() => toolPayload({ isError: true, content: [{ type: 'text', text: 'nope' }] })).toThrow(McpError);
  });
});

describe('ploi', () => {
  test('servers, sites and repositories are normalised', () => {
    const [server] = parseServers({ data: [{ id: 1, name: 'vps', status: 'active', reboot_required: true, updates: { security: 2 } }] });
    expect(server).toMatchObject({ id: 1, rebootRequired: true, securityUpdates: 2 });
    expect(parseSites({ data: [{ id: 5, server_id: 1, domain: 'a.fr' }, { id: 6 }] })).toHaveLength(1);
    expect(parseRepository({ data: { repository: { user: 'Me', name: 'app', provider: 'github', branch: 'main' } } }))
      .toEqual({ owner: 'Me', name: 'app', provider: 'github', branch: 'main' });
    expect(parseRepository({ data: { repository: null } })).toBeNull();
  });
  test('the health URL wins over the domain', () => {
    expect(siteUrl({ id: 1, serverId: 1, domain: 'a.fr', healthUrl: null, lastDeployAt: null })).toBe('https://a.fr/');
    expect(siteUrl({ id: 1, serverId: 1, domain: 'a.fr', healthUrl: 'https://a.fr/up', lastDeployAt: null })).toBe('https://a.fr/up');
  });
});

describe('project matching', () => {
  test('remotes in every form', () => {
    expect(parseRemote('git@github.com:Acme/Shop.git')).toEqual({ host: 'github.com', owner: 'acme', name: 'shop' });
    expect(parseRemote('https://github.com/Acme/shop')).toEqual({ host: 'github.com', owner: 'acme', name: 'shop' });
    expect(parseRemote('ssh://git@gitlab.com/group/sub/app.git')).toEqual({ host: 'gitlab.com', owner: 'group/sub', name: 'app' });
    expect(parseRemote('nonsense')).toBeNull();
  });
  test('APP_URL host', () => {
    expect(appUrlHost('A=1\nAPP_URL="https://www.app.fr/x"\n')).toBe('www.app.fr');
    expect(appUrlHost('NOPE=1')).toBeNull();
  });
  const site = (id: number, domain: string, owner?: string, provider = 'github') => ({
    id, serverId: 1, domain, healthUrl: null, lastDeployAt: null,
    repository: owner ? { provider, owner, name: 'app', branch: 'main' } : null,
  });
  test('repository first, then APP_URL', () => {
    const sites = [site(1, 'app.fr', 'Me'), site(2, 'staging.app.fr', 'Me'), site(3, 'other.fr')];
    const remote = { host: 'github.com', owner: 'me', name: 'app' };
    expect(matchSites({ remote, appHosts: [] }, sites).map((m) => m.site.id)).toEqual([1, 2]);
    expect(matchSites({ remote: null, appHosts: ['www.other.fr'] }, sites)).toEqual([{ site: sites[2]!, by: 'app-url' }]);
    expect(matchSites({ remote: { ...remote, host: 'gitlab.com' }, appHosts: [] }, sites)).toEqual([]);
  });
});

describe('probe', () => {
  test('health from status and time', () => {
    const base = { at: 0, error: null };
    expect(healthOf(undefined)).toBe('unknown');
    expect(healthOf({ ...base, status: 200, ms: 100 })).toBe('up');
    expect(healthOf({ ...base, status: 200, ms: 3000 })).toBe('slow');
    expect(healthOf({ ...base, status: 404, ms: 10 })).toBe('degraded');
    expect(healthOf({ ...base, status: 401, ms: 10 })).toBe('up');
    expect(healthOf({ ...base, status: 503, ms: 10 })).toBe('down');
    expect(healthOf({ ...base, status: null, ms: null, error: 'dns' })).toBe('down');
  });
  test('errors are classified', () => {
    expect(classifyError({ name: 'TimeoutError' })).toBe('timeout');
    expect(classifyError({ cause: { code: 'ENOTFOUND' } })).toBe('dns');
    expect(classifyError({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } })).toBe('tls');
  });
  test('a fetch failure becomes a down probe', async () => {
    const failing = (() => Promise.reject(Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }))) as unknown as typeof fetch;
    expect(await probe('https://x', failing)).toMatchObject({ status: null, error: 'refused' });
    const ok = (() => Promise.resolve(new Response('hi', { status: 200 }))) as unknown as typeof fetch;
    expect(await probe('https://x', ok)).toMatchObject({ status: 200 });
  });
});

describe('preferences', () => {
  test('missing or broken file means nothing hidden; ids are cleaned on write', async () => {
    const { readPreferences, writePreferences } = await import('../src/preferences.ts');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sites-'));
    const file = path.join(dir, 'sub', 'preferences.json');
    const legacy = path.join(dir, 'legacy.json');
    expect(await readPreferences(file, legacy)).toEqual({ hidden: [] });
    await writeFile(legacy, JSON.stringify({ hidden: [9] }));
    expect(await readPreferences(file, legacy)).toEqual({ hidden: [9] });
    await writePreferences({ hidden: [5, 3, 5, -1, 2.5] as number[] }, file);
    expect(await readPreferences(file, legacy)).toEqual({ hidden: [3, 5] });
    await writeFile(file, '{oops');
    expect(await readPreferences(file, legacy)).toEqual({ hidden: [] });
  });
});
