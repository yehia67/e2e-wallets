#!/usr/bin/env node
import { parseCliArgs, USAGE } from './cli-args.js';
import { buildEvidenceSite } from './index.js';

let args;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
try {
  const summary = await buildEvidenceSite({
    reports: args.reports,
    out: args.out,
    testResults: args.testResults,
    title: args.title,
    subtitle: args.subtitle,
    explorerTxUrl: args.explorerTxUrl,
    fullFlow: args.fullFlow,
    fullFlowTitle: args.fullFlowTitle,
    fullFlowDescription: args.fullFlowDescription,
    netlify: args.netlify,
    ffmpegPath: args.ffmpeg,
  });
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(`wallets-e2e-evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
