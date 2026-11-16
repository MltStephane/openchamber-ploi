// src/service.ts
import http from "node:http";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late",
  "microphone-audio",
  "microphone-ended"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// src/i18n.ts
var en = {
  "control.view": "View",
  "control.view.overview": "Overview",
  "control.view.sites": "All sites",
  "control.refresh": "Refresh",
  "ploi.tokenMissing": "Add a Ploi API token in Settings → Integrations → Ploi, field “Ploi API token”, to see your servers and sites.",
  "ploi.tokenRefused": "Ploi refused the API token. Create a new one in Ploi (read access), then paste it in Settings → Integrations → Ploi, field “Ploi API token”.",
  "ploi.forbidden": "Ploi refused access: {reason} Check the token’s restrictions (allowed IPs) in Ploi.",
  "ploi.hostUnavailable": "Cannot read the Ploi token from OpenChamber. Reload the extension in Settings → Extensions.",
  "ploi.network": "Cannot reach Ploi. Check your connection, then Refresh.",
  "ploi.failed": "Ploi failed: {message}",
  loading: "Reading your servers from Ploi…",
  empty: "No sites on your Ploi account yet.",
  "project.noMatch": "No Ploi site is deployed from this project.",
  "project.noMatchRemote": "No Ploi site is deployed from {repo}.",
  "project.by.repository": "repository {repo}",
  "project.by.appUrl": "APP_URL of the project",
  "health.up": "up",
  "health.slow": "slow",
  "health.degraded": "HTTP {status}",
  "health.down": "down",
  "health.unknown": "checking…",
  "error.timeout": "timeout",
  "error.dns": "DNS error",
  "error.tls": "TLS error",
  "error.refused": "refused",
  "error.network": "unreachable",
  "value.ok": "{status} · {ms} ms",
  "server.sites": "{up}/{total} up",
  "server.reboot": "reboot",
  "server.security": { one: "{count} security update", other: "{count} security updates" },
  "server.inactive": "{status}",
  "tooltip.site": `{url}
Server {server}
Last deploy: {deploy}
Checked {checked}`,
  "tooltip.match": "Found by {by}",
  "tooltip.server": `{ip} · PHP {php}
{uptime}`,
  "tooltip.downSites": "Not answering: {sites}",
  never: "never",
  open: "Open",
  more: { one: "{count} more site not shown", other: "{count} more sites not shown" },
  "problems.none": "Every site answers.",
  "fix.button": "Fix the findings",
  "fix.tooltip": "Start a session in {project} that fixes these findings",
  "fix.noProject": "No OpenChamber project is deployed to this site.",
  "fix.notGranted": "Allow sessions for Ploi in Settings → Extensions to fix findings from here.",
  "fix.title": "Fix Ploi findings — {domain}",
  "fix.started": "Session started in {project}",
  "fix.notSent": "Session created in {project}, but the message was not sent. Choose a model, then send it again.",
  "fix.failed": "Could not start the session: {message}",
  "panel.tab.insights": "Insights",
  "insights.loading": "Reading insights from Ploi…",
  "insights.none": "No open insight on the shown sites.",
  "insights.sites": "Sites",
  "insights.server": "Server-wide",
  "insights.openPloi": "Open the insights in Ploi",
  "insights.openAdvisory": "Open the advisory",
  "insights.fix": "fix available",
  "insights.findings": { one: "{count} finding", other: "{count} findings" },
  "insight.type.composer-vulnerabilities": "Composer vulnerabilities",
  "insight.type.npm-vulnerabilities": "npm vulnerabilities",
  "insight.type.failed-certificate-checks": "SSL renewal failures",
  "severity.critical": { one: "{count} critical", other: "{count} critical" },
  "severity.high": { one: "{count} high", other: "{count} high" },
  "severity.moderate": { one: "{count} moderate", other: "{count} moderate" },
  "severity.low": { one: "{count} low", other: "{count} low" },
  "severity.info": { one: "{count} info", other: "{count} info" },
  "severity.name.critical": "critical",
  "severity.name.high": "high",
  "severity.name.moderate": "moderate",
  "severity.name.low": "low",
  "severity.name.info": "info",
  "panel.choose": "Choose sites",
  "panel.done": "Done",
  "panel.chooseHint": "Tick the sites to show. Hidden sites are not checked, even the open project’s.",
  "panel.hiddenCount": { one: "{count} hidden", other: "{count} hidden" },
  "panel.showAll": "Show all",
  "panel.saveFailed": "Could not save which sites are shown: {message}",
  "panel.openSite": "Open the site",
  "panel.openPloi": "Open in Ploi",
  "panel.allHidden": "Every site is hidden. Use “Choose sites” to show some.",
  ploi: "Ploi",
  "panel.search": "Filter",
  "panel.tab.all": "All",
  "panel.tab.problems": "Problems",
  "panel.servers": "Servers",
  "panel.noMatch": "No site matches the filter.",
  "panel.serviceFailed.title": "The local service did not answer",
  "panel.serviceFailed.body": "Check that the extension is allowed in Settings → Extensions, then retry.",
  "panel.retry": "Retry",
  "panel.deployed": "deployed {when}",
  "panel.neverDeployed": "never deployed",
  "panel.checked": "checked {when}",
  "panel.sites": { one: "{count} site", other: "{count} sites" },
  "panel.matchedBy": "Found by {by}"
};
var fr = {
  "control.view": "Vue",
  "control.view.overview": "Vue d’ensemble",
  "control.view.sites": "Tous les sites",
  "control.refresh": "Actualiser",
  "ploi.tokenMissing": "Ajoutez un jeton d’API Ploi dans Réglages → Intégrations → Ploi, champ « Ploi API token », pour voir vos serveurs et sites.",
  "ploi.tokenRefused": "Ploi refuse le jeton d’API. Créez-en un nouveau dans Ploi (lecture seule), puis collez-le dans Réglages → Intégrations → Ploi, champ « Ploi API token ».",
  "ploi.forbidden": "Ploi refuse l’accès : {reason} Vérifiez les restrictions du jeton (IP autorisées) dans Ploi.",
  "ploi.hostUnavailable": "Impossible de lire le jeton Ploi depuis OpenChamber. Rechargez l’extension dans Réglages → Extensions.",
  "ploi.network": "Ploi est injoignable. Vérifiez la connexion, puis Actualiser.",
  "ploi.failed": "Ploi a échoué : {message}",
  loading: "Lecture de vos serveurs sur Ploi…",
  empty: "Aucun site sur votre compte Ploi pour l’instant.",
  "project.noMatch": "Aucun site Ploi n’est déployé depuis ce projet.",
  "project.noMatchRemote": "Aucun site Ploi n’est déployé depuis {repo}.",
  "project.by.repository": "le dépôt {repo}",
  "project.by.appUrl": "l’APP_URL du projet",
  "health.up": "en ligne",
  "health.slow": "lent",
  "health.degraded": "HTTP {status}",
  "health.down": "hors ligne",
  "health.unknown": "vérification…",
  "error.timeout": "délai dépassé",
  "error.dns": "erreur DNS",
  "error.tls": "erreur TLS",
  "error.refused": "refusé",
  "error.network": "injoignable",
  "value.ok": "{status} · {ms} ms",
  "server.sites": "{up}/{total} en ligne",
  "server.reboot": "redémarrage",
  "server.security": { one: "{count} mise à jour de sécurité", other: "{count} mises à jour de sécurité" },
  "server.inactive": "{status}",
  "tooltip.site": `{url}
Serveur {server}
Dernier déploiement : {deploy}
Vérifié {checked}`,
  "tooltip.match": "Trouvé par {by}",
  "tooltip.server": `{ip} · PHP {php}
{uptime}`,
  "tooltip.downSites": "Ne répondent pas : {sites}",
  never: "jamais",
  open: "Ouvrir",
  more: { one: "{count} autre site non affiché", other: "{count} autres sites non affichés" },
  "problems.none": "Tous les sites répondent.",
  "fix.button": "Corriger les alertes",
  "fix.tooltip": "Lancer une session dans {project} qui corrige ces alertes",
  "fix.noProject": "Aucun projet OpenChamber n’est déployé sur ce site.",
  "fix.notGranted": "Autorisez les sessions pour Ploi dans Réglages → Extensions pour corriger les alertes d’ici.",
  "fix.title": "Corriger les alertes Ploi — {domain}",
  "fix.started": "Session lancée dans {project}",
  "fix.notSent": "Session créée dans {project}, mais le message n’est pas parti. Choisissez un modèle, puis renvoyez-le.",
  "fix.failed": "Impossible de lancer la session : {message}",
  "panel.tab.insights": "Insights",
  "insights.loading": "Lecture des insights Ploi…",
  "insights.none": "Aucun insight ouvert sur les sites affichés.",
  "insights.sites": "Sites",
  "insights.server": "Serveur entier",
  "insights.openPloi": "Ouvrir les insights dans Ploi",
  "insights.openAdvisory": "Ouvrir l’avis de sécurité",
  "insights.fix": "correctif dispo",
  "insights.findings": { one: "{count} alerte", other: "{count} alertes" },
  "insight.type.composer-vulnerabilities": "Vulnérabilités Composer",
  "insight.type.npm-vulnerabilities": "Vulnérabilités npm",
  "insight.type.failed-certificate-checks": "Échecs de renouvellement SSL",
  "severity.critical": { one: "{count} critique", other: "{count} critiques" },
  "severity.high": { one: "{count} élevée", other: "{count} élevées" },
  "severity.moderate": { one: "{count} modérée", other: "{count} modérées" },
  "severity.low": { one: "{count} faible", other: "{count} faibles" },
  "severity.info": { one: "{count} info", other: "{count} infos" },
  "severity.name.critical": "critique",
  "severity.name.high": "élevée",
  "severity.name.moderate": "modérée",
  "severity.name.low": "faible",
  "severity.name.info": "info",
  "panel.choose": "Choisir les sites",
  "panel.done": "Terminé",
  "panel.chooseHint": "Cochez les sites à afficher. Les sites masqués ne sont pas vérifiés, même celui du projet ouvert.",
  "panel.hiddenCount": { one: "{count} masqué", other: "{count} masqués" },
  "panel.showAll": "Tout afficher",
  "panel.saveFailed": "Impossible d’enregistrer les sites affichés : {message}",
  "panel.openSite": "Ouvrir le site",
  "panel.openPloi": "Ouvrir dans Ploi",
  "panel.allHidden": "Tous les sites sont masqués. Utilisez « Choisir les sites » pour en afficher.",
  ploi: "Ploi",
  "panel.search": "Filtrer",
  "panel.tab.all": "Tous",
  "panel.tab.problems": "Problèmes",
  "panel.servers": "Serveurs",
  "panel.noMatch": "Aucun site ne correspond au filtre.",
  "panel.serviceFailed.title": "Le service local ne répond pas",
  "panel.serviceFailed.body": "Vérifiez que l’extension est autorisée dans Réglages → Extensions, puis réessayez.",
  "panel.retry": "Réessayer",
  "panel.deployed": "déployé {when}",
  "panel.neverDeployed": "jamais déployé",
  "panel.checked": "vérifié {when}",
  "panel.sites": { one: "{count} site", other: "{count} sites" },
  "panel.matchedBy": "Trouvé par {by}"
};
var DICTIONARIES = { en, fr };
var resolveLocale = (tag) => {
  const base = (tag ?? "").toLowerCase().split("-")[0] ?? "";
  return base in DICTIONARIES ? base : "en";
};
var translator = (locale) => (key, params = {}) => {
  const entry = DICTIONARIES[locale][key];
  const count = Number(params.count ?? 0);
  const template = typeof entry === "string" ? entry : new Intl.PluralRules(locale).select(count) === "one" ? entry.one : entry.other;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params) ? String(params[name]) : whole);
};

