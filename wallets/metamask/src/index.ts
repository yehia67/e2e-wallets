import type { BrowserContext, Page, WalletAccount, WalletDriver } from '@wallets-e2e/core';
import {
  resolveExtensionId,
  resolveWorkingSepoliaRpc,
  sepoliaRpcCandidates,
} from '@wallets-e2e/core';
import { wallet } from '../fixtures/wallet.js';

async function openOnboardingPage(context: BrowserContext): Promise<{ page: Page; extensionId: string }> {
  const extensionId = await resolveExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.waitForLoadState('domcontentloaded');
  return { page, extensionId };
}

async function getUnlockedHomePage(context: BrowserContext): Promise<{ page: Page; extensionId: string }> {
  const extensionId = await resolveExtensionId(context);
  let page = context.pages().find(
    (p) =>
      !p.isClosed() &&
      p.url().startsWith(`chrome-extension://${extensionId}/`) &&
      p.url().includes('home.html'),
  );
  if (!page) {
    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/home.html`);
  } else if (!(await page.locator('[data-testid="parent-selector-home"]').isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
  }
  await page.locator('[data-testid="parent-selector-home"]').waitFor({ state: 'visible', timeout: 45_000 });
  return { page, extensionId };
}

async function skipPasskeySetupIfShown(page: Page): Promise<void> {
  const maybeLater = page.locator('[data-testid="passkey-maybe-later-button"]');
  if (await maybeLater.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await maybeLater.click();
    await page.locator('[data-testid="parent-selector-onboarding-metrics"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
}

async function completeMetricsIfShown(page: Page): Promise<void> {
  const metricsPage = page.locator('[data-testid="parent-selector-onboarding-metrics"]');
  if (await metricsPage.isVisible({ timeout: 8_000 }).catch(() => false)) {
    const unchecked = page.locator('[data-testid="metametrics-checkbox"][data-checked="false"]');
    if (!(await unchecked.isVisible({ timeout: 500 }).catch(() => false))) {
      await page.locator('[data-testid="metametrics-checkbox"]').click();
    }
    await page.locator('[data-testid="metametrics-i-agree"]').click();
    await page.locator('[data-testid="parent-selector-onboarding-complete"]').waitFor({ state: 'visible', timeout: 15_000 });
  }
}

async function finishImportOnboarding(page: Page, extensionId: string): Promise<void> {
  await skipPasskeySetupIfShown(page);
  await completeMetricsIfShown(page);

  const downloadContinue = page.locator('[data-testid="download-app-continue"]');
  if (await downloadContinue.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await downloadContinue.click();
  }

  const completePage = page.locator('[data-testid="parent-selector-onboarding-complete"]');
  if (await completePage.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await page.locator('[data-testid="onboarding-complete-done"]').click();
    await page.waitForTimeout(1_000);
  }

  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.locator('[data-testid="parent-selector-home"]').waitFor({ state: 'visible', timeout: 45_000 });

  const shieldSkip = page.locator('[data-testid="shield-entry-modal-close-button"]');
  if (await shieldSkip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await shieldSkip.click();
  }
}

async function fillImportSrp(page: Page, seedPhrase: string): Promise<void> {
  const words = seedPhrase.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 12 && words.length !== 24) {
    throw new Error(
      `[wallets/metamask] importWallet: expected 12 or 24 seed words, got ${words.length}. ` +
        `Ensure WALLETS_E2E_SEED_PHRASE is a single quoted line in wallets/metamask/.env.local.`,
    );
  }

  const note = page.locator('[data-testid="srp-input-import__srp-note"]');
  await note.click();
  await note.fill(words[0]);
  if (words.length > 1) await note.press('Space');

  for (let i = 1; i < words.length; i++) {
    const wordInput = page.locator(`[data-testid="import-srp__srp-word-${i}"]`);
    await wordInput.waitFor({ state: 'visible', timeout: 8_000 });
    await wordInput.fill(words[i]);
    if (i < words.length - 1) await wordInput.press('Space');
  }
}

function assertMetaMaskPopupUrl(popupUrl: string, extensionId: string, method: string): void {
  const prefix = `chrome-extension://${extensionId}/`;
  if (!popupUrl.startsWith(prefix)) {
    throw new Error(
      `[wallets/metamask] ${method}: expected a MetaMask extension popup, got "${popupUrl}" — trigger() likely didn't reach MetaMask's approval popup.`,
    );
  }
  const allowed =
    popupUrl.includes('popup.html') ||
    popupUrl.includes('notification.html') ||
    popupUrl.includes('sidepanel.html') ||
    popupUrl.includes('/connect/') ||
    popupUrl.includes('/confirmation');
  if (!allowed) {
    throw new Error(
      `[wallets/metamask] ${method}: expected popup/notification/connect/confirmation URL, got "${popupUrl}".`,
    );
  }
}

const APPROVAL_SELECTORS = {
  connect: '[data-testid="parent-selector-connect-page"]',
  confirmation:
    '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="page-container-footer-next"]',
  signature: '[data-testid="parent-selector-signature-page"]',
  any: '[data-testid="parent-selector-connect-page"], [data-testid="parent-selector-confirmation-page"], [data-testid="parent-selector-signature-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="confirm-btn"]',
} as const;

async function ensureSidepanelOpen(context: BrowserContext, extensionId: string): Promise<void> {
  let sidepanel = context.pages().find((p) => !p.isClosed() && p.url().includes('sidepanel.html'));
  if (!sidepanel) {
    sidepanel = await context.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await sidepanel.waitForLoadState('domcontentloaded');
  }
}

async function resolveApprovalPage(
  context: BrowserContext,
  extensionId: string,
  popupPromise: Promise<Page>,
  selector: string,
  method: string,
): Promise<Page> {
  try {
    const page = await popupPromise;
    if (page.url().includes(extensionId)) {
      // New popup window — wait briefly for the expected approval UI before accepting it.
      if (await page.locator(selector).first().isVisible({ timeout: 8_000 }).catch(() => false)) {
        return page;
      }
    }
  } catch {
    // MetaMask 13+ often routes approvals through sidepanel instead of a new popup window.
  }

  let sidepanelOpened = false;
  const maxAttempts = 80;
  for (let i = 0; i < maxAttempts; i++) {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      if (!page.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        return page;
      }
    }

    // Re-open / refresh sidepanel periodically — MetaMask may route the approval after the first open.
    if (!sidepanelOpened || i % 10 === 9) {
      await ensureSidepanelOpen(context, extensionId);
      sidepanelOpened = true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const openPages = context
    .pages()
    .filter((p) => !p.isClosed())
    .map((p) => p.url())
    .join('\n  ');
  throw new Error(
    `[wallets/metamask] ${method}: no approval UI appeared after trigger(). ` +
      `Looked for ${selector}. Open pages:\n  ${openPages}`,
  );
}

async function resolveMetaMaskApprovalPage(
  context: BrowserContext,
  extensionId: string,
  popupPromise: Promise<Page>,
): Promise<Page> {
  return resolveApprovalPage(context, extensionId, popupPromise, APPROVAL_SELECTORS.any, 'connectToDapp');
}

async function resolveConfirmationApprovalPage(
  context: BrowserContext,
  extensionId: string,
  popupPromise: Promise<Page>,
): Promise<Page> {
  return resolveApprovalPage(
    context,
    extensionId,
    popupPromise,
    APPROVAL_SELECTORS.confirmation,
    'confirmTransaction',
  );
}

async function resolveSignatureApprovalPage(
  context: BrowserContext,
  extensionId: string,
  popupPromise: Promise<Page>,
): Promise<Page> {
  return resolveApprovalPage(
    context,
    extensionId,
    popupPromise,
    APPROVAL_SELECTORS.signature,
    'confirmSignature',
  );
}

/**
 * Sepolia is a MetaMask built-in (chain 11155111). Never Add custom network —
 * that always hits "Chain ID already exists" and loops forever.
 * Path: Show test networks → edit Sepolia RPC (replace dead Infura) → select Sepolia.
 */
const SEPOLIA_HEX = '0xaa36a7';
const SEPOLIA_CAIP = 'eip155:11155111';
const SEPOLIA_MODAL_ITEM = `[data-testid="network-list-item-${SEPOLIA_HEX}"]`;
const SEPOLIA_OPTIONS =
  `[data-testid="network-list-item-options-button-${SEPOLIA_CAIP}"], [data-testid="network-list-item-options-button-${SEPOLIA_HEX}"]`;
const SEPOLIA_LIST_ITEM =
  `[data-testid="network-list-item-${SEPOLIA_CAIP}"], [data-testid="network-list-item-${SEPOLIA_HEX}"]`;
const SHOW_TEST_NETWORKS_TOGGLE =
  'label.toggle-button:has([data-testid="networks-page-show-test-networks"])';

function rpcNickname(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname.replace(/^www\./, '').slice(0, 28);
  } catch {
    return 'PublicSepolia';
  }
}

async function bodySnippet(page: Page, n = 500): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')).slice(0, n);
}

