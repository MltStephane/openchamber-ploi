// Which sites the user chose to hide. Kept in a file under the home folder, outside the package,
// because a write inside the package reloads the extension. New sites are shown by default.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Preferences = { hidden: number[] };

const PREFERENCES_FILE = path.join(os.homedir(), '.config', 'openchamber-ploi', 'preferences.json');
/** Where the extension kept them when it was called Sites; read until the first save writes the new file. */
const LEGACY_FILE = path.join(os.homedir(), '.config', 'openchamber-sites', 'preferences.json');

/** Keeps positive integer ids only, once each, sorted. */
export const normaliseHidden = (value: unknown): number[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0))].sort((a, b) => a - b) : [];

/** `null` when the file does not exist; a broken file hides nothing. */
const readFrom = async (file: string): Promise<Preferences | null> => {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return null; }
  try {
    return { hidden: normaliseHidden((JSON.parse(text) as { hidden?: unknown }).hidden) };
  } catch {
    return { hidden: [] };
  }
};

export const readPreferences = async (file = PREFERENCES_FILE, legacy = LEGACY_FILE): Promise<Preferences> =>
  (await readFrom(file)) ?? (await readFrom(legacy)) ?? { hidden: [] };

export const writePreferences = async (preferences: Preferences, file = PREFERENCES_FILE): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ hidden: normaliseHidden(preferences.hidden) }, null, 2)}\n`);
  await rename(temporary, file);
};
