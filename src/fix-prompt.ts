// The first message of a "Fix findings" session: what Ploi reports for one site, and what to do about it.
// Pure, tested. Written in English for the agent, whatever the interface language.
import type { Finding } from './insights.ts';

export type FixPromptInput = {
  domain: string;
  siteId: number;
  serverName: string | null;
  serverId: number;
  items: { type: string; summary: string; findings: Finding[] }[];
};

/** The host refuses a first message over 16 000 characters; keep room for the closing instructions. */
export const FIX_PROMPT_MAX = 15_000;

const TYPE_NAMES: Record<string, string> = {
  'composer-vulnerabilities': 'Composer vulnerabilities',
  'npm-vulnerabilities': 'npm vulnerabilities',
  'failed-certificate-checks': 'SSL certificate renewal failures',
};

const typeName = (type: string): string => TYPE_NAMES[type] ?? type.replace(/[-_]+/g, ' ');

const findingLine = (finding: Finding): string => {
  const parts = [
    finding.severity ? `[${finding.severity.toUpperCase()}]` : '',
    finding.package ? `${finding.package}:` : '',
    finding.title,
    finding.cve ? `(${finding.cve})` : '',
    finding.fixAvailable ? '— fix available' : '',
    finding.url ? `— ${finding.url}` : '',
  ];
  return `- ${parts.filter(Boolean).join(' ')}`;
};

const CLOSING = [
  '## What to do',
  '- For dependency vulnerabilities: update each affected package to a patched version with the smallest change that works (`composer update <package> --with-all-dependencies`, `npm update <package>` or `npm audit fix`; avoid `--force` and major upgrades unless there is no other fix). Keep the lock files consistent.',
  '- For other findings (certificates, configuration): find the cause from the code and configuration in this repository, fix what belongs here, and say what has to be done on the server.',
  '- Run the project\'s tests and checks after the changes.',
  '- Do not deploy, push, or change anything on the Ploi server.',
  '- End with a short summary: what was fixed, what could not be and why.',
].join('\n');

export const buildFixPrompt = (input: FixPromptInput): string => {
  const server = input.serverName ? `${input.serverName} (server_id ${input.serverId})` : `server_id ${input.serverId}`;
  const head = `Fix the findings Ploi reports for ${input.domain} (Ploi site_id ${input.siteId} on ${server}). This repository is the project deployed to that site.`;
  const sections: string[] = [];
  let length = head.length + CLOSING.length + 4;
  let left = 0;
  for (const item of input.items) {
    const title = `## ${typeName(item.type)} (${item.findings.length})`;
    const lines = item.findings.length ? item.findings.map(findingLine) : [`- ${item.summary}`];
    const kept: string[] = [];
    for (const line of lines) {
      if (length + title.length + line.length + 2 > FIX_PROMPT_MAX) { left += 1; continue; }
      kept.push(line);
      length += line.length + 1;
    }
    if (kept.length) { sections.push([title, ...kept].join('\n')); length += title.length + 2; }
  }
  if (left) sections.push(`(${left} more findings are not listed here; see the site's insights in Ploi.)`);
  return [head, ...sections, CLOSING].join('\n\n');
};
