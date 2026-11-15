// A minimal MCP client over Streamable HTTP: initialize once, then tools/call.
// Only what the extension needs: JSON or SSE answers, a session id, one retry on an expired session.
import type { McpEndpoint } from './opencode-config.ts';

const PROTOCOL_VERSION = '2025-06-18';
const TIMEOUT_MS = 20_000;

export class McpError extends Error {
  constructor(readonly kind: 'auth' | 'http' | 'protocol' | 'tool' | 'network', message: string) {
    super(message);
  }
}

type JsonRpcAnswer = { id?: number; result?: unknown; error?: { message?: string } };

/** Reads a JSON-RPC answer from a JSON body or from the last `data:` event of an SSE body. */
export const parseRpcBody = (contentType: string, text: string, id: number): JsonRpcAnswer => {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text) as JsonRpcAnswer;
  const events = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/)
    .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter(Boolean);
  for (const data of events.reverse()) {
    const message = JSON.parse(data) as JsonRpcAnswer;
    if (message.id === id) return message;
  }
  throw new McpError('protocol', 'No answer in the event stream.');
};

/** Tool results are text content holding JSON; `structuredContent` wins when present. */
export const toolPayload = (result: unknown): unknown => {
  const value = result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  const text = value.content?.find((part) => part.type === 'text')?.text ?? '';
  if (value.isError) throw new McpError('tool', text || 'The tool failed.');
  if (value.structuredContent !== undefined) return value.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
};

export class McpClient {
  private sessionId: string | null = null;
  private initializing: Promise<void> | null = null;
  private nextId = 1;

  constructor(private readonly endpoint: McpEndpoint, private readonly clientVersion: string) {}

  sameEndpoint(endpoint: McpEndpoint): boolean {
    return endpoint.url === this.endpoint.url && JSON.stringify(endpoint.headers) === JSON.stringify(this.endpoint.headers);
  }

  private async post(body: object, expectAnswer: boolean): Promise<JsonRpcAnswer | null> {
    const headers: Record<string, string> = {
      ...this.endpoint.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    let response: Response;
    try {
      response = await fetch(this.endpoint.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new McpError('network', (error as Error).message);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const text = await response.text();
    if (response.status === 401 || response.status === 403) throw new McpError('auth', `HTTP ${response.status}`);
    if (response.status === 404 && this.sessionId) { this.sessionId = null; throw new McpError('protocol', 'session-expired'); }
    if (!response.ok) throw new McpError('http', `HTTP ${response.status}`);
    if (!expectAnswer) return null;
    const answer = parseRpcBody(response.headers.get('content-type') ?? '', text, (body as { id: number }).id);
    if (answer.error) throw new McpError('protocol', answer.error.message ?? 'MCP error');
    return answer;
  }

  private initialize(): Promise<void> {
    this.initializing ??= (async () => {
      await this.post({
        jsonrpc: '2.0', id: this.nextId++, method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'openchamber-ploi', version: this.clientVersion } },
      }, true);
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
    })().catch((error: unknown) => { this.initializing = null; throw error; });
    return this.initializing;
  }

  async callTool(name: string, args: Record<string, unknown> = {}, retried = false): Promise<unknown> {
    await this.initialize();
    try {
      const answer = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } }, true);
      return toolPayload(answer?.result);
    } catch (error) {
      if (!retried && error instanceof McpError && error.message === 'session-expired') {
        this.initializing = null;
        return this.callTool(name, args, true);
      }
      throw error;
    }
  }
}
