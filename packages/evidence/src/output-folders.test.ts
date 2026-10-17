import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import { folderMatchesLoosely, playwrightOutputFolder, sanitizeForFilePath, trimLongString } from './output-folders.ts';

/** Folder names one real run wrote (T-REX console suite, project `metamask-base-sepolia`). */
const REAL_FOLDERS = [
  'compliance-unbinds-and-reb-4af20-inding-one-first-if-none-is-metamask-base-sepolia',
  'deploy-token-token-deploym-1492d-s-its-first-verified-holder-metamask-base-sepolia',
  'deploy-token-token-deploym-154a1-r-the-operator-s-own-tokens-metamask-base-sepolia',
  'deploy-token-token-deploym-34d9e-r-the-operator-s-own-tokens-metamask-base-sepolia',
  'deploy-token-token-deploym-36fee-loys-mints-the-first-supply-metamask-base-sepolia',
  'deploy-token-token-deploym-3dc8e--as-the-deployer-created-it-metamask-base-sepolia',
  'deploy-token-token-deploym-45111-ters-mints-the-first-supply-metamask-base-sepolia',
  'deploy-token-token-deploym-8b071--as-the-deployer-created-it-metamask-base-sepolia',
  'deploy-token-token-deploym-a7abb-s-its-first-verified-holder-metamask-base-sepolia',
  'deploy-token-token-deploym-b1b0d-auses-the-token-it-deployed-metamask-base-sepolia',
  'deploy-token-token-deploym-b43e7-hained-sponsored-operations-metamask-base-sepolia',
  'deploy-token-token-deploym-cdfd7-hained-sponsored-operations-metamask-base-sepolia',
];

describe('sanitizeForFilePath', () => {
  it('turns every run of non-alphanumeric ASCII into one dash and keeps dashes and non-ASCII', () => {
    assert.equal(sanitizeForFilePath("lists the operator's own tokens"), 'lists-the-operator-s-own-tokens');
    assert.equal(sanitizeForFilePath('a — b'), 'a-—-b');
    assert.equal(sanitizeForFilePath('already-dashed'), 'already-dashed');
  });
});

describe('trimLongString', () => {
  it('keeps short strings and cuts long ones to 26 + hash + 27', () => {
    assert.equal(trimLongString('short'), 'short');
    const long = 'x'.repeat(100);
    const trimmed = trimLongString(long);
    assert.equal(trimmed.length, 60);
    assert.match(trimmed, /^x{26}-[0-9a-f]{5}-x{27}$/);
  });
});

describe('playwrightOutputFolder', () => {
  it('reproduces a real short name exactly', () => {
    assert.equal(playwrightOutputFolder({
      specFile: 'compliance.spec.ts',
      titlePath: ['unbinds and rebinds a module on the token, binding one first if none is'],
      projectName: 'metamask-base-sepolia',
    }), REAL_FOLDERS[0]);
  });

  it('reproduces real names of nested describes, hash included', () => {
    const vectors: [string, string[]][] = [
      ['deploy-token.spec.ts', ['token deployment on a manager the operator administers', 'deploys a fresh suite as two chained sponsored operations']],
      ['deploy-token.spec.ts', ['token deployment on a manager the factory deploys', 'deploys a fresh suite as two chained sponsored operations']],
      ['deploy-token.spec.ts', ['token deployment on a manager the operator administers', "lists the new token under the operator's own tokens"]],
      ['deploy-token.spec.ts', ['token deployment on a manager the factory deploys', 're-pauses the token, leaving it as the deployer created it']],
    ];
    const produced = vectors.map(([specFile, titlePath]) => playwrightOutputFolder({ specFile, titlePath, projectName: 'metamask-base-sepolia' }));
    for (const folder of produced) assert.ok(REAL_FOLDERS.includes(folder), folder);
    assert.equal(new Set(produced).size, produced.length);
  });

  it('adds the retry suffix and flattens directories in the spec path', () => {
    assert.equal(playwrightOutputFolder({ specFile: 'flows/deploy.test.ts', titlePath: ['works'], retry: 2 }), 'flows-deploy-works-retry2');
  });
});

describe('folderMatchesLoosely', () => {
  it('accepts the exact name and the trimmed shape with any hash', () => {
    const full = 'deploy-token-token-deployment-on-a-manager-the-operator-administers-deploys-a-fresh-suite-as-two-chained-sponsored-operations';
    assert.ok(folderMatchesLoosely('deploy-token-token-deploym-xxxxx-hained-sponsored-operations', full));
    assert.ok(!folderMatchesLoosely('deploy-token-token-deploym-xxxxx-something-else-entirely-ok', full));
    assert.ok(folderMatchesLoosely('short-name', 'short-name'));
  });
});
