// What the open project is, in terms a Ploi site can be compared with: its git remote and its APP_URL.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Repository, Site } from './ploi.ts';

export type ProjectIdentity = { remote: { host: string; owner: string; name: string } | null; appHosts: string[] };
export type SiteMatch = { site: Site; by: 'repository' | 'app-url' };

const PROVIDER_HOSTS: Record<string, string> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };

/** `git@github.com:Owner/name.git`, `https://github.com/Owner/name`, `ssh://git@host/Owner/name.git`. */
export const parseRemote = (url: string): ProjectIdentity['remote'] => {
  const trimmed = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  let host: string;
  let repoPath: string;
  if (scp) {
    host = scp[1]!;
    repoPath = scp[2]!;
  } else {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      repoPath = parsed.pathname;
    } catch {
      return null;
    }
  }
  const parts = repoPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
  if (parts.length < 2) return null;
  return { host: host.toLowerCase(), owner: parts.slice(0, -1).join('/').toLowerCase(), name: parts.at(-1)!.toLowerCase() };
};

/** The host of `APP_URL=` in a dotenv text. Only that line is read. */
export const appUrlHost = (dotenv: string): string | null => {
  const line = /^\s*APP_URL\s*=\s*["']?([^"'\s#]+)/m.exec(dotenv);
  if (!line) return null;
  try { return new URL(line[1]!).hostname.toLowerCase(); } catch { return null; }
};

const gitRemote = (directory: string): Promise<string | null> => new Promise((resolve) => {
  execFile('git', ['-C', directory, 'remote', 'get-url', 'origin'], { timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    (error, stdout) => resolve(error ? null : stdout.trim() || null));
});

export const readIdentity = async (directory: string): Promise<ProjectIdentity> => {
  const remoteUrl = await gitRemote(directory);
  const hosts = new Set<string>();
  for (const file of ['.env', '.env.production']) {
    try {
      const host = appUrlHost(await readFile(path.join(directory, file), 'utf8'));
      if (host && host !== 'localhost' && !host.endsWith('.test') && !host.endsWith('.local')) hosts.add(host);
    } catch { /* no such file */ }
  }
  return { remote: remoteUrl ? parseRemote(remoteUrl) : null, appHosts: [...hosts] };
};

const sameRepository = (remote: NonNullable<ProjectIdentity['remote']>, repo: Repository): boolean => {
  const providerHost = PROVIDER_HOSTS[repo.provider.toLowerCase()];
  if (providerHost && providerHost !== remote.host) return false;
  return remote.owner === repo.owner.toLowerCase() && remote.name === repo.name.toLowerCase();
};

const stripWww = (host: string): string => host.replace(/^www\./, '');

export type ProjectRef = { id: string; directory: string };

/**
 * For each site, the first project deployed to it. A repository match beats an APP_URL match, whatever
 * the order of the projects.
 */
export const projectsBySite = (projects: { id: string; identity: ProjectIdentity }[], sites: Site[]): Map<number, { projectId: string; by: SiteMatch['by'] }> => {
  const result = new Map<number, { projectId: string; by: SiteMatch['by'] }>();
  for (const { id, identity } of projects) {
    for (const { site, by } of matchSites(identity, sites)) {
      const current = result.get(site.id);
      if (!current || (current.by === 'app-url' && by === 'repository')) result.set(site.id, { projectId: id, by });
    }
  }
  return result;
};

/** Sites deployed from the project's repository; else the sites whose domain is the project's APP_URL. */
export const matchSites = (identity: ProjectIdentity, sites: Site[]): SiteMatch[] => {
  const { remote } = identity;
  if (remote) {
    const byRepo = sites.filter((site) => site.repository && sameRepository(remote, site.repository));
    if (byRepo.length) return byRepo.map((site) => ({ site, by: 'repository' }));
  }
  const hosts = identity.appHosts.map(stripWww);
  return sites.filter((site) => hosts.includes(stripWww(site.domain.toLowerCase()))).map((site) => ({ site, by: 'app-url' }));
};
