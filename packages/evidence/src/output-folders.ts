// Node built-ins only: `node --test` runs this straight from source.
import { createHash } from 'node:crypto';

/**
 * Playwright's own rules for a test's output folder, reproduced so a report whose attachment paths
 * no longer resolve (moved results, a merged report) can still be matched to the folder a run
 * wrote. They come from Playwright's `testInfo.ts`: the spec path relative to the test dir without
 * its `.spec.ts`, a dash, the title path with every run of non-alphanumeric ASCII turned into one
 * dash; the whole thing cut to 60 characters as `first 26 + '-' + sha1[0..5] + '-' + last 27`;
 * then `-<project>` and `-retry<N>`.
 */
export function sanitizeForFilePath(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, '-');
}

export function trimLongString(value: string, length = 60): string {
  if (value.length <= length) return value;
  const hash = createHash('sha1').update(value).digest('hex');
  const middle = `-${hash.substring(0, 5)}-`;
  const start = Math.floor((length - middle.length) / 2);
  const end = length - start - middle.length;
  return value.substring(0, start) + middle + value.slice(-end);
}

export interface OutputFolderInput {
  /** The spec file relative to the test dir, e.g. `deploy-token.spec.ts` or `flows/deploy.spec.ts`. */
  specFile: string;
  /** Describe titles and the test title, outermost first. */
  titlePath: readonly string[];
  projectName?: string;
  retry?: number;
}

export function playwrightOutputFolder(input: OutputFolderInput): string {
  const { specFile, titlePath, projectName, retry = 0 } = input;
  const relative = specFile.replace(/\.(spec|test)\.(js|ts|jsx|tsx|mjs|mts|cjs|cts)$/, '').replace(/[\\/]/g, '-');
  let folder = trimLongString(`${relative}-${sanitizeForFilePath(titlePath.join(' '))}`);
  if (projectName) folder += `-${sanitizeForFilePath(projectName)}`;
  if (retry) folder += `-retry${retry}`;
  return folder;
}

/**
 * The loose match used before the exact rule was reproduced: equal, or the same 26-character
 * head and 27-character tail around any 5-character hash. Kept for folders renamed by hand.
 */
export function folderMatchesLoosely(folder: string, full: string): boolean {
  if (folder === full) return true;
  const trimmed = full.length > 60;
  return trimmed && folder.length === 60 &&
    folder.startsWith(full.slice(0, 26) + '-') && folder.endsWith('-' + full.slice(-27));
}
