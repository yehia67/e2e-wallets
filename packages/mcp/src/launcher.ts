import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type ArtifactKind = 'video' | 'screenshot' | 'trace' | 'other';
export type PackageManager = 'pnpm' | 'yarn' | 'npm';

export interface PlaywrightLauncher {
  manager: PackageManager;
  command: string;
  testArgs: string[];
  openReport: string;
}

function bin(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

/**
 * Pick the package manager the project actually uses so this server works in npm, pnpm, and yarn
 * apps — not only in this monorepo.
 */
export function detectPlaywrightLauncher(startDir: string): PlaywrightLauncher {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) {
      return {
        manager: 'pnpm',
        command: bin('pnpm'),
        testArgs: ['exec', 'playwright', 'test'],
        openReport: `pnpm --dir ${startDir} exec playwright show-report`,
      };
    }
    if (existsSync(join(dir, 'yarn.lock'))) {
      return {
        manager: 'yarn',
        command: bin('yarn'),
        testArgs: ['exec', 'playwright', 'test'],
        openReport: `yarn --cwd ${startDir} playwright show-report`,
      };
    }
    if (existsSync(join(dir, 'package-lock.json')) || existsSync(join(dir, 'npm-shrinkwrap.json'))) {
      return {
        manager: 'npm',
        command: bin('npx'),
        testArgs: ['playwright', 'test'],
        openReport: `npx playwright show-report`,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    manager: 'npm',
    command: bin('npx'),
    testArgs: ['playwright', 'test'],
    openReport: `npx playwright show-report`,
  };
}

export function assertSafeTestFile(testFile: string, projectDir: string): string {
  const trimmed = testFile.trim();
  if (!trimmed) throw new Error('`testFile` must be a non-empty path relative to the project directory.');
  if (isAbsolute(trimmed) || trimmed.split(/[/\\]/).includes('..')) {
    throw new Error(
      `testFile must be a path relative to the project directory, without "..". Got "${trimmed}".`,
    );
  }
  const resolved = resolve(projectDir, trimmed);
  const rel = relative(projectDir, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`testFile "${trimmed}" resolves outside the project directory.`);
  }
  return trimmed;
}

export function classifyArtifact(name: string, contentType: string, path: string): ArtifactKind {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (contentType.startsWith('video/') || lowerName === 'video' || /\.(webm|mp4)$/.test(lowerPath)) {
    return 'video';
  }
  if (contentType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(lowerPath)) {
    return 'screenshot';
  }
  if (lowerName.includes('trace') || lowerPath.endsWith('.zip') || contentType.includes('zip')) {
    return 'trace';
  }
  return 'other';
}