// src/credentials.ts
var PLOI_MCP_URL = "https://ploi.io/api/mcp";
var TOKEN_SETTING = "api-token";
var readCredential = async (readSettings) => {
  let settings;
  try {
    settings = await readSettings();
  } catch {
    return { ok: false, reason: "host" };
  }
  const token = settings[TOKEN_SETTING]?.trim();
  return token ? { ok: true, token } : { ok: false, reason: "missing" };
};
var CARD_MESSAGES = {
  missing: "Add your Ploi API token in Settings → Integrations → Ploi, field “Ploi API token” (read access is enough).",
  refused: "Ploi refused the API token. Create a new one in Ploi (read access), then paste it in Settings → Integrations → Ploi, field “Ploi API token”.",
  forbidden: (reason) => `Ploi refused access: ${reason}`.slice(0, 300)
};

// src/mcp-client.ts
var PROTOCOL_VERSION = "2025-06-18";
var TIMEOUT_MS = 20000;

class McpError extends Error {
  kind;
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}
var parseRpcBody = (contentType, text, id) => {
  if (!contentType.includes("text/event-stream"))
    return JSON.parse(text);
  const events = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join(`
`)).filter(Boolean);
  for (const data of events.reverse()) {
    const message = JSON.parse(data);
    if (message.id === id)
      return message;
  }
  throw new McpError("protocol", "No answer in the event stream.");
};
var ploiMessage = (text) => {
  try {
    const message = JSON.parse(text).message;
    return typeof message === "string" ? message.trim().slice(0, 200) : "";
  } catch {
    return "";
  }
};
var toolPayload = (result) => {
  const value = result;
  const text = value.content?.find((part) => part.type === "text")?.text ?? "";
  if (value.isError)
    throw new McpError("tool", text || "The tool failed.");
  if (value.structuredContent !== undefined)
    return value.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

class McpClient {
  endpoint;
  clientVersion;
  sessionId = null;
  initializing = null;
  nextId = 1;
  constructor(endpoint, clientVersion) {
    this.endpoint = endpoint;
    this.clientVersion = clientVersion;
  }
  sameEndpoint(endpoint) {
    return endpoint.url === this.endpoint.url && JSON.stringify(endpoint.headers) === JSON.stringify(this.endpoint.headers);
  }
  async post(body, expectAnswer) {
    const headers = {
      ...this.endpoint.headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION
    };
    if (this.sessionId)
      headers["Mcp-Session-Id"] = this.sessionId;
    let response;
    try {
      response = await fetch(this.endpoint.url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new McpError("network", error.message);
    }
    const session = response.headers.get("mcp-session-id");
    if (session)
      this.sessionId = session;
    const text = await response.text();
    if (response.status === 401)
      throw new McpError("auth", "HTTP 401");
    if (response.status === 403)
      throw new McpError("forbidden", ploiMessage(text) || "HTTP 403");
    if (response.status === 404 && this.sessionId) {
      this.sessionId = null;
      throw new McpError("protocol", "session-expired");
    }
    if (!response.ok)
      throw new McpError("http", `HTTP ${response.status}`);
    if (!expectAnswer)
      return null;
    const answer = parseRpcBody(response.headers.get("content-type") ?? "", text, body.id);
    if (answer.error)
      throw new McpError("protocol", answer.error.message ?? "MCP error");
    return answer;
  }
  initialize() {
    this.initializing ??= (async () => {
      await this.post({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "openchamber-ploi", version: this.clientVersion } }
      }, true);
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
    })().catch((error) => {
      this.initializing = null;
      throw error;
    });
    return this.initializing;
  }
  async callTool(name, args = {}, retried = false) {
    await this.initialize();
    try {
      const answer = await this.post({ jsonrpc: "2.0", id: this.nextId++, method: "tools/call", params: { name, arguments: args } }, true);
      return toolPayload(answer?.result);
    } catch (error) {
      if (!retried && error instanceof McpError && error.message === "session-expired") {
        this.initializing = null;
        return this.callTool(name, args, true);
      }
      throw error;
    }
  }
}

