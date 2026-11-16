// The Ploi API token comes from the extension's integration card (Settings → Integrations → Ploi), a
// `secret` field OpenChamber keeps and hands only to this service through `readSettings()`.

/** Ploi's MCP server accepts a regular API token as a bearer token. */
export const PLOI_MCP_URL = 'https://ploi.io/api/mcp';

/** The `contributes.integration.settings` field holding the token. */
export const TOKEN_SETTING = 'api-token';

export type Credential = { ok: true; token: string } | { ok: false; reason: 'missing' | 'host' };

/** `host`: OpenChamber did not answer, as when the service runs on its own. */
export const readCredential = async (readSettings: () => Promise<Record<string, string>>): Promise<Credential> => {
  let settings: Record<string, string>;
  try { settings = await readSettings(); } catch { return { ok: false, reason: 'host' }; }
  const token = settings[TOKEN_SETTING]?.trim();
  return token ? { ok: true, token } : { ok: false, reason: 'missing' };
};

/** What the extension's card says until the token works ("Needs setup: …"). English: the card has no locale. */
export const CARD_MESSAGES = {
  missing: 'Add your Ploi API token in Settings → Integrations → Ploi, field “Ploi API token” (read access is enough).',
  refused: 'Ploi refused the API token. Create a new one in Ploi (read access), then paste it in Settings → Integrations → Ploi, field “Ploi API token”.',
  /** Ploi's reason, such as an IP allowlist on the token. */
  forbidden: (reason: string) => `Ploi refused access: ${reason}`.slice(0, 300),
} as const;
