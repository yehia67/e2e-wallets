#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GUIDES, readGuide } from '@wallets-e2e/knowledge';
import { discoverProjects, projectsRoot } from './projects.js';
import {
  activeRun,
  cancelRun,
  getRun,
  listRuns,
  readRunArtifact,
  reviewScreenshots,
  runArtifacts,
  startRun,
  type EmbeddedImage,
  type Run,
  type RunArtifact,
} from './runs.js';

// Read at runtime so the version a client displays can never drift from the published package.
const require = createRequire(import.meta.url);
const VERSION = (require('../package.json') as { version: string }).version;

/**
 * Schemas are hand-written JSON Schema rather than generated, and stay flat: no top-level
 * `oneOf`/`anyOf`, one level of properties, a description on every field. Non-Claude clients and
 * smaller models discover usage from this text alone.
 */
const TOOLS: Tool[] = [
  {
    name: 'list_guides',
    description:
      'List the guides that explain how to WRITE wallet E2E tests — the workflow after finishing a ' +
      'feature, the driver APIs for MetaMask and Leather, fixtures and artifacts, Gherkin, and ' +
      'troubleshooting. Each entry says when to read it. Start with the `feature-to-test` guide ' +
      'whenever you have just implemented or changed a dapp feature.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_guide',
    description:
      'Full text of one guide from list_guides. Read the guide before writing test code — it carries ' +
      'the exact APIs, the popup-queueing rule, and the receipt-polling requirement that make a ' +
      'wallet test correct rather than merely passing.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Guide id from list_guides, e.g. "feature-to-test".' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
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
            'instead of the whole suite. No absolute paths or ".." segments.',
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
      'Reviewer evidence for a finished run: HTML report path, every video / screenshot / trace, ' +
      'and (by default) up to four representative screenshots embedded as images so the reviewer ' +
      'can see the wallet popup and dapp result here. Call this on every finished run, pass or fail.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'runId returned by start_run.' },
        includeScreenshots: {
          type: 'boolean',
          description:
            'Optional, default true. Embed up to four screenshots as images in the tool result.',
        },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_artifact',
    description:
      'Fetch one artifact from get_report by its path. Screenshots under 1.5 MB are returned as ' +
      'images the reviewer can see in this conversation. Videos are too large to embed; the result ' +
      'gives the path to open locally or in the HTML report.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'runId returned by start_run.' },
        path: {
          type: 'string',
          description: 'Exact artifact path from get_report. Arbitrary filesystem paths are refused.',
        },
      },
      required: ['runId', 'path'],
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

function imagePart(image: EmbeddedImage): { type: 'image'; data: string; mimeType: string } {
  return { type: 'image', data: image.data, mimeType: image.mimeType };
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

function byKind(artifacts: RunArtifact[], kind: RunArtifact['kind']): RunArtifact[] {
  return artifacts.filter((artifact) => artifact.kind === kind);
}

function reportPayload(run: Run): Record<string, unknown> {
  const artifacts = runArtifacts(run);
  const videos = byKind(artifacts, 'video');
  const screenshots = byKind(artifacts, 'screenshot');
  const traces = byKind(artifacts, 'trace');
  const executed = run.counts?.executed ?? 0;
  return {
    runId: run.runId,
    state: run.state,
    counts: run.counts,
    htmlReportDir: existsSync(run.reportDir) ? run.reportDir : undefined,
    openHtmlReport: run.openReport,
    reviewerHandoff: {
      summary:
        executed === 0
          ? 'Nothing executed. Do not call this a pass. Fix the skip (usually a missing extension) and re-run.'
          : `${run.state}: ${run.counts?.passed ?? 0} passed, ${run.counts?.failed ?? 0} failed, ` +
            `${run.counts?.flaky ?? 0} flaky, ${run.counts?.skipped ?? 0} skipped. ` +
            `${videos.length} video(s), ${screenshots.length} screenshot(s).`,
      instruction:
        'Give the human reviewer the HTML report, every video path, and representative screenshots. ' +
        'Open the HTML report to play videos in the browser. A passing run with no video of the ' +
        'wallet or dapp is incomplete evidence — the reviewer must be able to watch the real popups ' +
        'and on-chain flow.',
      videos,
      screenshots,
      traces,
    },
    artifacts,
  };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function handle(name: string, args: Record<string, unknown>): CallToolResult {
  switch (name) {
    case 'list_guides': {
      return json({
        startHere: 'feature-to-test',
        guides: GUIDES.map(({ id, title, when }) => ({ id, title, when })),
      });
    }

    case 'get_guide': {
      const id = str(args, 'id');
      if (!id) return failure('`id` is required. Call list_guides for valid ids.');
      return { content: [{ type: 'text', text: readGuide(id) }] };
    }

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
        next: 'Poll get_run with this runId. Wallet suites commonly take several minutes. When it finishes, call get_report even if it passed — the reviewer needs the video and screenshots.',
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
      const payload = reportPayload(run);
      const content: CallToolResult['content'] = [
        { type: 'text', text: JSON.stringify(payload, null, 2) },
      ];
      if (args.includeScreenshots !== false) {
        for (const image of reviewScreenshots(run)) content.push(imagePart(image));
      }
      return { content };
    }

    case 'get_artifact': {
      const runId = str(args, 'runId');
      const path = str(args, 'path');
      if (!runId) return failure('`runId` is required.');
      if (!path) return failure('`path` is required. Pass an artifact path from get_report.');
      const { artifact, image } = readRunArtifact(getRun(runId), path);
      const size = statSync(artifact.path).size;
      const meta = {
        name: artifact.name,
        kind: artifact.kind,
        contentType: artifact.contentType,
        path: artifact.path,
        bytes: size,
        ...(artifact.kind === 'video'
          ? {
              note:
                'Video is too large to embed. Open this path locally, or play it inside the HTML report from get_report.',
            }
          : {}),
        ...(artifact.kind === 'screenshot' && !image
          ? { note: 'Screenshot exists but is empty or larger than 1.5 MB; open the path instead.' }
          : {}),
      };
      const content: CallToolResult['content'] = [
        { type: 'text', text: JSON.stringify(meta, null, 2) },
      ];
      if (image) content.push(imagePart(image));
      return { content };
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

// Surfaced by clients on connect, so an agent learns the loop without being told about it in a
// prompt: build the feature, then prove it with a real wallet before calling it done.
const INSTRUCTIONS = `Prove wallet-touching dapp features with a real MetaMask or Leather browser extension.

Typical job: the user asked you to build something — a USDC deposit, a connect button, a swap, a
contract call. Implement the frontend and contracts, then drive the real wallet and hand back video
plus screenshots. Reasoning about the flow is not done.

The loop:
1. get_guide "feature-to-test" before writing any test code.
2. get_guide for the wallet ("metamask-evm" or "leather-stacks") for the driver API.
3. Write the test in the project's own conventions, installing published @wallets-e2e/* packages.
4. list_projects, then start_run — it returns a runId immediately. Do not block; a testnet
   confirmation can take ~10 minutes.
5. Poll get_run. Read "executed", not just pass/fail: a suite in which every test skipped still
   exits 0, so executed=0 is an error, not a pass.
6. ALWAYS call get_report when the run finishes, pass or fail. It embeds representative screenshots.
   Call get_artifact for any extra screenshot the reviewer should see. Give them the video paths and
   HTML report so they can watch the real popups and on-chain transactions.

Two rules that decide whether a wallet test is correct rather than merely green: queue the dapp click
inside the driver's trigger callback (never click before the driver is listening), and assert on-chain
via a receipt (a closed popup does not prove a transaction landed).`;

const server = new Server(
  { name: 'wallets-e2e', version: VERSION },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
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