// src/insights.ts
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rarr: "→",
  larr: "←",
  centerdot: "·",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–"
};
var decodeEntities = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
  if (name[0] === "#") {
    const code = name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isFinite(code) && code > 0 && code < 1114112 ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[name.toLowerCase()] ?? whole;
});
var textOf = (html) => decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
var plainSummary = (markdown) => markdown.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
var SEVERITIES = { critical: "critical", high: "high", moderate: "moderate", medium: "moderate", low: "low", info: "info" };
var parseFinding = (html) => {
  const severityMatch = /<span[^>]*>\s*(CRITICAL|HIGH|MODERATE|MEDIUM|LOW|INFO)\s*<\/span>/i.exec(html);
  const severity = severityMatch ? SEVERITIES[severityMatch[1].toLowerCase()] ?? null : null;
  const packageMatch = /<strong>([\s\S]*?)<\/strong>\s*:/.exec(html);
  const pkg = packageMatch ? textOf(packageMatch[1]) : null;
  const url = /<a\s[^>]*href="(https:\/\/[^"]+)"/i.exec(html)?.[1] ?? null;
  const cve = /\b(CVE-\d{4}-\d{4,})\b/.exec(html)?.[1] ?? null;
  const fixAvailable = /fix available/i.test(html);
  let body = html;
  if (severityMatch)
    body = body.replace(severityMatch[0], " ");
  if (packageMatch)
    body = body.replace(packageMatch[0], " ");
  body = body.replace(/<a\s[^>]*>\s*More info[\s\S]*?<\/a>/gi, " ").replace(/<span[^>]*>\s*\((?:fix available|CVE-[^)]*)\)\s*<\/span>/gi, " ");
  const title = decodeEntities(textOf(body)).replace(/^[·:\s]+/, "");
  if (!title && !pkg)
    return null;
  return { severity, package: pkg, title: decodeEntities(title || pkg || ""), cve, fixAvailable, url: url ? decodeEntities(url) : null };
};
var SITE_LINK = /<a\s[^>]*href="\/panel\/servers\/(\d+)\/sites\/(\d+)"[^>]*>[\s\S]*?<\/a>/gi;
var parseInsightSites = (html) => {
  const links = [...html.matchAll(SITE_LINK)];
  const bySite = new Map;
  links.forEach((link, index) => {
    const siteId = Number(link[2]);
    const start = link.index + link[0].length;
    const next = links[index + 1]?.index ?? html.length;
    const heading = html.slice(start).search(/<h[23][\s>]/i);
    let segment = html.slice(start, Math.min(next, heading === -1 ? html.length : start + heading));
    const items = [...segment.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
    const findings = [];
    if (items.length) {
      for (const item of items) {
        const finding = parseFinding(item);
        if (finding)
          findings.push(finding);
      }
    } else {
      const end = segment.search(/<\/li>/i);
      if (end !== -1)
        segment = segment.slice(0, end);
      const finding = parseFinding(segment);
      if (finding)
        findings.push(finding);
    }
    bySite.set(siteId, [...bySite.get(siteId) ?? [], ...findings]);
  });
  return [...bySite].map(([siteId, findings]) => ({ siteId, findings }));
};
var list = (payload) => {
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data.filter((item) => !!item && typeof item === "object") : [];
};
var parseInsightList = (payload, serverId) => list(payload).filter((raw) => (raw.status ?? "open") === "open").map((raw) => ({
  id: Number(raw.id),
  serverId: Number(raw.server_id ?? serverId),
  type: typeof raw.type === "string" ? raw.type : "insight",
  priority: typeof raw.priority === "string" ? raw.priority : "low",
  summary: plainSummary(typeof raw.description === "string" ? raw.description : ""),
  createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
  sites: []
})).filter((insight) => Number.isInteger(insight.id) && insight.id > 0);
var explanationOf = (payload) => {
  const data = payload?.data ?? payload;
  return typeof data?.html === "string" ? data.html : "";
};

// src/preferences.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var PREFERENCES_FILE = path.join(os.homedir(), ".config", "openchamber-ploi", "preferences.json");
var LEGACY_FILE = path.join(os.homedir(), ".config", "openchamber-sites", "preferences.json");
var normaliseHidden = (value) => Array.isArray(value) ? [...new Set(value.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b) : [];
var readFrom = async (file) => {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    return { hidden: normaliseHidden(JSON.parse(text).hidden) };
  } catch {
    return { hidden: [] };
  }
};
var readPreferences = async (file = PREFERENCES_FILE, legacy = LEGACY_FILE) => await readFrom(file) ?? await readFrom(legacy) ?? { hidden: [] };
var writePreferences = async (preferences, file = PREFERENCES_FILE) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ hidden: normaliseHidden(preferences.hidden) }, null, 2)}
`);
  await rename(temporary, file);
};

// src/ploi.ts
var list2 = (payload) => {
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data.filter((item) => !!item && typeof item === "object") : [];
};
var str = (value) => typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
var num = (value) => typeof value === "number" ? value : Number(value) || 0;
var parseServers = (payload) => list2(payload).map((raw) => {
  const updates = raw.updates ?? {};
  return {
    id: num(raw.id),
    name: str(raw.name) ?? `#${num(raw.id)}`,
    status: str(raw.status) ?? "unknown",
    ip: str(raw.ip_address),
    rebootRequired: raw.reboot_required === true,
    securityUpdates: num(updates.security),
    uptime: str(raw.uptime_human),
    php: str(raw.php_version)
  };
});
var parseSites = (payload) => list2(payload).map((raw) => ({
  id: num(raw.id),
  serverId: num(raw.server_id),
  domain: str(raw.domain) ?? "",
  healthUrl: str(raw.health_url),
  lastDeployAt: str(raw.last_deploy_at)
})).filter((site) => site.domain);
var parseRepository = (payload) => {
  const data = payload?.data ?? payload;
  const repo = data?.repository;
  const owner = str(repo?.user);
  const name = str(repo?.name);
  if (!repo || !owner || !name)
    return null;
  return { provider: str(repo.provider) ?? "github", owner, name, branch: str(repo.branch) };
};
var PANEL = "https://ploi.io/panel/servers";
var ploiServerUrl = (serverId) => `${PANEL}/${serverId}`;
var ploiInsightsUrl = (serverId) => `${PANEL}/${serverId}/insights`;
var ploiSiteUrl = (site) => `${PANEL}/${site.serverId}/sites/${site.id}`;
var siteUrl = (site) => {
  if (site.healthUrl && /^https?:\/\//.test(site.healthUrl))
    return site.healthUrl;
  return `https://${site.domain}/`;
};

// src/probe.ts
var TIMEOUT_MS2 = 1e4;
var SLOW_MS = 2000;
var classifyError = (error) => {
  const err = error;
  if (err.name === "TimeoutError" || err.name === "AbortError")
    return "timeout";
  const code = err.cause?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "dns";
  if (code === "ECONNREFUSED" || code === "ECONNRESET")
    return "refused";
  if (/CERT|SSL|TLS/i.test(code))
    return "tls";
  return "network";
};
var probe = async (url, fetcher = fetch) => {
  const start = performance.now();
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "openchamber-ploi (uptime check)", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS2)
    });
    const ms = Math.round(performance.now() - start);
    await response.body?.cancel().catch(() => {
      return;
    });
    return { at: Date.now(), status: response.status, ms, error: null };
  } catch (error) {
    return { at: Date.now(), status: null, ms: null, error: classifyError(error) };
  }
};
var healthOf = (check) => {
  if (!check)
    return "unknown";
  if (check.status === null || check.status >= 500)
    return "down";
  if (check.status >= 400 && check.status !== 401 && check.status !== 403)
    return "degraded";
  if ((check.ms ?? 0) > SLOW_MS)
    return "slow";
  return "up";
};

