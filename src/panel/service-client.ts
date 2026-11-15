// The panel's calls to the extension's local service, each answer checked before use.
import type { GuestProject, HostClient } from '@openchamber/sdk';

import { isSitesPayload, type SitesPayload } from '../sites-contract.ts';

type Request = Parameters<HostClient['serviceRequest']>[0];

/** The service's `{ message }`, else the HTTP status. */
const failureOf = (status: number, body: string): Error => {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof message === 'string' && message) return new Error(message);
  } catch { /* not JSON: keep the status */ }
  return new Error(`HTTP ${status}`);
};

export const createServiceClient = (host: Pick<HostClient, 'serviceRequest'>) => {
  const ask = async (request: Request): Promise<unknown> => {
    const result = await host.serviceRequest(request);
    if (result.status !== 200) throw failureOf(result.status, result.body);
    return JSON.parse(result.body) as unknown;
  };

  return {
    readSites: async (directory: string | null): Promise<SitesPayload> => {
      const body = await ask({ method: 'GET', path: '/sites', query: directory ? { directory } : {} });
      if (!isSitesPayload(body)) throw new Error('Unexpected /sites answer');
      return body;
    },
    refresh: async (): Promise<void> => { await ask({ method: 'POST', path: '/refresh', body: '{}' }); },
    saveHidden: async (hidden: number[]): Promise<void> => { await ask({ method: 'POST', path: '/hidden', body: JSON.stringify({ hidden }) }); },
    /** The project each site is deployed from; `null` while the service has not read Ploi yet. */
    matchProjects: async (projects: GuestProject[]): Promise<Map<number, string> | null> => {
      const body = JSON.stringify({ projects: projects.map(({ id, directory }) => ({ id, directory })) });
      const answer = await ask({ method: 'POST', path: '/projects', body }) as { ready?: boolean; matches?: Record<string, { projectId?: unknown }> };
      if (!answer.ready) return null;
      return new Map(Object.entries(answer.matches ?? {}).flatMap(([siteId, match]) =>
        (typeof match.projectId === 'string' ? [[Number(siteId), match.projectId] as const] : [])));
    },
  };
};
