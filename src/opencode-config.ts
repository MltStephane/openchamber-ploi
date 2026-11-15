// Finds the Ploi MCP server the user configured in OpenCode, so the extension reuses the
// same URL and credential instead of asking for a second token.
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MCP_NAME = 'ploi';

export type McpEndpoint = { name: string; url: string; headers: Record<string, string> };

export type McpLookup =
  | { ok: true; endpoint: McpEndpoint }
  | { ok: false; reason: 'not-configured' | 'disabled' | 'not-remote' | 'unresolved'; detail?: string };

type McpEntry = {
  type?: string;
  url?: string;
  enabled?: boolean;
  headers?: Record<string, unknown>;
};

/** Removes `//` and `/* *\/` comments and trailing commas outside strings, so JSONC parses as JSON. */
export const stripJsonc = (text: string): string => {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      out += char;
      if (char === '\\') { out += text[i + 1] ?? ''; i += 1; } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (char === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; continue; }
    out += char;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

const configCandidates = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const dir = path.join(base, 'opencode');
  return ['opencode.json', 'opencode.jsonc', 'config.json'].map((file) => path.join(dir, file));
};

const expandHome = (value: string): string => (value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);

/** Resolves OpenCode's `{env:NAME}` and `{file:path}` placeholders. Throws with the placeholder it could not read. */
export const resolvePlaceholders = async (value: string, configDir: string, env: NodeJS.ProcessEnv = process.env): Promise<string> => {
  let result = value;
  for (const match of value.matchAll(/\{env:([^}]+)\}/g)) {
    const resolved = env[match[1]!];
    if (resolved === undefined) throw new Error(match[0]);
    result = result.replace(match[0], resolved);
  }
  for (const match of value.matchAll(/\{file:([^}]+)\}/g)) {
    const file = path.resolve(configDir, expandHome(match[1]!));
    try {
      result = result.replace(match[0], (await readFile(file, 'utf8')).trim());
    } catch {
      throw new Error(match[0]);
    }
  }
  return result;
};

const readJson = async (file: string): Promise<Record<string, unknown> | null> => {
  try {
    return JSON.parse(stripJsonc(await readFile(file, 'utf8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The OAuth token OpenCode stored for a server that has no Authorization header. */
const oauthToken = async (name: string): Promise<string | null> => {
  const store = await readJson(path.join(os.homedir(), '.local', 'share', 'opencode', 'mcp-auth.json'));
  const tokens = (store?.[name] as { tokens?: { accessToken?: unknown } } | undefined)?.tokens;
  return typeof tokens?.accessToken === 'string' ? tokens.accessToken : null;
};

/** Picks the server named `ploi`, else the first remote server on ploi.io. */
export const pickEntry = (mcp: Record<string, McpEntry>): [string, McpEntry] | null => {
  if (mcp[MCP_NAME]) return [MCP_NAME, mcp[MCP_NAME]];
  const found = Object.entries(mcp).find(([, entry]) => {
    try { return /(^|\.)ploi\.io$/.test(new URL(entry.url ?? '').hostname); } catch { return false; }
  });
  return found ?? null;
};

/** OpenCode 1 keeps servers right under `mcp`; OpenCode 2 under `mcp.servers`. */
const mcpServers = (config: Record<string, unknown> | null): Record<string, McpEntry> | null => {
  const mcp = config?.mcp as Record<string, unknown> | undefined;
  if (!mcp || typeof mcp !== 'object') return null;
  const servers = mcp.servers;
  if (servers && typeof servers === 'object' && !('url' in servers) && !('type' in servers)) return servers as Record<string, McpEntry>;
  return mcp as Record<string, McpEntry>;
};

export const findPloiMcp = async (candidates = configCandidates()): Promise<McpLookup> => {
  for (const configPath of candidates) {
    const config = await readJson(configPath);
    const mcp = mcpServers(config);
    if (!mcp) continue;
    const picked = pickEntry(mcp);
    if (!picked) continue;
    const [name, entry] = picked;
    if (entry.enabled === false) return { ok: false, reason: 'disabled', detail: name };
    if (entry.type !== 'remote' || !entry.url) return { ok: false, reason: 'not-remote', detail: name };
    const headers: Record<string, string> = {};
    try {
      for (const [key, value] of Object.entries(entry.headers ?? {})) {
        if (typeof value === 'string') headers[key] = await resolvePlaceholders(value, path.dirname(configPath));
      }
    } catch (error) {
      return { ok: false, reason: 'unresolved', detail: (error as Error).message };
    }
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
      const token = await oauthToken(name);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return { ok: true, endpoint: { name, url: entry.url, headers } };
  }
  return { ok: false, reason: 'not-configured' };
};
