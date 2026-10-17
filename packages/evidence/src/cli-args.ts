// No runtime imports: `node --test` runs this straight from source.

export interface CliArgs {
  reports: string[];
  out: string;
  testResults: string[];
  title: string;
  subtitle?: string;
  explorerTxUrl?: string;
  fullFlow?: string;
  fullFlowTitle?: string;
  fullFlowDescription?: string;
  netlify: boolean;
  ffmpeg?: string;
  help: boolean;
}

export const USAGE = `wallets-e2e-evidence --report <a.json[,b.json...]> --out <dir> [options]

Builds a static evidence site (index.html + media/) from Playwright JSON reports.

  --report <files>         Report(s), comma-separated. A later report's result for a test replaces
                           the earlier one, so a rerun can be merged over the suite run.
  --out <dir>              Where the site goes. Created; media/ inside it is replaced.
  --test-results <dirs>    Playwright output folder(s), comma-separated, searched for a test's video
                           when the report's attachment path no longer resolves.
  --title <text>           Page title. Default "Wallet E2E Evidence".
  --subtitle <text>        Sentence under the title; "{date}" becomes the run date.
  --explorer-tx-url <url>  Prefix transaction hashes are linked with, e.g. https://sepolia.basescan.org/tx/
  --full-flow <spec>       Spec file whose test videos are joined, in run order, into one video.
  --full-flow-title <t>    Heading of that section. Default "Full flow in one video".
  --full-flow-description <t>
  --netlify                Also write netlify.toml and _headers for a Netlify deploy.
  --ffmpeg <path>          FFmpeg executable. Default: ffmpeg on PATH.
  --help
`;

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { reports: [], out: '', testResults: [], title: 'Wallet E2E Evidence', netlify: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value.`);
      i += 1;
      return next;
    };
    switch (flag) {
      case '--report': args.reports.push(...list(value())); break;
      case '--out': args.out = value(); break;
      case '--test-results': args.testResults.push(...list(value())); break;
      case '--title': args.title = value(); break;
      case '--subtitle': args.subtitle = value(); break;
      case '--explorer-tx-url': args.explorerTxUrl = value(); break;
      case '--full-flow': args.fullFlow = value(); break;
      case '--full-flow-title': args.fullFlowTitle = value(); break;
      case '--full-flow-description': args.fullFlowDescription = value(); break;
      case '--netlify': args.netlify = true; break;
      case '--ffmpeg': args.ffmpeg = value(); break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`Unknown option ${flag}.\n\n${USAGE}`);
    }
  }
  if (!args.help) {
    if (args.reports.length === 0) throw new Error(`--report is required.\n\n${USAGE}`);
    if (!args.out) throw new Error(`--out is required.\n\n${USAGE}`);
  }
  return args;
}
