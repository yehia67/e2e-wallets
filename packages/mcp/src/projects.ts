import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface TestProject {
  id: string;
  dir: string;
  configFile: string;
}

const CONFIG_NAMES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', '.turbo', 'test-results', 'playwright-report', '.features-gen']);

export function projectsRoot(): string {
  return resolve(process.env.WALLETS_E2E_MCP_ROOT?.trim() || process.cwd());
}

function findConfig(dir: string): string | undefined {
  return CONFIG_NAMES.map((name) => join(dir, name)).find((path) => existsSync(path));
}

/**
 * Discovers runnable Playwright projects under the root, to a bounded depth. This list is also the
 * allowlist: a tool caller names an `id` from here and never a filesystem path, so no argument
 * from a model can point the runner at an arbitrary directory.
 */
export function discoverProjects(root = projectsRoot(), maxDepth = 3): TestProject[] {
  const found: TestProject[] = [];

  const walk = (dir: string, depth: number): void => {
    const configFile = findConfig(dir);
    if (configFile) {
      const id = relative(root, dir).split(sep).join('/') || '.';
      found.push({ id, dir, configFile });
      return;
    }
    if (depth >= maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
      const child = join(dir, entry);
      try {
        if (statSync(child).isDirectory()) walk(child, depth + 1);
      } catch {
        // Unreadable or vanished between readdir and stat.
      }
    }
  };

  walk(root, 0);
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveProject(id: string, root = projectsRoot()): TestProject {
  const projects = discoverProjects(root);
  const match = projects.find((project) => project.id === id);
  if (match) return match;

  // Reject anything that is not a known id, including absolute or traversing paths.
  const looksLikePath = isAbsolute(id) || id.includes('..');
  const known = projects.map((project) => project.id).join(', ') || '(none found)';
  throw new Error(
    looksLikePath
      ? `"${id}" is not a project id. Pass an id from list_projects, not a path. Known ids: ${known}`
      : `Unknown project "${id}". Known ids: ${known}`,
  );
}
