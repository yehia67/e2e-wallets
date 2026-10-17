import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { concatVideos } from './full-flow.js';
import { renderSite, type FullFlow } from './html.js';
import { collectEvidence, totalsOf, type EvidenceModel, type EvidenceTotals, type MediaSink, type PlaywrightAttachment, type PlaywrightReport } from './model.js';
import { folderMatchesLoosely, playwrightOutputFolder, sanitizeForFilePath } from './output-folders.js';
import { headersFile, netlifyToml } from './site-files.js';

export * from './model.js';
export * from './output-folders.js';
export { renderSite, type FullFlow, type RenderOptions } from './html.js';
export { headersFile, netlifyToml } from './site-files.js';
export { concatVideos } from './full-flow.js';
export { parseCliArgs, USAGE, type CliArgs } from './cli-args.js';

export interface BuildEvidenceSiteOptions {
  /** Playwright JSON report(s), in order; a later one's result for a test replaces the earlier one. */
  reports: readonly string[];
  /** Where the site goes; `media/` inside it is replaced. */
  out: string;
  /** Playwright output folder(s) searched for a test's video when its attachment path is gone. */
  testResults?: readonly string[];
  title?: string;
  subtitle?: string;
  explorerTxUrl?: string;
  /** Spec file (as the report names it, e.g. `use-case-one.spec.ts`) whose videos are joined into one. */
  fullFlow?: string;
  fullFlowTitle?: string;
  fullFlowDescription?: string;
  /** Also write `netlify.toml` and `_headers`. */
  netlify?: boolean;
  ffmpegPath?: string;
}

export interface EvidenceSummary extends EvidenceTotals {
  out: string;
  media: number;
  fullFlow?: { href: string; clips: number };
}

const VIDEO_FILE = /^(app-)?video.*\.(mp4|webm)$/;

/** A test folder a run wrote: its name and where its attachments are. */
interface ResultFolder {
  name: string;
  dir: string;
}

/**
 * Every test folder under the given roots. A root is either Playwright's output dir (test folders
 * directly inside) or a folder of per-run output dirs, as a merged report's blob layout leaves it.
 */
function resultFolders(roots: readonly string[]): ResultFolder[] {
  const folders: ResultFolder[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      if (existsSync(join(dir, 'attachments')) || readdirSync(dir).some((file) => VIDEO_FILE.test(file))) {
        folders.push({ name: entry.name, dir });
        continue;
      }
      for (const nested of readdirSync(dir, { withFileTypes: true })) {
        if (nested.isDirectory()) folders.push({ name: nested.name, dir: join(dir, nested.name) });
      }
    }
  }
  return folders;
}

function videoIn(folder: ResultFolder): string | undefined {
  for (const dir of [join(folder.dir, 'attachments'), folder.dir]) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((name) => VIDEO_FILE.test(name));
    if (file) return join(dir, file);
  }
  return undefined;
}

function createSink(mediaDir: string, folders: ResultFolder[]): MediaSink & { count(): number } {
  let count = 0;
  const used = new Set<string>();
  const save = (data: Buffer, kind: string, ext: string): string => {
    count += 1;
    const name = `${count}-${sanitizeForFilePath(kind)}${ext}`;
    writeFileSync(join(mediaDir, name), data);
    return `media/${name}`;
  };
  return {
    count: () => count,
    bytes: (attachment: PlaywrightAttachment) => {
      if (attachment.body) return Buffer.from(attachment.body, 'base64');
      if (attachment.path && existsSync(attachment.path)) return readFileSync(attachment.path);
      return undefined;
    },
    save,
    locateVideo: ({ file, titlePath, projectName, retry }) => {
      const exact = playwrightOutputFolder({ specFile: file, titlePath, projectName, retry });
      const bare = playwrightOutputFolder({ specFile: file, titlePath });
      const suffix = projectName ? `-${sanitizeForFilePath(projectName)}` : '';
      const candidates = folders.filter((folder) => {
        if (used.has(folder.dir)) return false;
        if (folder.name === exact) return true;
        const withoutProject = suffix && folder.name.endsWith(suffix) ? folder.name.slice(0, -suffix.length) : folder.name;
        return folderMatchesLoosely(withoutProject, `${file.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '')}-${sanitizeForFilePath(titlePath.join(' '))}`) || withoutProject === bare;
      });
      // An exact name first; otherwise the oldest matching folder, so repeated runs are taken in order.
      candidates.sort((a, b) => (a.name === exact ? -1 : b.name === exact ? 1 : a.dir.localeCompare(b.dir)));
      for (const folder of candidates) {
        const video = videoIn(folder);
        if (video) {
          used.add(folder.dir);
          return video;
        }
      }
      return undefined;
    },
    copy: (file, kind) => {
      count += 1;
      const name = `${count}-${sanitizeForFilePath(kind)}${extname(file)}`;
      copyFileSync(file, join(mediaDir, name));
      return `media/${name}`;
    },
  };
}

export async function buildEvidenceSite(options: BuildEvidenceSiteOptions): Promise<EvidenceSummary> {
  const { reports, out, testResults = [], title = 'Wallet E2E Evidence', ffmpegPath } = options;
  // Read and parse every report before touching the output: a wrong path must leave the last
  // site as it was, not an empty media folder.
  const parsed = reports.map((file) => {
    if (!existsSync(file)) throw new Error(`report not found: ${file}`);
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as PlaywrightReport;
    } catch (cause) {
      throw new Error(`report is not Playwright JSON: ${file} (${cause instanceof Error ? cause.message : String(cause)})`);
    }
  });
  const mediaDir = join(out, 'media');
  rmSync(mediaDir, { recursive: true, force: true });
  mkdirSync(mediaDir, { recursive: true });
  const sink = createSink(mediaDir, resultFolders(testResults));
  const model: EvidenceModel = collectEvidence(parsed, sink);

  let fullFlow: FullFlow | undefined;
  if (options.fullFlow) {
    const spec = model.specs.find((section) => section.file === options.fullFlow || basename(section.file) === basename(options.fullFlow!));
    const clips = spec?.tests.flatMap((test) => (test.video ? [join(out, test.video)] : [])) ?? [];
    if (clips.length > 0) {
      const name = `${sanitizeForFilePath(basename(spec!.file).replace(/\.(spec|test)\.[cm]?[jt]sx?$/, ''))}-full-flow.mp4`;
      await concatVideos(clips, join(mediaDir, name), ffmpegPath);
      fullFlow = {
        title: options.fullFlowTitle ?? 'Full flow in one video',
        ...(options.fullFlowDescription ? { description: options.fullFlowDescription } : {}),
        href: `media/${name}`,
        clips: clips.length,
      };
    }
  }

  const totals = totalsOf(model);
  writeFileSync(join(out, 'index.html'), renderSite(model, { title, subtitle: options.subtitle, explorerTxUrl: options.explorerTxUrl, fullFlow, totals }));
  if (options.netlify) {
    writeFileSync(join(out, '_headers'), headersFile());
    writeFileSync(join(out, 'netlify.toml'), netlifyToml());
  }
  return {
    ...totals,
    out,
    media: sink.count() + (fullFlow ? 1 : 0),
    ...(fullFlow ? { fullFlow: { href: fullFlow.href, clips: fullFlow.clips } } : {}),
  };
}
