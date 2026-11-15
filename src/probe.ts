// One HTTP check of a site: status code and response time, never the body.
export type ProbeError = 'timeout' | 'dns' | 'tls' | 'refused' | 'network';

export type Probe = {
  at: number;
  status: number | null;
  ms: number | null;
  error: ProbeError | null;
};

/** What a health or a label needs from a check: the panel has it without the time. */
export type CheckResult = Pick<Probe, 'status' | 'ms' | 'error'>;

export type Health = 'up' | 'slow' | 'degraded' | 'down' | 'unknown';

const TIMEOUT_MS = 10_000;
const SLOW_MS = 2000;

export const classifyError = (error: unknown): ProbeError => {
  const err = error as { name?: string; cause?: { code?: string } };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  const code = err.cause?.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'refused';
  if (/CERT|SSL|TLS/i.test(code)) return 'tls';
  return 'network';
};

export const probe = async (url: string, fetcher: typeof fetch = fetch): Promise<Probe> => {
  const start = performance.now();
  try {
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'openchamber-ploi (uptime check)', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - start);
    await response.body?.cancel().catch(() => undefined);
    return { at: Date.now(), status: response.status, ms, error: null };
  } catch (error) {
    return { at: Date.now(), status: null, ms: null, error: classifyError(error) };
  }
};

export const healthOf = (check: CheckResult | undefined): Health => {
  if (!check) return 'unknown';
  if (check.status === null || check.status >= 500) return 'down';
  // 401 and 403: the site answers behind a password (a staging site), which is how it should be.
  if (check.status >= 400 && check.status !== 401 && check.status !== 403) return 'degraded';
  if ((check.ms ?? 0) > SLOW_MS) return 'slow';
  return 'up';
};
