#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'node:fs';
import { discoverProjects, projectsRoot } from './projects.js';
import {
  activeRun,
  cancelRun,
  getRun,
  listRuns,
  runArtifacts,
  startRun,
  type Run,
} from './runs.js';

const VERSION = '0.1.0';

/**
 * Schemas are hand-written JSON Schema rather than generated, and stay flat: no top-level
 * `oneOf`/`anyOf`, one level of properties, a description on every field. Non-Claude clients and
 * smaller models discover usage from this text alone.
 */
const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description:
      'List the runnable Playwright test projects. Returns an id per project; every other tool ' +
      'takes one of these ids. Call this first — ids are the only accepted way to name a project.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'start_run',
    description:
      'Start a wallet E2E test run and return immediately with a runId. Runs are asynchronous ' +
      'because a real wallet suite takes minutes (a testnet block alone is ~10 minutes), far ' +
      'longer than a tool call may block. Poll get_run with the returned runId. Only one run at a ' +
      'time: wallet suites use a persistent browser profile that cannot be shared.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project id from list_projects. Not a filesystem path.',
        },
        grep: {
          type: 'string',
          description: 'Optional. Only run tests whose title matches this regular expression.',
        },
        testFile: {
          type: 'string',
          description:
            'Optional. Path of a single spec file, relative to the project directory, to run ' +
            'instead of the whole suite.',
        },
        headed: {
          type: 'boolean',
          description:
            'Optional, default false. Show the browser window. Requires a display; leave false in CI.',
        },
      },
      required: ['project'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_run',
    description:
      'Current state of a run: running, passed, failed, error or cancelled, with executed / ' +
      'passed / failed / flaky / skipped counts and the first failures. Check `executed` — a ' +
      'suite in which everything skipped still exits 0, and is reported here as `error`, not a pass.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'runId returned by start_run.' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_report',
    description:
      'Artifact locations for a finished run: the HTML report directory and every attachment ' +
      '(video, trace, screenshot) with its path on disk. Open the HTML report to view them.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'runId returned by start_run.' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_run',
    description: 'Stop a run that is still running. Has no effect on a run that already finished.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'runId returned by start_run.' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
];

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function runSummary(run: Run): Record<string, unknown> {
  return {
    runId: run.runId,
    project: run.projectId,
    state: run.state,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    counts: run.counts,
    failures: run.failures,
    ...(run.state === 'error' && run.counts?.executed === 0
      ? {
          note:
            'No test executed. Every test was skipped or the runner never started — this is not a ' +
            'passing run. A common cause is the wallet extension not being built.',
        }
      : {}),
    ...(run.state === 'error' && run.stderrTail.length > 0 ? { stderr: run.stderrTail } : {}),
  };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function handle(name: string, args: Record<string, unknown>): CallToolResult {
  switch (name) {
    case 'list_projects': {
      const projects = discoverProjects();
      return json({
        root: projectsRoot(),
        projects: projects.map((project) => ({ id: project.id, configFile: project.configFile })),
        activeRun: activeRun()?.runId,
        recentRuns: listRuns().slice(0, 5).map((run) => ({ runId: run.runId, state: run.state })),
      });
    }

    case 'start_run': {
      const project = str(args, 'project');
      if (!project) return failure('`project` is required. Call list_projects for valid ids.');
      const run = startRun({
        projectId: project,
        grep: str(args, 'grep'),
        testFile: str(args, 'testFile'),
        headed: args.headed === true,
      });
      return json({
        runId: run.runId,
        project: run.projectId,
        state: run.state,
        next: 'Poll get_run with this runId. Wallet suites commonly take several minutes.',
      });
    }

    case 'get_run': {
      const runId = str(args, 'runId');
      if (!runId) return failure('`runId` is required.');
      return json(runSummary(getRun(runId)));
    }

    case 'get_report': {
      const runId = str(args, 'runId');
      if (!runId) return failure('`runId` is required.');
      const run = getRun(runId);
      return json({
        runId: run.runId,
        state: run.state,
        htmlReportDir: existsSync(run.reportDir) ? run.reportDir : undefined,
        openWith: `pnpm -C ${run.projectDir} exec playwright show-report`,
        artifacts: runArtifacts(run),
      });
    }

    case 'cancel_run': {
      const runId = str(args, 'runId');
      if (!runId) return failure('`runId` is required.');
      return json(runSummary(cancelRun(runId)));
    }

    default:
      return failure(`Unknown tool "${name}".`);
  }
}

const server = new Server(
  { name: 'wallets-e2e', version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  try {
    return handle(request.params.name, args);
  } catch (error) {
    // Returned as a tool result, not thrown: a protocol error surfaces as an opaque failure in
    // most clients, while this text reaches the model and tells it what to do differently.
    return failure(error instanceof Error ? error.message : String(error));
  }
});

await server.connect(new StdioServerTransport());