// src/project.ts
import { execFile } from "node:child_process";
import { readFile as readFile2 } from "node:fs/promises";
import path2 from "node:path";
var PROVIDER_HOSTS = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };
var parseRemote = (url) => {
  const trimmed = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  let host;
  let repoPath;
  if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      repoPath = parsed.pathname;
    } catch {
      return null;
    }
  }
  const parts = repoPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
  if (parts.length < 2)
    return null;
  return { host: host.toLowerCase(), owner: parts.slice(0, -1).join("/").toLowerCase(), name: parts.at(-1).toLowerCase() };
};
var appUrlHost = (dotenv) => {
  const line = /^\s*APP_URL\s*=\s*["']?([^"'\s#]+)/m.exec(dotenv);
  if (!line)
    return null;
  try {
    return new URL(line[1]).hostname.toLowerCase();
  } catch {
    return null;
  }
};
var gitRemote = (directory) => new Promise((resolve) => {
  execFile("git", ["-C", directory, "remote", "get-url", "origin"], { timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
});
var readIdentity = async (directory) => {
  const remoteUrl = await gitRemote(directory);
  const hosts = new Set;
  for (const file of [".env", ".env.production"]) {
    try {
      const host = appUrlHost(await readFile2(path2.join(directory, file), "utf8"));
      if (host && host !== "localhost" && !host.endsWith(".test") && !host.endsWith(".local"))
        hosts.add(host);
    } catch {}
  }
  return { remote: remoteUrl ? parseRemote(remoteUrl) : null, appHosts: [...hosts] };
};
var sameRepository = (remote, repo) => {
  const providerHost = PROVIDER_HOSTS[repo.provider.toLowerCase()];
  if (providerHost && providerHost !== remote.host)
    return false;
  return remote.owner === repo.owner.toLowerCase() && remote.name === repo.name.toLowerCase();
};
var stripWww = (host) => host.replace(/^www\./, "");
var projectsBySite = (projects, sites) => {
  const result = new Map;
  for (const { id, identity } of projects) {
    for (const { site, by } of matchSites(identity, sites)) {
      const current = result.get(site.id);
      if (!current || current.by === "app-url" && by === "repository")
        result.set(site.id, { projectId: id, by });
    }
  }
  return result;
};
var matchSites = (identity, sites) => {
  const { remote } = identity;
  if (remote) {
    const byRepo = sites.filter((site) => site.repository && sameRepository(remote, site.repository));
    if (byRepo.length)
      return byRepo.map((site) => ({ site, by: "repository" }));
  }
  const hosts = identity.appHosts.map(stripWww);
  return sites.filter((site) => hosts.includes(stripWww(site.domain.toLowerCase()))).map((site) => ({ site, by: "app-url" }));
};

// src/sites-payload.ts
var repositoryName = (site) => {
  const repo = site.repository;
  return repo ? `${repo.owner}/${repo.name}${repo.branch ? `@${repo.branch}` : ""}` : null;
};
var buildSitesPayload = (input) => ({
  problem: input.problem,
  loaded: !!input.sites,
  servers: (input.servers ?? []).map(({ id, name, status, ip, php, uptime, rebootRequired, securityUpdates }) => ({ id, name, status, ip, php, uptime, rebootRequired, securityUpdates, ploiUrl: ploiServerUrl(id) })),
  sites: (input.sites ?? []).map((site) => {
    const check = input.checks.get(site.id);
    return {
      id: site.id,
      serverId: site.serverId,
      domain: site.domain,
      url: siteUrl(site),
      ploiUrl: ploiSiteUrl(site),
      health: healthOf(check),
      status: check?.status ?? null,
      ms: check?.ms ?? null,
      error: check?.error ?? null,
      checkedAt: check?.at ?? null,
      history: input.history.get(site.id) ?? [],
      lastDeployAt: site.lastDeployAt,
      repository: repositoryName(site)
    };
  }),
  hidden: input.hidden,
  insights: input.insights && input.insights.map((insight) => ({ ...insight, ploiUrl: ploiInsightsUrl(insight.serverId) })),
  project: input.project && {
    repository: input.project.identity.remote ? `${input.project.identity.remote.owner}/${input.project.identity.remote.name}` : null,
    matches: input.project.matches.map(({ site, by }) => ({ siteId: site.id, by }))
  }
});

// src/relative-time.ts
var STEPS = [
  [60, "second", 1],
  [3600, "minute", 60],
  [86400, "hour", 3600],
  [Infinity, "day", 86400]
];
var relativeTime = (locale, at, now = Date.now()) => {
  const seconds = Math.round((at - now) / 1000);
  const [, unit, size] = STEPS.find(([limit]) => Math.abs(seconds) < limit);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / size), unit);
};

// src/status-view.ts
var VIEWS = ["overview", "sites"];
var ROWS_MAX = 16;
var MATCHES_MAX = 3;
var TEXT_MAX = 200;
var DOT = { up: "success", slow: "warning", degraded: "warning", down: "error", unknown: "muted" };
var cut = (text, max = TEXT_MAX) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
var checkValue = (t, check) => {
  const health = healthOf(check);
  if (!check)
    return { value: t("health.unknown"), tone: "muted" };
  if (check.status === null)
    return { value: t(`error.${check.error ?? "network"}`), tone: "error" };
  const value = t("value.ok", { status: check.status, ms: check.ms ?? 0 });
  return { value, tone: health === "up" ? "muted" : DOT[health] };
};
var siteTooltip = (input, site, extra) => {
  const { t, locale, now, servers, checks } = input;
  const server = servers?.find((item) => item.id === site.serverId);
  const check = checks.get(site.id);
  const text = t("tooltip.site", {
    url: siteUrl(site),
    server: server?.name ?? `#${site.serverId}`,
    deploy: site.lastDeployAt ?? t("never"),
    checked: check ? relativeTime(locale, check.at, now) : "—"
  });
  return cut(extra ? `${text}
${extra}` : text);
};
var siteLine = (input, site, id, options = {}) => {
  const check = input.checks.get(site.id);
  const { value, tone } = checkValue(input.t, check);
  const history = input.history.get(site.id) ?? [];
  const server = input.servers?.find((item) => item.id === site.serverId);
  const row = {
    kind: "line",
    id,
    label: cut(site.domain, 80),
    dot: DOT[healthOf(check)],
    value,
    valueTone: tone,
    tooltip: siteTooltip(input, site, options.extra)
  };
  if (options.chart && history.length >= 2) {
    row.content = { kind: "chart", values: history, unit: "count", tone: "accent", step: 15 };
  } else {
    row.content = { kind: "chips", chips: [
      { id: `ploi-${site.id}`, label: input.t("ploi"), url: ploiSiteUrl(site) },
      { id: `open-${site.id}`, label: input.t("open"), url: siteUrl(site) }
    ] };
  }
  if (options.chart && server)
    row.badge = { label: cut(server.name, 40) };
  return row;
};
var serverLine = (input, server) => {
  const { t } = input;
  const own = (input.sites ?? []).filter((site) => site.serverId === server.id && !input.hidden.has(site.id));
  const checked = own.filter((site) => input.checks.has(site.id));
  const failing = own.filter((site) => ["down", "degraded"].includes(healthOf(input.checks.get(site.id))));
  const up = checked.length - failing.length;
  const active = server.status === "active";
  let dot = "muted";
  if (!active)
    dot = "error";
  else if (failing.length)
    dot = "error";
  else if (checked.length === own.length)
    dot = "success";
  const tooltip = [
    t("tooltip.server", { ip: server.ip ?? "—", php: server.php ?? "—", uptime: server.uptime ?? "" }).trim(),
    failing.length ? t("tooltip.downSites", { sites: failing.map((site) => site.domain).join(", ") }) : ""
  ].filter(Boolean).join(`
`);
  const row = {
    kind: "line",
    id: `server-${server.id}`,
    label: cut(server.name, 80),
    icon: "server",
    dot,
    value: active ? t("server.sites", { up, total: own.length }) : t("server.inactive", { status: server.status }),
    valueTone: failing.length || !active ? "error" : "muted",
    tooltip: cut(tooltip),
    content: { kind: "chips", chips: [{ id: `ploi-server-${server.id}`, label: t("ploi"), url: ploiServerUrl(server.id) }] }
  };
  if (server.securityUpdates > 0)
    row.badge = { label: t("server.security", { count: server.securityUpdates }), tone: "error" };
  else if (server.rebootRequired)
    row.badge = { label: t("server.reboot"), tone: "warning" };
  return row;
};
var projectRows = (input) => {
  const { project, t } = input;
  if (!project)
    return [];
  if (!project.matches.length) {
    const { remote } = project.identity;
    const text = remote ? t("project.noMatchRemote", { repo: `${remote.owner}/${remote.name}` }) : t("project.noMatch");
    return [{ kind: "note", id: "project-none", text, tone: "muted" }];
  }
  return project.matches.filter(({ site }) => !input.hidden.has(site.id)).slice(0, MATCHES_MAX).map(({ site, by }) => {
    const repo = site.repository ? `${site.repository.owner}/${site.repository.name}${site.repository.branch ? `@${site.repository.branch}` : ""}` : "";
    const how = by === "repository" ? t("project.by.repository", { repo }) : t("project.by.appUrl");
    return siteLine(input, site, `project-${site.id}`, { chart: true, extra: t("tooltip.match", { by: how }) });
  });
};
var controls = (t, view) => [
  {
    kind: "select",
    id: "view",
    label: t("control.view"),
    value: view,
    options: VIEWS.map((value) => ({ value, label: t(value === "overview" ? "control.view.overview" : "control.view.sites") }))
  },
  { kind: "button", id: "refresh", label: t("control.refresh") }
];
var fill = (t, head, rows) => {
  const room = ROWS_MAX - head.length;
  if (rows.length <= room)
    return [...head, ...rows];
  const shown = rows.slice(0, room - 1);
  return [...head, ...shown, { kind: "note", id: "more", text: t("more", { count: rows.length - shown.length }), tone: "muted" }];
};
var buildView = (input) => {
  const { t, problem, servers, sites, view } = input;
  const header = controls(t, view);
  const problemRows = problem ? [{ kind: "note", id: "problem", text: cut(t(problem.key, problem.params), 300), tone: "error" }] : [];
  if (!servers || !sites) {
    return { rows: problemRows.length ? problemRows : [{ kind: "note", id: "loading", text: t("loading"), tone: "muted" }], controls: header };
  }
  if (!sites.length)
    return { rows: [...problemRows, { kind: "note", id: "empty", text: t("empty"), tone: "muted" }], controls: header };
  const head = [...problemRows, ...projectRows(input)];
  const projectSiteIds = new Set(input.project?.matches.map(({ site }) => site.id) ?? []);
  const others = [...sites].filter((site) => !projectSiteIds.has(site.id) && !input.hidden.has(site.id)).sort((a, b) => a.serverId - b.serverId || a.domain.localeCompare(b.domain));
  if (view === "sites")
    return { rows: fill(t, head, others.map((site) => siteLine(input, site, `site-${site.id}`))), controls: header };
  const shownServers = servers.filter((server) => {
    const own = sites.filter((site) => site.serverId === server.id);
    return !own.length || own.some((site) => !input.hidden.has(site.id));
  });
  const serverRows = shownServers.map((server) => serverLine(input, server));
  const failing = others.filter((site) => ["down", "degraded", "slow"].includes(healthOf(input.checks.get(site.id))));
  const allChecked = others.every((site) => input.checks.has(site.id));
  const tail = failing.length ? failing.map((site) => siteLine(input, site, `site-${site.id}`)) : allChecked ? [{ kind: "note", id: "all-up", text: t("problems.none"), tone: "muted" }] : [];
  return { rows: fill(t, [...head, ...serverRows], tail), controls: header };
};

// src/service.ts
var VERSION = "3.0.4";
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!port || !token) {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var CREDENTIAL_TTL = 30000;
var INVENTORY_TTL = 5 * 60000;
var REPOSITORY_TTL = 30 * 60000;
var CHECK_TTL = 60000;
var IDENTITY_TTL = 60000;
var INSIGHTS_TTL = 15 * 60000;
var INSIGHTS_CONCURRENCY = 4;
var PROJECTS_MAX = 200;
var HISTORY_MAX = 40;
var CHECK_CONCURRENCY = 6;
var REPOSITORY_CONCURRENCY = 4;
var host = (() => {
  try {
    return createServiceHost({ env: process.env });
  } catch {
    return null;
  }
})();
var state = {
  view: "overview",
  credential: null,
  cardMessage: undefined,
  client: null,
  servers: null,
  sites: null,
  inventoryAt: 0,
  inventoryError: null,
  inventoryLoad: null,
  repositories: new Map,
  repositoriesAt: 0,
  checks: new Map,
  history: new Map,
  checking: new Map,
  identities: new Map,
  instructions: new Map,
  hidden: new Set,
  insights: null,
  insightsAt: 0,
  insightsLoad: null
};
var preferencesReady = readPreferences().then(({ hidden }) => {
  state.hidden = new Set(hidden);
});
var within = (promise, ms) => Promise.race([promise, new Promise((resolve) => {
  setTimeout(resolve, ms);
})]);
var notifyPanels = () => {
  host?.emit("sites-updated").catch(() => {
    return;
  });
};
var awaitOrNotify = async (task, ms) => {
  if (await within(task.then(() => true), ms) === undefined)
    task.then(notifyPanels);
};
var shownSites = () => (state.sites ?? []).filter((site) => !state.hidden.has(site.id));
var pool = async (items, size, work) => {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift();item !== undefined; item = queue.shift())
      await work(item);
  }));
};
var setCardMessage = (message) => {
  if (!host || state.cardMessage === message)
    return;
  state.cardMessage = message;
  host.needsConfiguration(message).catch(() => {
    state.cardMessage = undefined;
  });
};
var errorProblem = (error) => {
  if (error instanceof McpError && error.kind === "auth") {
    setCardMessage(CARD_MESSAGES.refused);
    return { key: "ploi.tokenRefused" };
  }
  if (error instanceof McpError && error.kind === "forbidden") {
    setCardMessage(CARD_MESSAGES.forbidden(error.message));
    return { key: "ploi.forbidden", params: { reason: error.message } };
  }
  if (error instanceof McpError && error.kind === "network")
    return { key: "ploi.network" };
  return { key: "ploi.failed", params: { message: error.message.slice(0, 160) } };
};
var currentClient = async () => {
  if (!state.credential || Date.now() - state.credential.at > CREDENTIAL_TTL) {
    state.credential = { value: await readCredential(() => host ? host.readSettings() : Promise.reject(new Error("no host"))), at: Date.now() };
  }
  const credential = state.credential.value;
  if (!credential.ok) {
    if (credential.reason === "host")
      return { key: "ploi.hostUnavailable" };
    setCardMessage(CARD_MESSAGES.missing);
    return { key: "ploi.tokenMissing" };
  }
  const endpoint = { url: PLOI_MCP_URL, headers: { Authorization: `Bearer ${credential.token}` } };
  if (!state.client?.sameEndpoint(endpoint))
    state.client = new McpClient(endpoint, VERSION);
  return state.client;
};
var loadRepositories = async (client, sites, force) => {
  const stale = force || Date.now() - state.repositoriesAt > REPOSITORY_TTL;
  const missing = sites.filter((site) => stale || !state.repositories.has(site.id));
  await pool(missing, REPOSITORY_CONCURRENCY, async (site) => {
    try {
      state.repositories.set(site.id, parseRepository(await client.callTool("get-site-repository", { server_id: site.serverId, site_id: site.id })));
    } catch {
      if (!state.repositories.has(site.id))
        state.repositories.set(site.id, null);
    }
  });
  if (stale)
    state.repositoriesAt = Date.now();
  for (const site of sites)
    site.repository = state.repositories.get(site.id) ?? null;
};
var loadInventory = (force = false) => {
  if (state.inventoryLoad)
    return state.inventoryLoad;
  if (!force && state.sites && Date.now() - state.inventoryAt < INVENTORY_TTL)
    return Promise.resolve();
  state.inventoryLoad = (async () => {
    const client = await currentClient();
    if (!(client instanceof McpClient)) {
      state.inventoryError = client;
      return;
    }
    try {
      const [servers, sites] = await Promise.all([client.callTool("list-servers"), client.callTool("list-sites")]);
      const parsedSites = parseSites(sites);
      await loadRepositories(client, parsedSites, force);
      state.servers = parseServers(servers);
      state.sites = parsedSites;
      state.inventoryAt = Date.now();
      state.inventoryError = null;
      setCardMessage(null);
      const known = new Set(parsedSites.map((site) => site.id));
      for (const id of [...state.checks.keys()])
        if (!known.has(id)) {
          state.checks.delete(id);
          state.history.delete(id);
        }
    } catch (error) {
      state.inventoryError = errorProblem(error);
    }
  })().finally(() => {
    state.inventoryLoad = null;
  });
  return state.inventoryLoad;
};
var loadInsights = (force = false) => {
  if (state.insightsLoad)
    return state.insightsLoad;
  if (!state.servers)
    return Promise.resolve();
  if (!force && state.insights && Date.now() - state.insightsAt < INSIGHTS_TTL)
    return Promise.resolve();
  const servers = state.servers;
  state.insightsLoad = (async () => {
    const client = await currentClient();
    if (!(client instanceof McpClient))
      return;
    const found = [];
    let failed = false;
    await pool(servers, INSIGHTS_CONCURRENCY, async (server) => {
      try {
        found.push(...parseInsightList(await client.callTool("list-server-insights", { server_id: server.id }), server.id));
      } catch {
        failed = true;
      }
    });
    await pool(found, INSIGHTS_CONCURRENCY, async (insight) => {
      try {
        insight.sites = parseInsightSites(explanationOf(await client.callTool("get-server-insight", { server_id: insight.serverId, insight_id: insight.id })));
      } catch {}
    });
    if (failed && state.insights)
      return;
    state.insights = found.sort((a, b) => a.serverId - b.serverId || a.id - b.id);
    state.insightsAt = Date.now();
  })().catch(() => {
    return;
  }).finally(() => {
    state.insightsLoad = null;
  });
  return state.insightsLoad;
};
var checkSite = (site) => {
  const running = state.checking.get(site.id);
  if (running)
    return running;
  const task = probe(siteUrl(site)).then((result) => {
    state.checks.set(site.id, result);
    if (result.ms !== null)
      state.history.set(site.id, [...state.history.get(site.id) ?? [], result.ms].slice(-HISTORY_MAX));
  }).finally(() => {
    state.checking.delete(site.id);
  });
  state.checking.set(site.id, task);
  return task;
};
var checkSites = (sites, force = false) => {
  const due = sites.filter((site) => force || Date.now() - (state.checks.get(site.id)?.at ?? 0) > CHECK_TTL);
  return pool(due, CHECK_CONCURRENCY, checkSite);
};
var identityOf = async (directory) => {
  const cached = state.identities.get(directory);
  if (cached && Date.now() - cached.at < IDENTITY_TTL)
    return cached.value;
  const value = await readIdentity(directory);
  state.identities.set(directory, { value, at: Date.now() });
  return value;
};
var instructionsFor = (matches) => {
  if (!matches.length)
    return "";
  const lines = matches.map(({ site }) => {
    const server = state.servers?.find((item) => item.id === site.serverId);
    const branch = site.repository?.branch ? `, branch ${site.repository.branch}` : "";
    return `- ${site.domain}: site_id ${site.id} on server ${server?.name ?? "?"} (server_id ${site.serverId}${server?.ip ? `, ${server.ip}` : ""})${branch}`;
  });
  return ["This project is hosted on Ploi:", ...lines].join(`
`);
};
var publishInstructions = (directory, matches) => {
  if (!host)
    return;
  const text = instructionsFor(matches);
  if ((state.instructions.get(directory) ?? "") === text)
    return;
  state.instructions.set(directory, text);
  host.setInstructions(directory, text).catch(() => {
    state.instructions.delete(directory);
  });
};
var snapshot = async (directory) => {
  await preferencesReady;
  await within(loadInventory(), state.sites ? 0 : 15000);
  const sites = state.sites ?? [];
  let project = null;
  if (directory && state.sites) {
    const identity = await identityOf(directory);
    const matches = matchSites(identity, sites);
    project = { identity, matches };
    publishInstructions(directory, matches);
  }
  await awaitOrNotify(checkSites(shownSites()), 4000);
  await awaitOrNotify(loadInsights(), 0);
  return project;
};
var readStatus = async (query) => {
  const locale = resolveLocale(query.get("locale"));
  const project = await snapshot(query.get("directory"));
  return buildView({
    t: translator(locale),
    locale,
    now: Date.now(),
    view: state.view,
    problem: state.inventoryError,
    servers: state.servers,
    sites: state.sites,
    checks: state.checks,
    history: state.history,
    hidden: state.hidden,
    project
  });
};
var readSites = async (query) => {
  const project = await snapshot(query.get("directory"));
  return buildSitesPayload({
    problem: state.inventoryError,
    servers: state.servers,
    sites: state.sites,
    checks: state.checks,
    history: state.history,
    hidden: [...state.hidden],
    insights: state.insights,
    project
  });
};
var refresh = async () => {
  state.credential = null;
  state.identities.clear();
  await within(loadInventory(true), 20000);
  if (!state.sites && state.inventoryError) {
    return { status: 502, body: { message: translator("en")(state.inventoryError.key, state.inventoryError.params) } };
  }
  await within(Promise.all([
    checkSites(shownSites(), true),
    loadInsights(true)
  ]), 20000);
  return { status: 200, body: { ok: true } };
};
var matchProjects = async (body) => {
  let projects;
  try {
    const raw = JSON.parse(body || "{}").projects;
    projects = (Array.isArray(raw) ? raw : []).filter((item) => !!item && typeof item.id === "string" && typeof item.directory === "string" && item.directory.startsWith("/")).slice(0, PROJECTS_MAX);
  } catch {
    return { status: 400, body: { message: "Bad request" } };
  }
  await within(loadInventory(), state.sites ? 0 : 15000);
  if (!state.sites)
    return { status: 200, body: { ready: false, matches: {} } };
  const identities = [];
  await pool(projects, 6, async ({ id, directory }) => {
    identities.push({ id, identity: await identityOf(directory) });
  });
  identities.sort((a, b) => projects.findIndex((item) => item.id === a.id) - projects.findIndex((item) => item.id === b.id));
  const matches = Object.fromEntries([...projectsBySite(identities, state.sites)].map(([siteId, match]) => [String(siteId), match]));
  return { status: 200, body: { ready: true, matches } };
};
var saveHidden = async (body) => {
  let hidden;
  try {
    hidden = normaliseHidden(JSON.parse(body || "{}").hidden);
  } catch {
    return { status: 400, body: { message: "Bad request" } };
  }
  await preferencesReady;
  try {
    await writePreferences({ hidden });
  } catch (error) {
    return { status: 500, body: { message: error.message.slice(0, 200) } };
  }
  state.hidden = new Set(hidden);
  checkSites(shownSites()).then(notifyPanels);
  return { status: 200, body: { ok: true, hidden } };
};
var act = async (body) => {
  let event;
  try {
    event = JSON.parse(body || "{}");
  } catch {
    return { status: 400, body: { message: "Bad request" } };
  }
  if (event.id === "view" && VIEWS.includes(event.value)) {
    state.view = event.value;
    return { status: 200, body: { ok: true } };
  }
  if (event.id === "refresh")
    return refresh();
  return { status: 404, body: { message: "Unknown control" } };
};
var send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
};
http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") {
    send(res, 200, {});
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const route = `${req.method} ${url.pathname}`;
    let work;
    if (route === "GET /status")
      work = readStatus(url.searchParams).then((view) => ({ status: 200, body: view }));
    else if (route === "POST /status")
      work = act(body);
    else if (route === "GET /sites")
      work = readSites(url.searchParams).then((payload) => ({ status: 200, body: payload }));
    else if (route === "POST /refresh")
      work = refresh();
    else if (route === "POST /hidden")
      work = saveHidden(body);
    else if (route === "POST /projects")
      work = matchProjects(body);
    else {
      send(res, 404, {});
      return;
    }
    work.then(({ status, body: answer }) => send(res, status, answer), (error) => {
      const message = String(error.message ?? error).slice(0, 300);
      if (url.pathname === "/status")
        send(res, 200, { rows: [{ kind: "note", id: "crash", text: message, tone: "error" }] });
      else
        send(res, 500, { message });
    });
  });
}).listen(port, "127.0.0.1");
