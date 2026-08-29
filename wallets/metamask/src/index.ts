import type { BrowserContext, Page, WalletAccount, WalletDriver } from '@wallets-e2e/core';
import { resolveExtensionId } from '@wallets-e2e/core';
import { wallet } from '../fixtures/wallet.js';
import { getMetaMaskSepoliaRpcUrl } from './sepolia-rpc-proxy.js';

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

/** Sepolia chain ids MetaMask uses in different screens. */
const SEPOLIA_HEX = '0xaa36a7';
const SEPOLIA_CAIP = 'eip155:11155111';
/** Home select-modal list items use HEX (MetaMask converts CAIP → hex). */
const SEPOLIA_MODAL_LIST_ITEM = `[data-testid="network-list-item-${SEPOLIA_HEX}"]`;
/** Networks management page keys options by CAIP. */
const SEPOLIA_OPTIONS_BUTTON = `[data-testid="network-list-item-options-button-${SEPOLIA_CAIP}"], [data-testid="network-list-item-options-button-${SEPOLIA_HEX}"]`;
const SEPOLIA_NETWORKS_LIST_ITEM = `[data-testid="network-list-item-${SEPOLIA_CAIP}"], [data-testid="network-list-item-${SEPOLIA_HEX}"]`;
const SEPOLIA_NETWORK_NAME = 'Sepolia';
const SEPOLIA_POPULAR_ADD = `[data-testid="popular-network-${SEPOLIA_CAIP}"] [data-testid="test-add-button"], [data-testid="popular-network-${SEPOLIA_HEX}"] [data-testid="test-add-button"]`;
const SHOW_TEST_NETWORKS_TOGGLE =
  'label.toggle-button:has([data-testid="networks-page-show-test-networks"])';

/** Short label for MetaMask's RPC dropdown — never Infura. */
function sepoliaRpcLabel(rpcUrl: string): string {
  if (rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')) return 'LocalSepoliaProxy';
  if (rpcUrl.includes('1rpc.io')) return '1RPC';
  if (rpcUrl.includes('0xrpc.io')) return '0xRPC';
  if (rpcUrl.includes('sentio')) return 'Sentio';
  if (rpcUrl.includes('nodies')) return 'Nodies';
  if (rpcUrl.includes('tenderly')) return 'Tenderly';
  if (rpcUrl.includes('publicnode')) return 'PublicNode';
  return 'PublicSepolia';
}

async function waitForFooterNextEnabled(page: Page, label: string, timeoutMs = 30_000): Promise<void> {
  const save = page.locator('[data-testid="page-container-footer-next"]');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(await save.isEnabled().catch(() => false))) {
    await page.waitForTimeout(300);
  }
  if (!(await save.isEnabled().catch(() => false))) {
    throw new Error(`[wallets/metamask] ${label} — save stayed disabled after ${timeoutMs}ms.`);
  }
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

async function closeManageNetworks(page: Page, extensionId?: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await page.locator('[data-testid="parent-selector-home"]').isVisible({ timeout: 500 }).catch(() => false)) {
      return;
    }
    const back = page
      .locator(
        '[data-testid="networks-page-form-back-button"], [data-testid="page-header-back-button"], header button[aria-label="Back"], header button[aria-label="Close"]',
      )
      .first();
    if (await back.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await back.click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }

  if (await page.locator('[data-testid="parent-selector-home"]').isVisible({ timeout: 2_000 }).catch(() => false)) {
    return;
  }

  // Hard fallback — RPC edit screens can leave nested history that one Back can't clear.
  const id = extensionId ?? (await resolveExtensionId(page.context()));
  await page.goto(`chrome-extension://${id}/home.html`);
  await page.locator('[data-testid="parent-selector-home"]').waitFor({ state: 'visible', timeout: 45_000 });
}

async function isOnSepoliaNetwork(page: Page): Promise<boolean> {
  const label = (
    await page.locator('[data-testid="sort-by-networks"]').innerText({ timeout: 5_000 }).catch(() => '')
  ).toLowerCase();
  return label.includes('sepolia');
}

