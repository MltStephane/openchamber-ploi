// "12 seconds ago", "in 3 hours": one wording for the panel and the Work Status section.
const STEPS: [limit: number, unit: Intl.RelativeTimeFormatUnit, seconds: number][] = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86_400, 'hour', 3600],
  [Infinity, 'day', 86_400],
];

/** `at` and `now` in milliseconds. */
export const relativeTime = (locale: string, at: number, now = Date.now()): string => {
  const seconds = Math.round((at - now) / 1000);
  const [, unit, size] = STEPS.find(([limit]) => Math.abs(seconds) < limit)!;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
};

/** Ploi dates (`2026-11-15 19:09:45`) as milliseconds, or `null` when unreadable. */
export const parsePloiDate = (date: string): number | null => {
  const at = Date.parse(date.replace(' ', 'T'));
  return Number.isNaN(at) ? null : at;
};