async function openManageNetworks(page: Page): Promise<void> {
  await page.locator('[data-testid="sort-by-networks"]').click({ timeout: 15_000 });
  await page.locator('[data-testid="home-network-filter-all-default"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.locator('[data-testid="home-network-filter-manage-networks"]').click({ timeout: 15_000 });
  await page.locator('[data-testid="networks-page-add-custom-network-button"]').waitFor({
    state: 'visible',
    timeout: 15_000,
  });
}

async function goHome(page: Page, extensionId: string): Promise<void> {
  if (await page.locator('[data-testid="parent-selector-home"]').isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.locator('[data-testid="parent-selector-home"]').waitFor({ state: 'visible', timeout: 45_000 });
}

async function ensureShowTestNetworksEnabled(page: Page): Promise<void> {
  const input = page.locator('[data-testid="networks-page-show-test-networks"]');
  if (!(await input.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error('[wallets/metamask] Show test networks toggle not found.');
  }
  const on =
    (await input.getAttribute('data-checked')) === 'true' || (await input.isChecked().catch(() => false));
  if (on) return;
  await page.locator(SHOW_TEST_NETWORKS_TOGGLE).click();
  await page.waitForTimeout(800);
}

async function waitForSepoliaListed(page: Page, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      (await page.locator(SEPOLIA_LIST_ITEM).first().isVisible({ timeout: 400 }).catch(() => false)) ||
      (await page.getByText(/^Sepolia$/i).first().isVisible({ timeout: 400 }).catch(() => false))
    ) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(
    `[wallets/metamask] Built-in Sepolia not listed after enabling Show test networks. UI:\n${await bodySnippet(page)}`,
  );
}

/** MetaMask rejects the RPC → false so caller can try the next HTTPS URL. */
async function submitRpcUrlForm(page: Page, rpcUrl: string): Promise<boolean> {
  const nick = rpcNickname(rpcUrl);
  const rpcInput = page.locator('[data-testid="rpc-url-input-test"]');
  const nameInput = page.locator('[data-testid="rpc-name-input-test"]');
  await rpcInput.waitFor({ state: 'visible', timeout: 10_000 });
  await rpcInput.fill('');
  await rpcInput.fill(rpcUrl);
  await nameInput.fill(nick);

  const addBtn = page
    .getByRole('button', { name: /^add url$/i })
    .or(page.locator('[data-testid="page-container-footer-next"]'));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    if (text.includes('could not fetch chain id') || text.includes('invalid rpc url')) {
      return false;
    }
    if (await addBtn.first().isEnabled().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (!(await addBtn.first().isEnabled().catch(() => false))) return false;
  await addBtn.first().click({ timeout: 10_000 });
  const closed = await rpcInput
    .waitFor({ state: 'hidden', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (closed) return true;
  const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  return !(text.includes('could not fetch chain id') || text.includes('invalid rpc'));
}

/**
 * Edit built-in Sepolia → add/select HTTPS RPC in the form → Save.
 * Matches MetaMask E2E `AddEditNetworkPage.selectRpcUrlAndSave`.
 * Never creates a second network with chainId 11155111.
 */
async function setActiveHttpsRpc(page: Page, preferredRpc: string): Promise<string> {
  const options = page.locator(SEPOLIA_OPTIONS).first();
  await options.scrollIntoViewIfNeeded().catch(() => {});
  await options.waitFor({ state: 'visible', timeout: 15_000 });
  await options.click({ timeout: 10_000 });
  await page.locator('[data-testid="network-list-item-options-edit"]').click({ timeout: 10_000 });

  await page.locator('[data-testid="test-add-rpc-drop-down"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('[data-testid="test-add-rpc-drop-down"]').click({ timeout: 10_000 });

  // At most 3 URLs — do not thrash the form.
  const candidates = [
    preferredRpc,
    ...sepoliaRpcCandidates().filter((u) => u !== preferredRpc),
  ].slice(0, 3);
  let active = preferredRpc;
  const already = page.getByRole('button', { name: rpcNickname(preferredRpc) });
  if (await already.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await already.click({ timeout: 10_000 });
  } else {
    await page.getByRole('button', { name: /add rpc url/i }).click({ timeout: 10_000 });
    let accepted: string | undefined;
    const rejected: string[] = [];
    for (const url of candidates) {
      if (await submitRpcUrlForm(page, url)) {
        accepted = url;
        break;
      }
      rejected.push(url);
      await page.locator('[data-testid="rpc-url-input-test"]').fill('').catch(() => {});
    }
    if (!accepted) {
      throw new Error(
        `[wallets/metamask] Edit Sepolia RPC failed (tried ${rejected.join(', ')}). UI:\n${await bodySnippet(page)}`,
      );
    }
    active = accepted;
    // After Add URL, re-open dropdown and pick the nick so it is the form's selected RPC.
    const nick = rpcNickname(active);
    const dropdown = page.locator('[data-testid="test-add-rpc-drop-down"]');
    if (await dropdown.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dropdown.click({ timeout: 5_000 }).catch(() => {});
      const pick = page.getByRole('button', { name: nick });
      if (await pick.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await pick.click({ timeout: 5_000 });
      }
    }
  }

  const save = page.locator('[data-testid="page-container-footer-next"]');
  await save.waitFor({ state: 'visible', timeout: 15_000 });
  if (!(await save.isEnabled().catch(() => false))) {
    throw new Error(
      `[wallets/metamask] Sepolia edit Save stayed disabled after setting RPC=${active}. UI:\n${await bodySnippet(page)}`,
    );
  }
  await save.click({ timeout: 10_000 });
  // Wait until edit form is gone (back on Manage networks list).
  await page
    .locator('[data-testid="networks-page-add-custom-network-button"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(async () => {
      await page.locator('[data-testid="networks-page-form-back-button"]').click({ timeout: 5_000 }).catch(() => {});
    });
  await page.waitForTimeout(500);
  return active;
}

/** Open home network picker → click built-in Sepolia. */
async function switchNetwork(page: Page): Promise<void> {
  const label = (await page.locator('[data-testid="sort-by-networks"]').innerText().catch(() => '')).toLowerCase();
  if (label.includes('sepolia')) return;

  await page.locator('[data-testid="sort-by-networks"]').click({ timeout: 15_000 });
  await page.locator('[data-testid="home-network-filter-all-default"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });

  const item = page.locator(SEPOLIA_MODAL_ITEM);
  if (!(await item.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error(
      `[wallets/metamask] Sepolia missing from picker (enable Show test networks first). UI:\n${await bodySnippet(page)}`,
    );
  }
  await item.click({ timeout: 10_000 });
  await page.locator('[data-testid="sort-by-networks"]').filter({ hasText: /sepolia/i }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}

/**
 * Leather-shaped: enable preset → point at working RPC → select it.
 * Never Add custom network for Sepolia (chain already exists).
 */
async function ensureSepoliaNetwork(context: BrowserContext): Promise<void> {
  const preferredRpc = await resolveWorkingSepoliaRpc();
  const { page, extensionId } = await getUnlockedHomePage(context);

  await openManageNetworks(page);
  await ensureShowTestNetworksEnabled(page);
  await waitForSepoliaListed(page);

  const activeRpc = await setActiveHttpsRpc(page, preferredRpc);
  await goHome(page, extensionId);

  const { page: home } = await getUnlockedHomePage(context);
  await switchNetwork(home);

  const homeText = (await home.locator('body').innerText().catch(() => '')).toLowerCase();
  const onSepolia = (
    await home.locator('[data-testid="sort-by-networks"]').innerText().catch(() => '')
  )
    .toLowerCase()
    .includes('sepolia');
  if (!onSepolia) {
    throw new Error(`[wallets/metamask] Not on Sepolia after switch. RPC=${activeRpc}`);
  }
  if (homeText.includes('unable to connect') || homeText.includes('infura')) {
    throw new Error(
      `[wallets/metamask] Sepolia selected but RPC unreachable. RPC=${activeRpc}. Home: ${homeText.slice(0, 280)}`,
    );
  }
}

async function clickSignatureConfirm(popup: Page): Promise<void> {
  const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
  if (await nextNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nextNav.click();
    await popup.waitForTimeout(300);
  }
  await clickTransactionConfirm(popup);
}

async function clickConnectApprove(popup: Page): Promise<void> {
  const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
    return;
  }
  const footerNext = popup.locator('[data-testid="page-container-footer-next"]');
  await footerNext.waitFor({ state: 'visible', timeout: 10_000 });
  await footerNext.click();
}

async function clickTransactionConfirm(popup: Page): Promise<void> {
  const redesignConfirm = popup.locator('[data-testid="confirm-footer-button"]');
  const legacyConfirm = popup.locator('[data-testid="confirmation-submit-button"]');
  const footerNext = popup.locator('[data-testid="page-container-footer-next"]');
  const confirm = redesignConfirm.or(legacyConfirm).or(footerNext).first();

  await confirm.waitFor({ state: 'visible', timeout: 30_000 });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click({ timeout: 10_000 });
      return;
    }
    const text = (await popup.locator('body').innerText().catch(() => '')).toLowerCase();
    if (
      text.includes('unable to connect') ||
      text.includes('unauthorized') ||
      text.includes('infura') ||
      text.includes('transaction failed') ||
      text.includes('alert')
    ) {
      throw new Error(
        `[wallets/metamask] confirmTransaction blocked (likely bad RPC). UI:\n${text.slice(0, 400)}`,
      );
    }
    await popup.waitForTimeout(400);
  }
  throw new Error(
    `[wallets/metamask] Confirm stayed disabled (gas/RPC). UI:\n${(await popup.locator('body').innerText().catch(() => '')).slice(0, 400)}`,
  );
}

async function verifyUnlockedAddress(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  expectedAddress: string,
): Promise<void> {
  if (!(await page.locator('[data-testid="parent-selector-home"]').isVisible().catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
    await page.locator('[data-testid="parent-selector-home"]').waitFor({ state: 'visible', timeout: 30_000 });
  }

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

  try {
    const storage = (await worker.evaluate(() => chrome.storage.local.get(null))) as Record<string, unknown>;
    if (JSON.stringify(storage).toLowerCase().includes(expectedAddress.toLowerCase())) return;
  } catch {
    // LavaMoat scuttling on test builds — fall back to dashboard UI text.
  }

  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  const normalized = expectedAddress.toLowerCase();
  if (bodyText.includes(normalized)) return;

  // MetaMask home shows a truncated address like `0x51BB6...1f457` (not a fixed 6+4 pattern).
  const prefix = normalized.slice(0, 7);
  const suffix = normalized.slice(-5);
  if (bodyText.includes(prefix) && bodyText.includes(suffix)) return;

  throw new Error(
    `[wallets/metamask] Unlocked, but expected address ${expectedAddress} was not found in MetaMask UI or storage — import likely failed silently.`,
  );
}

/**
 * WalletDriver adapter for the real MetaMask extension (test build). Selectors below were verified
 * against MetaMask's own E2E page objects (metamask/metamask-extension test/e2e/page-objects)
 * — not guessed at:
 *
 * Onboarding (import SRP path):
 *   - Welcome: `onboarding-import-wallet` → `onboarding-import-with-srp-button`
 *   - SRP: paste into `srp-input-import__srp-note`, confirm via `import-srp-confirm`
 *   - Password: `create-password-new-input`, `create-password-confirm-input`, `create-password-terms`, `create-password-submit`
 *   - Passkey skip: `passkey-maybe-later-button`
 *   - Metrics: `metametrics-i-agree` (opt out of checkbox first)
 *   - Complete: `onboarding-complete-done`
 *
 * Connect popup: `confirm-btn` (redesigned multichain connect) or fallback `page-container-footer-next`
 * Transaction popup: `confirm-footer-button` or fallback `confirmation-submit-button` / `page-container-footer-next`
 *
 * Network switch: Show test networks → edit built-in Sepolia RPC (HTTPS) →
 * home picker `network-list-item-0xaa36a7`. Never Add custom network (chain exists).
 */
export const metamaskDriver: WalletDriver = {
  async importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
    const trimmed = seedPhrase.trim();
    if (!trimmed) {
      throw new Error('[wallets/metamask] importWallet: seed phrase is empty — refusing to hang on a disabled confirm button.');
    }

    const { page, extensionId } = await openOnboardingPage(context);

    await page.locator('[data-testid="onboarding-import-wallet"]').click({ timeout: 15_000 });
    await page.locator('[data-testid="onboarding-import-with-srp-button"]').click();

    // SRP entry — paste full phrase (MetaMask E2E default path)
    await page.locator('[data-testid="parent-selector-onboarding-srp"]').waitFor({ state: 'visible', timeout: 10_000 });
    await fillImportSrp(page, trimmed);
    const confirmSrp = page.locator('[data-testid="import-srp-confirm"]');
    // LavaMoat scuttles globalThis in extension pages — never use page.waitForFunction here.
    await confirmSrp.waitFor({ state: 'visible', timeout: 8_000 });
    const confirmDeadline = Date.now() + 15_000;
    while (Date.now() < confirmDeadline && !(await confirmSrp.isEnabled())) {
      await page.waitForTimeout(200);
    }
    if (!(await confirmSrp.isEnabled())) {
      throw new Error('[wallets/metamask] importWallet: SRP confirm stayed disabled — seed phrase may be invalid or incomplete.');
    }
    await confirmSrp.click();

    // Create password
    await page.locator('[data-testid="parent-selector-onboarding-password"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('[data-testid="create-password-new-input"]').fill(wallet.password);
    await page.locator('[data-testid="create-password-confirm-input"]').fill(wallet.password);
    await page.locator('[data-testid="create-password-terms"]').click();
    const submitPwd = page.locator('[data-testid="create-password-submit"]');
    const pwdDeadline = Date.now() + 10_000;
    while (Date.now() < pwdDeadline && !(await submitPwd.isEnabled())) {
      await page.waitForTimeout(200);
    }
    await submitPwd.click();

    await page.locator('[data-testid="parent-selector-setup-passkey"], [data-testid="parent-selector-onboarding-metrics"]').first().waitFor({
      state: 'visible',
      timeout: 20_000,
    });

    await finishImportOnboarding(page, extensionId);
    await verifyUnlockedAddress(context, page, extensionId, wallet.address);

    return { address: wallet.address };
  },

  async switchToTestnetNetwork(context: BrowserContext): Promise<void> {
    await ensureSepoliaNetwork(context);
  },

  async connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    await ensureSidepanelOpen(context, extensionId);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();
    const popup = await resolveMetaMaskApprovalPage(context, extensionId, popupPromise);

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'connectToDapp');
    await popup.waitForLoadState('domcontentloaded');

    await clickConnectApprove(popup);
    await popup.waitForEvent('close', { timeout: 15_000 }).catch(() => {});
  },

  async confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    await ensureSidepanelOpen(context, extensionId);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();
    // Use broad selectors — MetaMask may show confirmation, connect-style approve, or alert stack.
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      popupPromise,
      APPROVAL_SELECTORS.any,
      'confirmTransaction',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmTransaction');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(
        '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="confirm-btn"]',
      )
      .first()
      .waitFor({
        state: 'visible',
        timeout: 30_000,
      });

    for (let i = 0; i < 3; i++) {
      const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
      if (await nextNav.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await nextNav.click();
        await popup.waitForTimeout(300);
        continue;
      }
      break;
    }

    await clickTransactionConfirm(popup);
    const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
  },

  async confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    await ensureSidepanelOpen(context, extensionId);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();
    // MetaMask 13 may mount signature UI without parent-selector-signature-page (URL ends in /signature-request).
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      popupPromise,
      `${APPROVAL_SELECTORS.signature}, ${APPROVAL_SELECTORS.any}, [data-testid="signature-request"], [data-testid="confirm-footer-button"]`,
      'confirmSignature',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmSignature');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(
        '[data-testid="parent-selector-signature-page"], [data-testid="confirm-footer-button"], [data-testid="signature-request"], [data-testid="request-signature-confirm"], [data-testid="page-container-footer-next"]',
      )
      .first()
      .waitFor({
        state: 'visible',
        timeout: 30_000,
      });

    await clickSignatureConfirm(popup);
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
  },
};