async function isShowTestNetworksEnabled(page: Page): Promise<boolean> {
  const input = page.locator('[data-testid="networks-page-show-test-networks"]');
  if (!(await input.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
  const dataChecked = await input.getAttribute('data-checked');
  if (dataChecked === 'true') return true;
  if (dataChecked === 'false') return false;
  return await input.isChecked().catch(() => false);
}

/** Only turns the toggle on — never off (Sepolia hides when test networks are disabled). */
async function ensureShowTestNetworksEnabled(page: Page): Promise<void> {
  const input = page.locator('[data-testid="networks-page-show-test-networks"]');
  if (!(await input.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error('[wallets/metamask] Show test networks toggle not found on Manage networks page.');
  }
  if (await isShowTestNetworksEnabled(page)) return;
  await page.locator(SHOW_TEST_NETWORKS_TOGGLE).click();
  await page.waitForTimeout(1_000);
  if (!(await isShowTestNetworksEnabled(page))) {
    throw new Error('[wallets/metamask] Failed to enable Show test networks.');
  }
}

async function isSepoliaListedOnNetworksPage(page: Page): Promise<boolean> {
  if (await page.locator(SEPOLIA_NETWORKS_LIST_ITEM).first().isVisible({ timeout: 500 }).catch(() => false)) {
    return true;
  }
  if (await page.locator(`[data-testid="${SEPOLIA_NETWORK_NAME}"]`).first().isVisible({ timeout: 500 }).catch(() => false)) {
    return true;
  }
  return page.getByText(/^Sepolia$/i).first().isVisible({ timeout: 500 }).catch(() => false);
}

async function waitForSepoliaListedOnNetworksPage(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isSepoliaListedOnNetworksPage(page)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function addPopularSepoliaIfOffered(page: Page): Promise<boolean> {
  const addSepolia = page.locator(SEPOLIA_POPULAR_ADD).first();
  if (!(await addSepolia.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await addSepolia.click();
  await page.waitForTimeout(1_500);
  return waitForSepoliaListedOnNetworksPage(page, 10_000);
}

async function addCustomSepoliaNetwork(page: Page, rpcUrl: string): Promise<void> {
  const rpcLabel = sepoliaRpcLabel(rpcUrl);

  await page.locator('[data-testid="networks-page-add-custom-network-button"]').click({ timeout: 10_000 });
  await page.locator('[data-testid="network-form-network-name"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-testid="network-form-network-name"]').fill(SEPOLIA_NETWORK_NAME);

  await page.locator('[data-testid="test-add-rpc-drop-down"]').click({ timeout: 10_000 });
  await page.getByRole('button', { name: /add rpc url/i }).click({ timeout: 10_000 });
  const rpcInput = page.locator('[data-testid="rpc-url-input-test"]');
  await rpcInput.fill(rpcUrl);
  await page.locator('[data-testid="rpc-name-input-test"]').fill(rpcLabel);
  await waitForFooterNextEnabled(page, `Sepolia RPC "${rpcUrl}" was rejected`);
  await page.locator('[data-testid="page-container-footer-next"]').click({ timeout: 10_000 });

  const chainIdInput = page.locator('[data-testid="network-form-chain-id"]');
  const chainIdValue = await chainIdInput.inputValue().catch(() => '');
  if (!chainIdValue || chainIdValue === '0') {
    await chainIdInput.fill('11155111');
  }

  const currencyInput = page.locator('#nativeCurrency, [data-testid="network-form-ticker-input"]').first();
  await currencyInput.fill('ETH');

  await waitForFooterNextEnabled(page, 'Could not save custom Sepolia network');
  await page.locator('[data-testid="page-container-footer-next"]').click({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
}

/**
 * Point Sepolia at a public no-auth RPC and make it the *active* endpoint.
 * MetaMask's bundled Infura URL shows "Unable to connect to Sepolia" /
 * `Infura eth_getCode: Unauthorized` and blocks every send/approve.
 *
 * Matches MetaMask E2E: AddEditNetworkPage.selectRpcUrlAndSave +
 * NetworksPage.openNetworkRPC/selectRPC.
 */
async function configureSepoliaRpc(page: Page, rpcUrl: string): Promise<void> {
  const rpcLabel = sepoliaRpcLabel(rpcUrl);

  const optionsBtn = page.locator(SEPOLIA_OPTIONS_BUTTON).first();
  await optionsBtn.scrollIntoViewIfNeeded().catch(() => {});
  await optionsBtn.waitFor({ state: 'visible', timeout: 20_000 });
  await optionsBtn.click({ timeout: 10_000 });
  await page.locator('[data-testid="network-list-item-options-edit"]').click({ timeout: 10_000 });

  const rpcDropdown = page.locator('[data-testid="test-add-rpc-drop-down"]');
  await rpcDropdown.waitFor({ state: 'visible', timeout: 15_000 });
  await rpcDropdown.click({ timeout: 10_000 });

  const labeledRpc = page.getByRole('button', { name: rpcLabel });
  if (await labeledRpc.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await labeledRpc.click({ timeout: 10_000 });
  } else {
    await page.getByRole('button', { name: /add rpc url/i }).click({ timeout: 10_000 });
    const rpcInput = page.locator('[data-testid="rpc-url-input-test"]');
    const nameInput = page.locator('[data-testid="rpc-name-input-test"]');
    await rpcInput.waitFor({ state: 'visible', timeout: 10_000 });
    // LavaMoat scuttles page.evaluate on extension pages — use Playwright fill only.
    await rpcInput.fill(rpcUrl);
    await nameInput.fill(rpcLabel);
    await nameInput.press('Tab');

    const addUrlBtn = page.getByRole('button', { name: /^add url$/i });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !(await addUrlBtn.isEnabled().catch(() => false))) {
      await page.waitForTimeout(300);
    }
    if (!(await addUrlBtn.isEnabled().catch(() => false))) {
      const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
      throw new Error(`[wallets/metamask] Add URL stayed disabled for ${rpcUrl}. UI:\n${body}`);
    }
    await addUrlBtn.click({ timeout: 10_000 });

    const hidden = await rpcInput
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!hidden) {
      // Retry once — first click sometimes no-ops while chain-id validation is in flight.
      if (await addUrlBtn.isEnabled().catch(() => false)) {
        await addUrlBtn.click({ timeout: 5_000 }).catch(() => {});
        await rpcInput.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      }
    }
    if (await rpcInput.isVisible().catch(() => false)) {
      const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
      throw new Error(
        `[wallets/metamask] Add RPC form did not close after save for ${rpcUrl}. UI:\n${body}`,
      );
    }
  }

  const save = page.locator('[data-testid="page-container-footer-next"]');
  await save.waitFor({ state: 'visible', timeout: 15_000 });
  if (await save.isEnabled().catch(() => true)) {
    await save.click({ timeout: 10_000 });
  }
  await page.waitForTimeout(1_000);

  const formBack = page.locator('[data-testid="networks-page-form-back-button"]');
  if (await formBack.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await formBack.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const rpcNameBtn = page
    .locator(
      `[data-testid="network-rpc-name-button-${SEPOLIA_CAIP}"], [data-testid="network-rpc-name-button-${SEPOLIA_HEX}"]`,
    )
    .first();
  await rpcNameBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await rpcNameBtn.click({ timeout: 10_000 });
  await page.getByText(/select rpc url/i).waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const pick = page.getByRole('button', { name: rpcLabel }).or(page.getByText(rpcLabel, { exact: true }));
  await pick.first().click({ timeout: 15_000 });
  await page.waitForTimeout(800);
}

async function selectSepoliaFromPicker(page: Page): Promise<void> {
  if (await isOnSepoliaNetwork(page)) return;

  await page.locator('[data-testid="sort-by-networks"]').click({ timeout: 15_000 });
  await page.locator('[data-testid="home-network-filter-all-default"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });

  const byHex = page.locator(SEPOLIA_MODAL_LIST_ITEM);
  const byName = page.locator(`[data-testid="${SEPOLIA_NETWORK_NAME}"]`);
  if (await byHex.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await byHex.click({ timeout: 10_000 });
  } else if (await byName.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await byName.click({ timeout: 10_000 });
  } else {
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
    throw new Error(
      `[wallets/metamask] Sepolia not in home network modal (expected ${SEPOLIA_MODAL_LIST_ITEM}). ` +
        `Enable Show test networks first. Modal text: ${body}`,
    );
  }

  await page.locator('[data-testid="sort-by-networks"]').filter({ hasText: /sepolia/i }).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}

/**
 * MetaMask-official Sepolia switch:
 * 1. Manage networks → enable Show test networks (never disable)
 * 2. Ensure Sepolia exists (popular add, else custom with public RPC)
 * 3. Always replace Infura RPC with a probed public no-auth HTTPS endpoint
 * 4. Home network modal → select Sepolia by HEX list item `0xaa36a7`
 */
async function ensureSepoliaNetwork(context: BrowserContext): Promise<void> {
  // Localhost proxy → public Sepolia (MetaMask test build Infura key is 000…0 / Unauthorized;
  // HTTPS public RPCs often fail MetaMask's in-extension "fetch chain ID" check).
  const workingRpc = await getMetaMaskSepoliaRpcUrl();
  const { page, extensionId } = await getUnlockedHomePage(context);

  await openManageNetworks(page);
  await ensureShowTestNetworksEnabled(page);

  if (!(await waitForSepoliaListedOnNetworksPage(page, 5_000))) {
    if (!(await addPopularSepoliaIfOffered(page))) {
      if (!(await waitForSepoliaListedOnNetworksPage(page, 3_000))) {
        await addCustomSepoliaNetwork(page, workingRpc);
      }
    }
  }

  if (!(await waitForSepoliaListedOnNetworksPage(page, 10_000))) {
    throw new Error(
      '[wallets/metamask] Sepolia still missing after Show test networks + popular/custom add.',
    );
  }

  // Popular / built-in Sepolia defaults to Infura (auth prompt). Always set public RPC.
  await configureSepoliaRpc(page, workingRpc);
  await closeManageNetworks(page, extensionId);

  const { page: homePage } = await getUnlockedHomePage(context);
  await selectSepoliaFromPicker(homePage);

  if (!(await isOnSepoliaNetwork(homePage))) {
    throw new Error(
      `[wallets/metamask] switchToTestnetNetwork failed — home still not on Sepolia after select. RPC=${workingRpc}`,
    );
  }

  // Fail fast if MetaMask is still stuck on Infura after our RPC swap.
  const homeText = (await homePage.locator('body').innerText().catch(() => '')).toLowerCase();
  if (homeText.includes('unable to connect') || homeText.includes('infura')) {
    throw new Error(
      `[wallets/metamask] Sepolia label is set but MetaMask cannot reach the chain (still Infura?). ` +
        `Configured RPC=${workingRpc}. Home text snippet: ${homeText.slice(0, 300)}`,
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
  if (await redesignConfirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await redesignConfirm.click();
    return;
  }
  const legacyConfirm = popup.locator('[data-testid="confirmation-submit-button"]');
  if (await legacyConfirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await legacyConfirm.click();
    return;
  }
  const footerNext = popup.locator('[data-testid="page-container-footer-next"]');
  await footerNext.waitFor({ state: 'visible', timeout: 10_000 });
  await footerNext.click();
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
 * Network switch (MetaMask official selectors): Manage networks → enable Show test
 * networks → ensure Sepolia listed → replace Infura RPC with probed public HTTPS RPC →
 * home modal select via HEX list item `network-list-item-0xaa36a7`.
 * only after popular add (Infura default); existing listed Sepolia is used as-is.
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
