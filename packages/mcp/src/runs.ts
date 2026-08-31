import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveProject, type TestProject } from './projects.js';

export type RunState = 'running' | 'passed' | 'failed' | 'error' | 'cancelled';

export interface RunCounts {
  executed: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export interface Run {
  runId: string;
  projectId: string;
  projectDir: string;
  state: RunState;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  counts?: RunCounts;
  failures: Array<{ title: string; error: string }>;
  jsonPath: string;
  reportDir: string;
  stderrTail: string[];
  child?: ChildProcess;
}

const runs = new Map<string, Run>();
const MAX_STDERR_LINES = 40;

export function activeRun(): Run | undefined {
  return [...runs.values()].find((run) => run.state === 'running');
}

export function getRun(runId: string): Run {
  const run = runs.get(runId);
  if (!run) {
    const known = [...runs.keys()].join(', ') || '(none)';
    throw new Error(`Unknown runId "${runId}". Known runs: ${known}`);
  }
  return run;
}

export function listRuns(): Run[] {
  return [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Env handed to the runner. Secrets are read from this server's own environment and never accepted
 * as tool arguments, so a seed phrase cannot reach a model's context or a client's logs. Spending
 * gates are likewise inherited, not settable per call.
 */
function runnerEnv(jsonPath: string): NodeJS.ProcessEnv {
  return { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath, FORCE_COLOR: '0' };
}

export interface StartRunOptions {
  projectId: string;
  grep?: string;
  testFile?: string;
  headed?: boolean;
}

export function startRun(options: StartRunOptions): Run {
  const existing = activeRun();
  if (existing) {
    throw new Error(
      `Run ${existing.runId} is still running on project "${existing.projectId}". Wallet suites use a ` +
        `persistent browser profile and cannot run concurrently. Wait for it or call cancel_run.`,
    );
  }

  const project: TestProject = resolveProject(options.projectId);
  const jsonPath = join(mkdtempSync(join(tmpdir(), 'wallets-e2e-mcp-')), 'results.json');

  const args = ['exec', 'playwright', 'test', '--reporter=list,html,json'];
  if (options.grep) args.push('--grep', options.grep);
  if (options.testFile) args.push(options.testFile);
  if (options.headed) args.push('--headed');

  const run: Run = {
    runId: randomUUID(),
    projectId: project.id,
    projectDir: project.dir,
    state: 'running',
    startedAt: new Date().toISOString(),
    failures: [],
    jsonPath,
    reportDir: join(project.dir, 'playwright-report'),
    stderrTail: [],
  };

  // No shell: args are passed as an array, so nothing in them can be interpreted as a command.
  const child = spawn('pnpm', args, {
    cwd: project.dir,
    env: runnerEnv(jsonPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  run.child = child;

  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      run.stderrTail.push(line);
      if (run.stderrTail.length > MAX_STDERR_LINES) run.stderrTail.shift();
    }
  });
  child.stdout?.resume();

  child.on('error', (error) => {
    run.state = 'error';
    run.endedAt = new Date().toISOString();
    run.stderrTail.push(String(error));
    run.child = undefined;
  });

  child.on('close', (code) => {
    run.exitCode = code;
    run.endedAt = new Date().toISOString();
    run.child = undefined;
    if (run.state === 'cancelled') return;
    finalise(run, code);
  });

  runs.set(run.runId, run);
  return run;
}

function finalise(run: Run, code: number | null): void {
  const parsed = readResults(run.jsonPath);
  if (!parsed) {
    run.state = 'error';
    return;
  }
  run.counts = parsed.counts;
  run.failures = parsed.failures;

  // Exit code alone is not enough: a suite in which every test skipped also exits 0. Treat a run
  // that executed nothing as unresolved rather than as a pass.
  if (parsed.counts.executed === 0) {
    run.state = 'error';
    return;
  }
  run.state = code === 0 && parsed.counts.failed === 0 ? 'passed' : 'failed';
}

interface ParsedResults {
  counts: RunCounts;
  failures: Array<{ title: string; error: string }>;
}

function readResults(jsonPath: string): ParsedResults | undefined {
  if (!existsSync(jsonPath)) return undefined;
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    return undefined;
  }

  const stats = (report as { stats?: Record<string, unknown> }).stats ?? {};
  const num = (key: string): number => (typeof stats[key] === 'number' ? (stats[key] as number) : 0);
  const passed = num('expected');
  const failed = num('unexpected');
  const flaky = num('flaky');
  const skipped = num('skipped');

  return {
    counts: { executed: passed + failed + flaky, passed, failed, flaky, skipped },
    failures: collectFailures(report),
  };
}

function collectFailures(report: unknown): Array<{ title: string; error: string }> {
  const failures: Array<{ title: string; error: string }> = [];

  const visitSpec = (spec: Record<string, unknown>, titlePath: string[]): void => {
    const title = [...titlePath, String(spec.title ?? '')].filter(Boolean).join(' › ');
    for (const test of (spec.tests as Array<Record<string, unknown>>) ?? []) {
      if (test.status === 'expected' || test.status === 'skipped') continue;
      const results = (test.results as Array<Record<string, unknown>>) ?? [];
      const message = results
        .map((result) => (result.error as { message?: string } | undefined)?.message)
        .find(Boolean);
      failures.push({ title, error: (message ?? 'no error message reported').slice(0, 2000) });
    }
  };

  const visitSuite = (suite: Record<string, unknown>, titlePath: string[]): void => {
    const path = [...titlePath, String(suite.title ?? '')].filter(Boolean);
    for (const spec of (suite.specs as Array<Record<string, unknown>>) ?? []) visitSpec(spec, path);
    for (const child of (suite.suites as Array<Record<string, unknown>>) ?? []) visitSuite(child, path);
  };

  for (const suite of (report as { suites?: Array<Record<string, unknown>> }).suites ?? []) {
    visitSuite(suite, []);
  }
  return failures.slice(0, 20);
}

export interface RunArtifact {
  name: string;
  contentType: string;
  path: string;
  exists: boolean;
}

export function runArtifacts(run: Run): RunArtifact[] {
  if (!existsSync(run.jsonPath)) return [];
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(run.jsonPath, 'utf8'));
  } catch {
    return [];
  }

  const artifacts: RunArtifact[] = [];
  const visit = (suite: Record<string, unknown>): void => {
    for (const spec of (suite.specs as Array<Record<string, unknown>>) ?? []) {
      for (const test of (spec.tests as Array<Record<string, unknown>>) ?? []) {
        for (const result of (test.results as Array<Record<string, unknown>>) ?? []) {
          for (const attachment of (result.attachments as Array<Record<string, unknown>>) ?? []) {
            const path = typeof attachment.path === 'string' ? attachment.path : '';
            if (!path) continue;
            artifacts.push({
              name: String(attachment.name ?? 'attachment'),
              contentType: String(attachment.contentType ?? 'application/octet-stream'),
              path,
              exists: existsSync(path),
            });
          }
        }
      }
    }
    for (const child of (suite.suites as Array<Record<string, unknown>>) ?? []) visit(child);
  };

  for (const suite of (report as { suites?: Array<Record<string, unknown>> }).suites ?? []) visit(suite);
  return artifacts;
}

export function cancelRun(runId: string): Run {
  const run = getRun(runId);
  if (run.state !== 'running') throw new Error(`Run ${runId} is already ${run.state}.`);
  run.state = 'cancelled';
  run.child?.kill('SIGTERM');
  return run;
}
