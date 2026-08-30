import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Explicit `.ts` extension: run straight from source by `node --test`, excluded from the build.
import {
  DEFAULT_ARTIFACT_MODES,
  resolveArtifactMode,
  shouldRetainArtifact,
  walletReporters,
  withWalletReporting,
} from './artifacts.ts';

describe('DEFAULT_ARTIFACT_MODES', () => {
  it('reports every test with video and screenshots while retaining traces only for failures', () => {
    assert.deepEqual(DEFAULT_ARTIFACT_MODES, {
      video: 'on',
      screenshot: 'on',
      trace: 'retain-on-failure',
    });
  });
});

describe('resolveArtifactMode', () => {
  it('prefers an explicit option over everything else', () => {
    assert.equal(resolveArtifactMode('off', 'on', 'on'), 'off');
  });

  it('falls back to the project use block when no explicit option was given', () => {
    assert.equal(resolveArtifactMode(undefined, 'off', 'on'), 'off');
  });

  it('falls back to the documented default when neither was given', () => {
    assert.equal(resolveArtifactMode(undefined, undefined, 'only-on-failure'), 'only-on-failure');
  });

  it('reads .mode off the object form Playwright allows for video and trace', () => {
    assert.equal(
      resolveArtifactMode(undefined, { mode: 'retain-on-failure' }, 'on'),
      'retain-on-failure',
    );
  });

  it('maps the retry-scoped trace modes onto retain-on-failure', () => {
    assert.equal(resolveArtifactMode(undefined, 'on-first-retry', 'on'), 'retain-on-failure');
    assert.equal(resolveArtifactMode(undefined, 'on-all-retries', 'on'), 'retain-on-failure');
  });

  it('ignores values it does not recognise rather than trusting them', () => {
    assert.equal(resolveArtifactMode(undefined, 'sometimes', 'on'), 'on');
    assert.equal(resolveArtifactMode(undefined, null, 'on'), 'on');
    assert.equal(resolveArtifactMode(undefined, 42, 'on'), 'on');
  });
});

describe('shouldRetainArtifact', () => {
  it('always retains when the mode is on', () => {
    assert.equal(shouldRetainArtifact('on', 'passed', 'passed'), true);
    assert.equal(shouldRetainArtifact('on', 'failed', 'passed'), true);
  });

  it('never retains when the mode is off', () => {
    assert.equal(shouldRetainArtifact('off', 'failed', 'passed'), false);
  });

  it('retains on failure for both spellings of the failure-scoped modes', () => {
    assert.equal(shouldRetainArtifact('only-on-failure', 'failed', 'passed'), true);
    assert.equal(shouldRetainArtifact('retain-on-failure', 'timedOut', 'passed'), true);
  });

  it('discards on success for both spellings', () => {
    assert.equal(shouldRetainArtifact('only-on-failure', 'passed', 'passed'), false);
    assert.equal(shouldRetainArtifact('retain-on-failure', 'passed', 'passed'), false);
  });

  it('treats an expected failure as a pass and retains nothing', () => {
    // test.fail() marks expectedStatus 'failed'; a test that failed as instructed did not go wrong.
    assert.equal(shouldRetainArtifact('retain-on-failure', 'failed', 'failed'), false);
  });
});

describe('walletReporters', () => {
  it('pairs the live list reporter with an unfiltered, non-opening HTML report', () => {
    assert.deepEqual(walletReporters(), [
      ['list'],
      ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ]);
  });

  it('honours an explicit output folder and open policy', () => {
    assert.deepEqual(walletReporters({ outputFolder: 'reports/e2e', open: 'on-failure' }), [
      ['list'],
      ['html', { outputFolder: 'reports/e2e', open: 'on-failure' }],
    ]);
  });
});

describe('withWalletReporting', () => {
  it('injects the reporter and all three artifact modes into a bare config', () => {
    const config = withWalletReporting({ testDir: './tests' });
    assert.deepEqual(config.reporter, walletReporters());
    assert.equal(config.use?.video, DEFAULT_ARTIFACT_MODES.video);
    assert.equal(config.use?.screenshot, DEFAULT_ARTIFACT_MODES.screenshot);
    assert.equal(config.use?.trace, DEFAULT_ARTIFACT_MODES.trace);
  });

  it('leaves a caller-supplied reporter completely alone', () => {
    const config = withWalletReporting({ reporter: [['junit']] });
    assert.deepEqual(config.reporter, [['junit']]);
  });

  it('leaves a caller-supplied artifact mode alone while filling in the others', () => {
    const config = withWalletReporting({ use: { video: 'off' } });
    assert.equal(config.use?.video, 'off');
    assert.equal(config.use?.screenshot, DEFAULT_ARTIFACT_MODES.screenshot);
    assert.equal(config.use?.trace, DEFAULT_ARTIFACT_MODES.trace);
  });

  it('preserves every unrelated key and the rest of the use block', () => {
    const config = withWalletReporting({
      testDir: './tests',
      timeout: 120_000,
      workers: 1,
      use: { channel: 'chromium', baseURL: 'http://localhost:5173' },
    });
    assert.equal(config.testDir, './tests');
    assert.equal(config.timeout, 120_000);
    assert.equal(config.workers, 1);
    assert.equal(config.use?.channel, 'chromium');
    assert.equal(config.use?.baseURL, 'http://localhost:5173');
  });

  it('does not mutate the config object it was handed', () => {
    const original = { testDir: './tests', use: { channel: 'chromium' } };
    withWalletReporting(original);
    assert.deepEqual(original, { testDir: './tests', use: { channel: 'chromium' } });
  });
});
