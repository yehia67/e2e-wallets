// Node built-ins only: `node --test` runs this straight from source.
import { basename, extname } from 'node:path';

/** The parts of Playwright's JSON report this reads. */
export interface PlaywrightAttachment {
  name: string;
  contentType?: string;
  path?: string;
  body?: string;
}

export interface PlaywrightResult {
  status: string;
  duration: number;
  retry?: number;
  error?: { message?: string };
  attachments?: PlaywrightAttachment[];
}

export interface PlaywrightTest {
  projectName?: string;
  results: PlaywrightResult[];
}

export interface PlaywrightSpec {
  title: string;
  file?: string;
  tests?: PlaywrightTest[];
}

export interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

export interface PlaywrightReport {
  stats?: { startTime?: string };
  suites?: PlaywrightSuite[];
}

export interface TransactionRow {
  hash: string;
  userOpHash?: string;
}

export interface MediaRef {
  name: string;
  /** Path relative to the site root, e.g. `media/12-screenshot.png`. */
  href: string;
}

export interface TestRow {
  /** `file + title path`, what a rerun's result replaces. */
  key: string;
  file: string;
  titlePath: string[];
  title: string;
  projectName?: string;
  status: string;
  duration: number;
  error?: string;
  transactions: TransactionRow[];
  screenshots: MediaRef[];
  video?: string;
}

export interface SpecSection {
  file: string;
  tests: TestRow[];
}

export interface EvidenceModel {
  runDate: string;
  specs: SpecSection[];
}

/** How the model gets media on disk and finds a video the report does not point at any more. */
export interface MediaSink {
  /** The attachment's bytes, from its inline body or its recorded path; undefined when gone. */
  bytes(attachment: PlaywrightAttachment): Buffer | undefined;
  /** Stores bytes under `<n>-<kind><ext>` and returns the site-relative href. */
  save(data: Buffer, kind: string, ext: string): string;
  /** A video file for the test when its attachment path no longer resolves. */
  locateVideo(test: { file: string; titlePath: string[]; projectName?: string; retry: number }): string | undefined;
  /** Copies a located file into the media folder and returns the href. */
  copy(file: string, kind: string): string;
}

/** Attachment names that carry a transaction the test proved on chain, as `{ hash, userOpHash? }` JSON. */
export const TRANSACTION_ATTACHMENTS = ['confirmed-aa-transaction', 'confirmed-transaction'];

/** Attachment names that carry the test's video. */
export const VIDEO_ATTACHMENTS = ['video', 'app-video'];

function videoExtension(attachment: PlaywrightAttachment): string {
  if (attachment.contentType === 'video/mp4') return '.mp4';
  if (attachment.path && extname(attachment.path)) return extname(attachment.path);
  return '.webm';
}

/**
 * Walks the reports, in order, into one row per test. A later report's result for the same test
 * (same file and title path) replaces the earlier one, so a rerun of a failed spec can be merged
 * into the suite's evidence; only each test's last result is read.
 */
export function collectEvidence(reports: readonly PlaywrightReport[], sink: MediaSink): EvidenceModel {
  const specs = new Map<string, SpecSection>();
  const runDate = (reports[0]?.stats?.startTime ?? new Date().toISOString()).slice(0, 10);

  const visit = (suite: PlaywrightSuite, file: string | undefined, titles: string[]): void => {
    for (const spec of suite.specs ?? []) {
      const specFile = file ?? spec.file ?? 'unknown';
      for (const test of spec.tests ?? []) {
        const result = test.results[test.results.length - 1];
        if (!result) continue;
        const titlePath = [...titles, spec.title];
        const row = toRow({ specFile, titlePath, test, result, sink });
        const section = specs.get(specFile) ?? { file: specFile, tests: [] };
        const at = section.tests.findIndex((existing) => existing.key === row.key);
        if (at >= 0) section.tests[at] = row;
        else section.tests.push(row);
        specs.set(specFile, section);
      }
    }
    for (const child of suite.suites ?? []) {
      // A nested suite is a `describe` block unless its title is the file itself.
      const isFileSuite = child.title === child.file || child.title === basename(child.file ?? '');
      visit(child, file ?? child.file, isFileSuite ? titles : [...titles, child.title]);
    }
  };
  for (const report of reports) for (const suite of report.suites ?? []) visit(suite, suite.file, []);

  return { runDate, specs: [...specs.values()] };
}

function toRow(args: {
  specFile: string;
  titlePath: string[];
  test: PlaywrightTest;
  result: PlaywrightResult;
  sink: MediaSink;
}): TestRow {
  const { specFile, titlePath, test, result, sink } = args;
  const transactions: TransactionRow[] = [];
  const screenshots: MediaRef[] = [];
  let video: string | undefined;

  for (const attachment of result.attachments ?? []) {
    if (TRANSACTION_ATTACHMENTS.includes(attachment.name)) {
      const data = sink.bytes(attachment);
      if (!data) continue;
      try {
        const parsed = JSON.parse(data.toString('utf8')) as { hash?: string; userOpHash?: string };
        if (parsed.hash) transactions.push({ hash: parsed.hash, ...(parsed.userOpHash ? { userOpHash: parsed.userOpHash } : {}) });
      } catch {
        // Not the JSON the contract describes; the row just has no link for it.
      }
    } else if (attachment.contentType?.startsWith('image/')) {
      const data = sink.bytes(attachment);
      if (data) screenshots.push({ name: attachment.name, href: sink.save(data, attachment.name, attachment.contentType === 'image/jpeg' ? '.jpg' : '.png') });
    } else if (!video && attachment.contentType?.startsWith('video/') && VIDEO_ATTACHMENTS.includes(attachment.name)) {
      const data = sink.bytes(attachment);
      if (data) video = sink.save(data, 'video', videoExtension(attachment));
    }
  }
  if (!video) {
    const located = sink.locateVideo({ file: specFile, titlePath, projectName: test.projectName, retry: result.retry ?? 0 });
    if (located) video = sink.copy(located, 'video');
  }

  return {
    key: `${specFile} > ${titlePath.join(' > ')}`,
    file: specFile,
    titlePath,
    title: titlePath[titlePath.length - 1] ?? '',
    ...(test.projectName ? { projectName: test.projectName } : {}),
    status: result.status,
    duration: result.duration,
    ...(result.error?.message ? { error: result.error.message } : {}),
    transactions,
    screenshots,
    ...(video ? { video } : {}),
  };
}

export interface EvidenceTotals {
  specs: number;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
}

export function totalsOf(model: EvidenceModel): EvidenceTotals {
  const tests = model.specs.flatMap((spec) => spec.tests);
  return {
    specs: model.specs.length,
    tests: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => test.status === 'failed' || test.status === 'timedOut').length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
  };
}
