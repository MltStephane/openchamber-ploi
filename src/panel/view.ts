// Styles and small DOM helpers of the side panel. Only theme variables (`--oc-*`), no hard-coded colour.
import type { Health } from '../probe.ts';

export const STYLE = `
  html, body { margin: 0; height: 100%; background: transparent; color: var(--oc-fg); font: 12px/1.4 var(--oc-font); }
  #root { height: 100%; display: flex; flex-direction: column; box-sizing: border-box; }
  .toolbar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 8px 8px 6px; }
  .toolbar .actions { margin-left: auto; display: flex; gap: 4px; }
  .toolbar [hidden] { display: none; }
  .toolbar .search { flex: 1 1 100%; order: 3; }
  .notice { flex: none; padding: 0 8px; }
  .notice:empty { display: none; }
  .notice > * + * { margin-top: 6px; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 0 4px 10px; }
  .heading { display: flex; align-items: baseline; gap: 6px; margin: 10px 6px 4px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; color: var(--oc-muted); }
  .hint { margin: 2px 6px 6px; color: var(--oc-muted); }
  .server { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 6px; padding: 6px 6px 3px;
    margin-top: 2px; min-width: 0; border-radius: 4px; }
  button.server { cursor: pointer; }
  button.server:hover { background: var(--oc-hover); }
  button.server:focus-visible { box-shadow: inset 0 0 0 2px var(--oc-focus); }
  .server.choose { padding: 8px 6px 2px; font-weight: 600; }
  .choose { padding: 2px 6px 2px 20px; }
  .choosebar { display: flex; align-items: flex-start; gap: 8px; margin: 4px 6px 6px; }
  .choosebar .hint { flex: 1; margin: 0; }
  .server .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .server .ip { color: var(--oc-muted); font-family: var(--oc-mono); font-size: 11px; white-space: nowrap; }
  .server .count { margin-left: auto; color: var(--oc-muted); white-space: nowrap; }
  .server .count.bad { color: var(--oc-error-text); }
  .pill { flex: none; border-radius: 999px; padding: 0 6px; font-size: 10.5px; line-height: 16px; font-weight: 600; white-space: nowrap; }
  .pill.warning { background: color-mix(in srgb, var(--oc-warning) 18%, transparent); color: var(--oc-warning-text); }
  .pill.error { background: color-mix(in srgb, var(--oc-error) 18%, transparent); color: var(--oc-error-text); }
  .site { display: flex; align-items: center; border-radius: 4px; }
  .site:hover { background: var(--oc-hover); }
  .site .main { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 26px;
    padding: 0 4px 0 14px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .site .main:focus-visible, .site .external:focus-visible { box-shadow: inset 0 0 0 2px var(--oc-focus); }
  .site .external { all: unset; flex: none; width: 22px; height: 22px; display: grid; place-items: center; margin-right: 2px;
    border-radius: 4px; cursor: pointer; color: var(--oc-muted); opacity: 0; }
  .site:hover .external, .site .external:focus-visible { opacity: 1; }
  .site .external:hover { color: var(--oc-fg); background: var(--oc-active, var(--oc-hover)); }
  .site.project .domain { font-weight: 600; }
  .site .domain { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .site .value { flex: none; color: var(--oc-muted); font-variant-numeric: tabular-nums; text-align: right; min-width: 7em; }
  .site .value.warning { color: var(--oc-warning-text); }
  .site .value.error { color: var(--oc-error-text); }
  .pill.sev-critical, .pill.sev-high { background: color-mix(in srgb, var(--oc-error) 18%, transparent); color: var(--oc-error-text); }
  .pill.sev-moderate { background: color-mix(in srgb, var(--oc-warning) 18%, transparent); color: var(--oc-warning-text); }
  .pill.sev-low, .pill.sev-info, .pill.sev-none { background: color-mix(in srgb, var(--oc-info) 16%, transparent); color: var(--oc-info-text); }
  .pill.sev-critical { box-shadow: inset 0 0 0 1px var(--oc-error); }
  .insight-site { border-radius: 4px; }
  .insight-site > summary { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 6px; border-radius: 4px; cursor: pointer;
    white-space: nowrap; list-style: none; }
  .insight-site > summary::-webkit-details-marker { display: none; }
  .insight-site > summary::before { content: '▸'; flex: none; width: 10px; color: var(--oc-muted); }
  .insight-site[open] > summary::before { content: '▾'; }
  .insight-site > summary:hover { background: var(--oc-hover); }
  .insight-site > summary:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--oc-focus); }
  .insight-site .domain { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .insight-site .tag { flex: none; color: var(--oc-muted); font-size: 11px; }
  .insight-body { padding: 0 0 6px 24px; }
  .insight-body > .hint { margin: 2px 0 4px; }
  .fix-row { display: flex; align-items: center; gap: 8px; margin: 4px 0 2px; }
  .fix-row .hint { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .insight-head { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; min-height: 24px; padding: 2px 6px;
    margin-top: 4px; border-radius: 4px; cursor: pointer; font-weight: 600; }
  .insight-head:hover { background: var(--oc-hover); }
  .insight-head:focus-visible, .finding:focus-visible { box-shadow: inset 0 0 0 2px var(--oc-focus); }
  .insight-head .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .insight-head .count { flex: none; color: var(--oc-muted); font-weight: 400; }
  .insight-head .go { flex: none; color: var(--oc-muted); font-weight: 400; }
  .insight-head.site-link { font-weight: 400; color: var(--oc-muted); }
  .server-insight { margin: 2px 0; }
  .server-insight .name { font-weight: 400; }
  .finding { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 1px 6px 1px 12px;
    border-radius: 4px; }
  button.finding { cursor: pointer; }
  button.finding:hover { background: var(--oc-hover); }
  .finding .text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .finding .text strong { font-weight: 600; }
  .finding .fix { flex: none; color: var(--oc-success-text); font-size: 11px; }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--oc-subtle, var(--oc-muted)); }
  .dot.up { background: var(--oc-success); }
  .dot.slow, .dot.degraded { background: var(--oc-warning); }
  .dot.down { background: var(--oc-error); }
  .dot.unknown { background: transparent; box-shadow: inset 0 0 0 1.5px var(--oc-muted); }
`;

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const dot = (health: Health): HTMLElement => element('span', `dot ${health}`);

/** A section title, with an optional muted note after it. */
export const heading = (text: string, extra?: string): HTMLElement => {
  const node = element('div', 'heading', text);
  if (extra) node.append(element('span', '', extra));
  return node;
};

/** A button element with `type="button"` and its click handler. */
export const button = (className: string, onClick: () => void, text?: string): HTMLButtonElement => {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};
