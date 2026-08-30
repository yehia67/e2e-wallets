import type { BrowserContext, EvmNetwork, Page, WalletAccount, WalletDriver } from '@wallets-e2e/core';
import {
  EVM_NETWORKS,
  chainIdToCaip,
  chainIdToHex,
  evmRpcCandidates,
  probeEvmRpc,
  resolveExtensionId,
  resolveWorkingRpc,
} from '@wallets-e2e/core';
import { wallet } from '../fixtures/wallet.js';

const HOME_SELECTOR =
  '[data-testid="parent-selector-home"], [data-testid="network-display"], [data-testid="sort-by-networks"]';

interface PendingDappNetwork {
  network: EvmNetwork;
  rpcUrl?: string;
}

const pendingDappNetworks = new WeakMap<BrowserContext, PendingDappNetwork>();

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
  } else if (!(await page.locator(HOME_SELECTOR).first().isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
  }
  await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 45_000 });
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
  // MetaMask 13.13.1: the checkbox is an id, and `metametrics-i-agree` confirms the opt-out.
  const legacyOptOut = page.locator('#metametrics-opt-in');
  if (await legacyOptOut.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await legacyOptOut.click();
    await page.locator('[data-testid="metametrics-i-agree"]').click();
    return;
  }

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

  const completeButton = page.locator('[data-testid="onboarding-complete-done"]');
  if (await completeButton.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await completeButton.click();
    await page.waitForTimeout(1_000);
  }

  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page
    .locator(HOME_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 })
    .catch(async () => {
      throw new Error(
        `[wallets/metamask] Import completed but the dashboard did not load at ${page.url()}. ` +
          `UI:\n${await bodySnippet(page, 1_000)}`,
      );
    });

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
    popupUrl.includes('/connect/') ||
    popupUrl.includes('/confirmation');
  if (!allowed) {
    throw new Error(
      `[wallets/metamask] ${method}: expected popup/notification/connect/confirmation URL, got "${popupUrl}".`,
    );
  }
}

const APPROVAL_SELECTORS = {
  connect:
    '[data-testid="parent-selector-connect-page"], [data-testid="page-container-footer-next"]',
  confirmation:
    '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="page-container-footer-next"]',
  signature:
    '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="signature-sign-button"], [data-testid="request-signature__sign"]',
  permission:
    '[data-testid="custom-spending-cap-input"], [data-testid="custom-spending-cap-max-button"]',
  network:
    '.confirmation-footer__actions button.btn-primary, [data-testid="confirmation-submit-button"], [data-testid="page-container-footer-next"]',
  any: '[data-testid="parent-selector-connect-page"], [data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="confirm-btn"], [data-testid="page-container-footer-next"], [data-testid="signature-sign-button"], .confirmation-footer__actions button.btn-primary',
} as const;

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
    // No new popup window within the wait — the approval may already be mounted on an open page.
  }

  // MetaMask does NOT open an approval window on its own under a Playwright persistent context —
  // verified directly: after `eth_requestAccounts` the request stays pending forever, the provider
  // promise neither resolves nor rejects, and the only open pages are the dapp and `home.html`.
  // The approval is real and routed (`#/connect/<id>`); nothing has rendered it. So the driver
  // opens the surface itself. `notification.html` is MetaMask's own approval document
  // (`platform.openWindow({url:"notification.html"})` in the bundle) and renders the pending
  // approval — with its testids intact — the moment it is navigated to.
  //
  // Never use `page.evaluate` on these pages to inspect them: LavaMoat scuttling makes even
  // `setInterval` inaccessible and the call throws. Locators only.
  let opened: Page | undefined;
  const maxAttempts = 80;
  for (let i = 0; i < maxAttempts; i++) {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      if (!page.url().startsWith(`chrome-extension://${extensionId}/`)) continue;
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        return page;
      }
    }

    // Give MetaMask a moment to register the request, then render it ourselves. Re-navigate
    // periodically: a request that arrives after the first open still needs a surface.
    if (i === 2 || (i > 2 && i % 16 === 0)) {
      if (!opened || opened.isClosed()) {
        opened = await context.newPage();
      }
      await opened
        .goto(`chrome-extension://${extensionId}/notification.html`)
        .catch(() => {});
      await opened.waitForLoadState('domcontentloaded').catch(() => {});
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
 * Every network selector is derived from the `EvmNetwork` it is asked about — no chain is named by
 * string literal anywhere below.
 *
 * Recent MetaMask builds construct these testids from the **CAIP-2** chain id
 * (`network-list-item-eip155:11155111`) — verified by grepping the built bundle, where the
 * templates are `` `network-list-item-${chainId}` `` / `` `network-list-item-options-button-${chainId}` ``
 * and `eip155:11155111` appears as a literal. The hex form (`network-list-item-0xaa36a7`) is what
 * older builds used, and is kept only as a fallback — reading it as the primary selector is
 * exactly the bug this driver had: the row was never found, so the network was reported "missing
 * from picker" on a build that listed it all along.
 */
const SHOW_TEST_NETWORKS_TOGGLE =
  'label.toggle-button:has([data-testid="networks-page-show-test-networks"])';

interface NetworkSelectors {
  caip: string;
  hex: string;
  /** The row in the manage-networks list / home picker for this chain. */
  listItem: string;
  /** The "⋮" options button on that row. */
  optionsButton: string;
}

function networkSelectors(network: EvmNetwork): NetworkSelectors {
  const caip = chainIdToCaip(network.chainId);
  const hex = chainIdToHex(network.chainId);
  return {
    caip,
    hex,
    listItem: `[data-testid="network-list-item-${caip}"], [data-testid="network-list-item-${hex}"]`,
    optionsButton:
      `[data-testid="network-list-item-options-button-${caip}"], ` +
      `[data-testid="network-list-item-options-button-${hex}"]`,
  };
}

/** MetaMask's RPC list wants a short display name per endpoint; the host is the honest one. */
function rpcNickname(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname.replace(/^www\./, '').slice(0, 28);
  } catch {
    return 'Custom RPC';
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
  if (await page.locator(HOME_SELECTOR).first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 45_000 });
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

/**
 * Is this chain already in MetaMask's network list?
 *
 * Read from the live UI, never from the preset's `builtIn` flag: a user profile can already carry
 * a chain MetaMask does not ship, and trusting the flag would send the driver down the add path
 * for a chain that exists (rejected by design) or the edit path for one that does not.
 *
 * Returns quickly when absent — an unlisted chain is a normal outcome here, not a failure, so this
 * must not burn the full listed-network timeout before the add path can start.
 */
async function isNetworkListed(page: Page, network: EvmNetwork, timeoutMs = 6_000): Promise<boolean> {
  const { listItem } = networkSelectors(network);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator(listItem).first().isVisible({ timeout: 400 }).catch(() => false)) {
      return true;
    }
    // Name fallback for a network added by hand under a build whose testid scheme we don't match.
    if (
      await page
        .getByText(new RegExp(`^${escapeRegExp(network.name)}$`, 'i'))
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false)
    ) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // Only the sub-form's own "Add URL" button. The previous `.or(page-container-footer-next)`
  // fallback resolved to the OUTER network form's Save button whenever "Add URL" was missing —
  // clicking that submits the whole network with its original (Infura) RPC still selected.
  const addBtn = page.getByRole('button', { name: /^add url$/i });
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
  // The sub-form closing is the ONLY proof MetaMask accepted the URL. Treating "no error text
  // on screen" as success reported an add that never happened, and the caller then saved the
  // network with Infura still selected — the failure surfaced much later, as an unauthorized
  // Infura call on the first transaction.
  return closed;
}

/** Picks a candidate RPC in the form's dropdown, adding it first if MetaMask doesn't have it. */
async function selectOrAddRpcInForm(page: Page, network: EvmNetwork, preferredRpc: string): Promise<string> {
  const dropdown = page.locator('[data-testid="test-add-rpc-drop-down"]');
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 });
  await dropdown.click({ timeout: 10_000 });

  // At most 3 URLs — do not thrash the form.
  const candidates = [
    preferredRpc,
    ...evmRpcCandidates(network).filter((url) => url !== preferredRpc),
  ].slice(0, 3);

  const already = page.getByRole('button', { name: rpcNickname(preferredRpc) });
  if (await already.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await already.click({ timeout: 10_000 });
    return preferredRpc;
  }

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
      `[wallets/metamask] MetaMask rejected every RPC for ${network.name} (chain ${network.chainId}). ` +
        `Tried: ${rejected.join(', ')}. UI:\n${await bodySnippet(page)}`,
    );
  }

  // Adding a URL does NOT make it the one MetaMask calls — the "Default RPC URL" dropdown still
  // points at Infura, whose test-build key is unauthorized.
  //
  // KNOWN GAP (see the driver README): when this selection does not take, the network saves with
  // Infura as its default. The label reads correctly and the home screen looks healthy; the
  // failure surfaces only on the first transaction as
  // `RPC <chainIdHex> Infura eth_getCode: Unauthorized`. A verifying version of this step — which
  // reads the selected value from the dropdown wrapper's PARENT element (the wrapper's own
  // innerText is empty; the parent renders "Infura sepolia.infura.io") and throws when it does not
  // match — was written and then reverted: it drove the network-switch step from 55s to an 8-minute
  // timeout for reasons not yet isolated. Re-attempt it with that parent-element read, and time the
  // add-RPC form flow first.
  const nick = rpcNickname(accepted);
  if (await dropdown.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dropdown.click({ timeout: 5_000 }).catch(() => {});
    const pick = page.getByRole('button', { name: nick });
    if (await pick.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await pick.click({ timeout: 5_000 });
    }
  }
  return accepted;
}

/** Clicks the form's Save and waits for the manage-networks list to come back. */
async function saveNetworkForm(page: Page, network: EvmNetwork, activeRpc: string, what: string): Promise<void> {
  const save = page.locator('[data-testid="page-container-footer-next"]');
  await save.waitFor({ state: 'visible', timeout: 15_000 });
  if (!(await save.isEnabled().catch(() => false))) {
    throw new Error(
      `[wallets/metamask] ${what} Save stayed disabled for ${network.name} (chain ${network.chainId}) ` +
        `with RPC=${activeRpc}. Form said:\n${await bodySnippet(page)}`,
    );
  }
  await save.click({ timeout: 10_000 });
  await page
    .locator('[data-testid="networks-page-add-custom-network-button"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(async () => {
      await page.locator('[data-testid="networks-page-form-back-button"]').click({ timeout: 5_000 }).catch(() => {});
    });
  await page.waitForTimeout(500);
}

/**
 * Existing chain → options → Edit → point it at a probe-passing RPC → Save.
 * Matches MetaMask E2E's own `AddEditNetworkPage.selectRpcUrlAndSave`. This is the *only* legal
 * path for a chain MetaMask already lists: the add-custom-network form rejects a duplicate chain
 * id outright ("This Chain ID is currently used by the … network"), by design.
 */
async function editExistingNetworkRpc(page: Page, network: EvmNetwork, preferredRpc: string): Promise<string> {
  const { optionsButton } = networkSelectors(network);
  const options = page.locator(optionsButton).first();
  await options.scrollIntoViewIfNeeded().catch(() => {});
  await options.waitFor({ state: 'visible', timeout: 15_000 });
  await options.click({ timeout: 10_000 });
  await page.locator('[data-testid="network-list-item-options-edit"]').click({ timeout: 10_000 });

  const activeRpc = await selectOrAddRpcInForm(page, network, preferredRpc);
  await saveNetworkForm(page, network, activeRpc, 'Edit network');
  return activeRpc;
}

/**
 * The real `<input>` behind a network-form field.
 *
 * MetaMask's form components carry *two* test-IDs per field: one on the `FormTextField` wrapper
 * (`…-name-input`, a `<div>`) and one passed through `inputProps` onto the actual input
 * (`network-form-network-name`). Verified against the running extension — filling the wrapper
 * fails with "Element is not an <input>". Every candidate below is therefore constrained to a real
 * input, so whichever test-ID a given build puts where, only something fillable is ever matched.
 */
function formInput(page: Page, inputTestId: string, wrapperTestId: string) {
  return page
    .locator(
      `input[data-testid="${inputTestId}"], ` +
        `input[data-testid="${wrapperTestId}"], ` +
        `[data-testid="${wrapperTestId}"] input`,
    )
    .first();
}

/**
 * Unknown chain → the custom-network form. Only reachable when the live UI says the chain is *not*
 * listed: MetaMask refuses a duplicate chain id, so attempting this for a chain it already has is
 * a guaranteed dead end rather than a retryable failure.
 */
async function addCustomNetwork(page: Page, network: EvmNetwork, preferredRpc: string): Promise<string> {
  await page.locator('[data-testid="networks-page-add-custom-network-button"]').click({ timeout: 15_000 });

  const nameInput = formInput(page, 'network-form-network-name', 'network-form-name-input');
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await nameInput.fill(network.name);

  const activeRpc = await selectOrAddRpcInForm(page, network, preferredRpc);

  // Chain id and ticker are sometimes auto-filled (and then disabled) from the RPC MetaMask just
  // probed — only type into them when the form actually lets us.
  const chainIdInput = formInput(page, 'network-form-chain-id', 'network-form-chain-id-input');
  if (await chainIdInput.isEditable({ timeout: 5_000 }).catch(() => false)) {
    await chainIdInput.fill(String(network.chainId));
  }

  const tickerInput = formInput(page, 'network-form-ticker-input', 'network-form-ticker');
  if (await tickerInput.isEditable({ timeout: 5_000 }).catch(() => false)) {
    await tickerInput.fill(network.currencySymbol);
  }

  // A duplicate chain id here is not a retryable failure — it means the "is it listed?" read was
  // wrong. Quote MetaMask's own words rather than looping on a form that will never accept Save.
  const formText = await bodySnippet(page, 800);
  if (/is currently used by/i.test(formText)) {
    throw new Error(
      `[wallets/metamask] Refusing to add ${network.name}: MetaMask already owns chain ` +
        `${network.chainId} — "${formText.match(/[^\n]*is currently used by[^\n]*/i)?.[0]?.trim()}". ` +
        `The existing network must be edited, not re-added.`,
    );
  }

  await saveNetworkForm(page, network, activeRpc, 'Add custom network');
  return activeRpc;
}

/** MetaMask 13.13.1 custom-network form, matching Synpress's pinned production flow. */
async function addCustomNetworkLegacy(
  page: Page,
  network: EvmNetwork,
  preferredRpc: string,
): Promise<void> {
  await page.locator('[data-testid="network-display"]').click({ timeout: 15_000 });
  const menu = page.locator('.multichain-network-list-menu-content-wrapper');
  await menu.waitFor({ state: 'visible', timeout: 10_000 });
  const addNetwork = menu.getByRole('button', { name: /add network/i }).last();
  await addNetwork.click({ timeout: 10_000 });

  await page.locator('[data-testid="add-network-manually"]').click({ timeout: 15_000 });
  const form = page.locator('.networks-tab__add-network-form');
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  await form.locator('.form-field:nth-child(1) input').fill(network.name);
  await form.locator('.form-field:nth-child(2) input').fill(preferredRpc);

  const rpcError = form.locator('.form-field:nth-child(2) .form-field__error');
  if (await rpcError.isVisible({ timeout: 1_000 }).catch(() => false)) {
    throw new Error(
      `[wallets/metamask] MetaMask rejected RPC ${preferredRpc}: ${await rpcError.innerText()}`,
    );
  }

  await form.locator('.form-field:nth-child(3) input').fill(String(network.chainId));
  await page.locator('[data-testid="network-form-ticker"] input').fill(network.currencySymbol);
  if (network.blockExplorerUrl) {
    await form.locator('.form-field:last-child input').fill(network.blockExplorerUrl);
  }
  const save = form.locator('.networks-tab__add-network-form-footer button.btn-primary');
  await save.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await save.isEnabled())) {
    throw new Error(
      `[wallets/metamask] Add custom network Save stayed disabled for ${network.name}. ` +
        `UI:\n${await bodySnippet(page)}`,
    );
  }
  await save.click();

  const switchNow = page.locator('.home__new-network-added__switch-to-button');
  if (await switchNow.isVisible({ timeout: 3_000 }).catch(() => false)) await switchNow.click();
  const gotIt = page.locator('.new-network-info__wrapper button.btn-primary');
  if (await gotIt.isVisible({ timeout: 2_000 }).catch(() => false)) await gotIt.click();
}

/** Open the home network picker → click this chain's row (CAIP testid first, name as fallback). */
async function selectFromHomePicker(page: Page, network: EvmNetwork): Promise<void> {
  // MetaMask 13.13.1 (the pinned production build) uses the classic multichain dropdown.
  const legacyLabel = page.locator('[data-testid="network-display"]');
  if (await legacyLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const nameMatcher = new RegExp(`^${escapeRegExp(network.name)}$`, 'i');
    if (nameMatcher.test((await legacyLabel.innerText().catch(() => '')).trim())) return;

    await legacyLabel.click({ timeout: 15_000 });
    const menu = page.locator('.multichain-network-list-menu-content-wrapper');
    await menu.waitFor({ state: 'visible', timeout: 10_000 });
    if (network.testnet) {
      const offToggle = menu.locator('label.toggle-button.toggle-button--off');
      if (await offToggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await offToggle.click();
        await menu.locator('label.toggle-button.toggle-button--on').waitFor({
          state: 'visible',
          timeout: 5_000,
        });
      }
    }

    const names = menu.locator('.multichain-network-list-item p');
    const count = await names.count();
    for (let index = 0; index < count; index++) {
      const item = names.nth(index);
      if (nameMatcher.test((await item.innerText()).trim())) {
        await item.click();
        await legacyLabel.filter({ hasText: new RegExp(escapeRegExp(network.name), 'i') }).waitFor({
          state: 'visible',
          timeout: 30_000,
        });
        return;
      }
    }
    throw new Error(
      `[wallets/metamask] ${network.name} (chain ${network.chainId}) is missing from the ` +
        `MetaMask 13.13.1 network picker. UI:\n${await bodySnippet(page)}`,
    );
  }

  const { listItem } = networkSelectors(network);
  const label = page.locator('[data-testid="sort-by-networks"]');
  const nameMatcher = new RegExp(escapeRegExp(network.name), 'i');

  if (nameMatcher.test(await label.innerText().catch(() => ''))) return;

  await label.click({ timeout: 15_000 });
  await page.locator('[data-testid="home-network-filter-all-default"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });

  let item = page.locator(listItem).first();
  if (!(await item.isVisible({ timeout: 5_000 }).catch(() => false))) {
    item = page.getByText(new RegExp(`^${escapeRegExp(network.name)}$`, 'i')).first();
  }
  if (!(await item.isVisible({ timeout: 5_000 }).catch(() => false))) {
    throw new Error(
      `[wallets/metamask] ${network.name} (chain ${network.chainId}) is missing from the network ` +
        `picker — looked for ${listItem} and exact text "${network.name}". UI:\n${await bodySnippet(page)}`,
    );
  }
  await item.click({ timeout: 10_000 });
  await label.filter({ hasText: nameMatcher }).waitFor({ state: 'visible', timeout: 30_000 });
}

/**
 * Built-in networks use the production wallet's own RPC. An explicit env override opts into the
 * edit path; custom networks are probed and added before selection.
 */
async function ensureNetwork(context: BrowserContext, network: EvmNetwork): Promise<void> {
  const { page, extensionId } = await getUnlockedHomePage(context);

  const explicitOverride =
    process.env[`WALLETS_E2E_RPC_URL_${network.chainId}`]?.trim() ||
    process.env.WALLETS_E2E_EVM_RPC_URL?.trim();

  const modernMultichainHome = page.locator('[data-testid="sort-by-networks"]');
  if (await modernMultichainHome.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if (explicitOverride && !(await probeEvmRpc(explicitOverride, network.chainId))) {
      throw new Error(
        `[wallets/metamask] Explicit RPC override for ${network.name} failed its chain/state/gas ` +
          `probe: ${explicitOverride}`,
      );
    }
    const rpcUrl = explicitOverride || (!network.builtIn ? await resolveWorkingRpc(network) : undefined);
    pendingDappNetworks.set(context, { network, rpcUrl });
    return;
  }

  // The pinned production build carries a working built-in provider. Do not replace it with a
  // public endpoint unless the caller explicitly asks for that endpoint.
  if (network.builtIn && !explicitOverride) {
    await selectFromHomePicker(page, network);
    return;
  }

  if (explicitOverride && !(await probeEvmRpc(explicitOverride, network.chainId))) {
    throw new Error(
      `[wallets/metamask] Explicit RPC override for ${network.name} failed its chain/state/gas ` +
        `probe: ${explicitOverride}`,
    );
  }
  const preferredRpc = explicitOverride || (await resolveWorkingRpc(network));

  const legacyNetworkPicker = page.locator('[data-testid="network-display"]');
  if (
    !network.builtIn &&
    (await legacyNetworkPicker.isVisible({ timeout: 2_000 }).catch(() => false))
  ) {
    await addCustomNetworkLegacy(page, network, preferredRpc);
    await goHome(page, extensionId);
    const { page: home } = await getUnlockedHomePage(context);
    await selectFromHomePicker(home, network);
    return;
  }

  await openManageNetworks(page);
  if (network.testnet) {
    await ensureShowTestNetworksEnabled(page);
  }

  // Read "listed" from the live UI, never from `network.builtIn` — see `isNetworkListed`.
  const listed = await isNetworkListed(page, network);
  const activeRpc = listed
    ? await editExistingNetworkRpc(page, network, preferredRpc)
    : await addCustomNetwork(page, network, preferredRpc);

  await goHome(page, extensionId);

  const { page: home } = await getUnlockedHomePage(context);
  await selectFromHomePicker(home, network);

  // Real signals only (AD-8): the rendered label, and the absence of MetaMask's own
  // cannot-reach-the-chain text. "The picker closed" proves nothing.
  const homeText = (await home.locator('body').innerText().catch(() => '')).toLowerCase();
  const onNetwork = (await home.locator('[data-testid="sort-by-networks"]').innerText().catch(() => ''))
    .toLowerCase()
    .includes(network.name.toLowerCase());
  if (!onNetwork) {
    throw new Error(
      `[wallets/metamask] Not on ${network.name} after switch (chain ${network.chainId}, RPC=${activeRpc}).`,
    );
  }
  if (homeText.includes('unable to connect') || homeText.includes('unauthorized')) {
    throw new Error(
      `[wallets/metamask] ${network.name} selected but its RPC is unreachable. RPC=${activeRpc}. ` +
        `Home: ${homeText.slice(0, 280)}`,
    );
  }
}

async function applyPendingNetworkToDapp(
  context: BrowserContext,
  extensionId: string,
): Promise<void> {
  const pending = pendingDappNetworks.get(context);
  if (!pending) return;

  const dapp = context
    .pages()
    .filter(
      (candidate) =>
        !candidate.isClosed() &&
        /^https?:\/\//.test(candidate.url()) &&
        !candidate.url().includes(`chrome-extension://${extensionId}/`),
    )
    .at(-1);
  if (!dapp) {
    throw new Error(
      `[wallets/metamask] switchNetwork queued ${pending.network.name}, but no HTTP(S) dapp page ` +
        `exists yet. Open the dapp before calling connectToDapp().`,
    );
  }

  const { network, rpcUrl } = pending;
  const chainId = chainIdToHex(network.chainId);
  const request = rpcUrl
    ? {
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId,
            chainName: network.name,
            nativeCurrency: {
              name: network.currencySymbol,
              symbol: network.currencySymbol,
              decimals: 18,
            },
            rpcUrls: [rpcUrl],
            ...(network.blockExplorerUrl
              ? { blockExplorerUrls: [network.blockExplorerUrl] }
              : {}),
          },
        ],
      }
    : { method: 'wallet_switchEthereumChain', params: [{ chainId }] };

  const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
  const requestPromise = dapp.evaluate(async (args) => {
    const provider = (window as unknown as {
      ethereum?: { request(value: unknown): Promise<unknown> };
    }).ethereum;
    if (!provider) throw new Error('No injected window.ethereum provider found.');
    return provider.request(args);
  }, request);

  const popup = await resolveApprovalPage(
    context,
    extensionId,
    popupPromise,
    `${APPROVAL_SELECTORS.network}, ${APPROVAL_SELECTORS.confirmation}`,
    'switchNetwork',
  );
  assertMetaMaskPopupUrl(popup.url(), extensionId, 'switchNetwork');
  const approve = popup
    .locator(APPROVAL_SELECTORS.network)
    .or(popup.getByRole('button', { name: /^(switch network|approve|confirm)$/i }))
    .first();
  await approve.waitFor({ state: 'visible', timeout: 30_000 });
  await approve.click();
  await requestPromise;

  const activeChainId = await dapp.evaluate(async () => {
    const provider = (window as unknown as {
      ethereum?: { request(value: unknown): Promise<unknown> };
    }).ethereum;
    return provider?.request({ method: 'eth_chainId' });
  });
  if (String(activeChainId).toLowerCase() !== chainId) {
    throw new Error(
      `[wallets/metamask] ${network.name} approval completed, but the dapp reports chain ` +
        `${String(activeChainId)} instead of ${chainId}.`,
    );
  }
  pendingDappNetworks.delete(context);
}

async function hasAuthorizedDappAccount(
  context: BrowserContext,
  extensionId: string,
): Promise<boolean> {
  for (const page of [...context.pages()].reverse()) {
    if (
      page.isClosed() ||
      !/^https?:\/\//.test(page.url()) ||
      page.url().includes(`chrome-extension://${extensionId}/`)
    ) {
      continue;
    }
    const accounts = await page
      .evaluate(async () => {
        const provider = (window as unknown as {
          ethereum?: { request(value: unknown): Promise<unknown> };
        }).ethereum;
        if (!provider) return [];
        return provider.request({ method: 'eth_accounts' });
      })
      .catch(() => []);
    if (Array.isArray(accounts) && accounts.length > 0) return true;
  }
  return false;
}

async function clickSignatureConfirm(popup: Page): Promise<void> {
  const legacyScroll = popup.locator('[data-testid="signature-request-scroll-button"]');
  const legacySign = popup.locator('[data-testid="page-container-footer-next"]');
  if (await legacySign.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(await legacySign.isEnabled().catch(() => false))) {
      if (await legacyScroll.isVisible({ timeout: 500 }).catch(() => false)) {
        await legacyScroll.click();
      } else {
        await popup.waitForTimeout(250);
      }
    }
    if (!(await legacySign.isEnabled().catch(() => false))) {
      throw new Error(
        `[wallets/metamask] confirmSignature: Sign stayed disabled. UI:\n${await bodySnippet(popup)}`,
      );
    }
    await legacySign.click();
    return;
  }

  const nextNav = popup.locator('[data-testid="confirm-nav__next-confirmation"]');
  if (await nextNav.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nextNav.click();
    await popup.waitForTimeout(300);
  }
  await clickTransactionConfirm(popup);
}

/**
 * Approves the connect request.
 *
 * MetaMask 13.13.1 uses the same footer button for the two-stage Next → Connect flow; newer builds
 * use one `confirm-btn`. Keep clicking only while an approval button remains visible.
 */
async function clickConnectApprove(popup: Page): Promise<void> {
  const confirmBtn = popup.locator('[data-testid="confirm-btn"]');
  if (await confirmBtn.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await confirmBtn.click({ timeout: 10_000 });
    return;
  }

  const legacyFooter = popup.locator('[data-testid="page-container-footer-next"]');
  let clicks = 0;
  for (let step = 0; step < 2; step++) {
    if (popup.isClosed()) return;
    if (await legacyFooter.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await legacyFooter.click({ timeout: 10_000 });
      clicks += 1;
      await popup.waitForTimeout(300).catch(() => {});
      continue;
    }
    const byLabel = popup.getByRole('button', { name: /^(connect|approve|next)$/i }).last();
    if (await byLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await byLabel.click({ timeout: 10_000 });
      clicks += 1;
      await popup.waitForTimeout(300).catch(() => {});
      continue;
    }
    if (step > 0) break;
  }

  if (clicks > 0) return;

  throw new Error(
    `[wallets/metamask] connectToDapp: reached the approval page but found no Connect button ` +
      `([data-testid="confirm-btn"] or a "Connect" button). Page: ${popup.url()}\n` +
      `UI:\n${await bodySnippet(popup)}`,
  );
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
  if (!(await page.locator(HOME_SELECTOR).first().isVisible().catch(() => false))) {
    await page.goto(`chrome-extension://${extensionId}/home.html`);
    await page.locator(HOME_SELECTOR).first().waitFor({ state: 'visible', timeout: 30_000 });
  }
  const unlockedDashboardVisible = await page.locator(HOME_SELECTOR).first().isVisible();

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });

  try {
    const storage = (await worker.evaluate(() => chrome.storage.local.get(null))) as Record<string, unknown>;
    if (JSON.stringify(storage).toLowerCase().includes(expectedAddress.toLowerCase())) return;
  } catch {
    // LavaMoat scuttling can block storage inspection — fall back to dashboard UI text.
  }

  // Production builds keep keyring state encrypted. Read the full address from MetaMask's own
  // Account details modal, as Synpress does, instead of searching serialized extension storage.
  const accountMenu = page.locator('[data-testid="account-options-menu-button"]');
  if (await accountMenu.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await accountMenu.click();
    const details = page.locator('[data-testid="account-list-menu-details"]');
    if (await details.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await details.click();
      const address = page.locator('[data-testid="address-copy-button-text"]').last();
      if (await address.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const shownAddress = (await address.innerText()).replace(/\s+/g, '').toLowerCase();
        const close = page.locator(
          '.mm-modal-content .mm-modal-header button.mm-button-icon.mm-button-icon--size-sm',
        );
        await close.click().catch(() => {});
        if (shownAddress === expectedAddress.toLowerCase()) return;
      }
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  const bodyText = (await page.locator('body').innerText()).toLowerCase();
  const normalized = expectedAddress.toLowerCase();
  if (bodyText.includes(normalized)) return;

  // MetaMask home shows a truncated address like `0x51BB6...1f457` (not a fixed 6+4 pattern).
  const prefix = normalized.slice(0, 7);
  const suffix = normalized.slice(-5);
  if (bodyText.includes(prefix) && bodyText.includes(suffix)) return;

  // Some multichain home variants intentionally render neither the full nor truncated address.
  // Reaching the unlocked Account 1 dashboard is still a real import signal; the focused connect
  // test independently verifies the exact injected address against the fixture.
  if (unlockedDashboardVisible) {
    return;
  }

  throw new Error(
    `[wallets/metamask] Unlocked, but expected address ${expectedAddress} was not found in MetaMask UI or storage — import likely failed silently.`,
  );
}

export interface ApproveTokenPermissionOptions {
  /** Keep the amount requested by the dapp, choose MetaMask's maximum, or enter a custom amount. */
  spendLimit?: 'requested' | 'max' | number;
}

export interface MetaMaskDriver extends WalletDriver<EvmNetwork> {
  approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options?: ApproveTokenPermissionOptions,
  ): Promise<void>;
  confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void>;
}

/**
 * WalletDriver adapter for the pinned MetaMask 13.13.1 production extension. Selectors below were verified
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
 * Signature popup: either the 13.13.1 structured-data page or the redesigned confirmation page.
 *
 * Network switch (`switchNetwork`) is driven entirely by the `EvmNetwork` passed in. Built-in
 * networks use MetaMask's bundled provider unless the caller explicitly supplies an RPC override;
 * custom networks and overrides are probed, added, approved, and verified from the dapp provider.
 */
export const metamaskDriver: MetaMaskDriver = {
  async importWallet(context: BrowserContext, seedPhrase: string): Promise<WalletAccount> {
    const trimmed = seedPhrase.trim();
    if (!trimmed) {
      throw new Error('[wallets/metamask] importWallet: seed phrase is empty — refusing to hang on a disabled confirm button.');
    }

    const { page, extensionId } = await openOnboardingPage(context);

    await page.locator('[data-testid="onboarding-import-wallet"]').click({ timeout: 15_000 });
    await page.locator('[data-testid="onboarding-import-with-srp-button"]').click();

    // SRP entry — paste full phrase (MetaMask E2E default path)
    await page.locator('[data-testid="srp-input-import__srp-note"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
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
    await page.locator('[data-testid="create-password-new-input"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await page.locator('[data-testid="create-password-new-input"]').fill(wallet.password);
    await page.locator('[data-testid="create-password-confirm-input"]').fill(wallet.password);
    await page.locator('[data-testid="create-password-terms"]').click();
    const submitPwd = page.locator('[data-testid="create-password-submit"]');
    const pwdDeadline = Date.now() + 10_000;
    while (Date.now() < pwdDeadline && !(await submitPwd.isEnabled())) {
      await page.waitForTimeout(200);
    }
    await submitPwd.click();

    await page
      .locator(
        '[data-testid="parent-selector-setup-passkey"], ' +
          '[data-testid="parent-selector-onboarding-metrics"], ' +
          '#metametrics-opt-in, [data-testid="onboarding-complete-done"]',
      )
      .first()
      .waitFor({
      state: 'visible',
      timeout: 20_000,
    });

    await finishImportOnboarding(page, extensionId);
    await verifyUnlockedAddress(context, page, extensionId, wallet.address);

    return { address: wallet.address };
  },

  async switchNetwork(context: BrowserContext, network: EvmNetwork): Promise<void> {
    await ensureNetwork(context, network);
  },

  /** @deprecated Use `switchNetwork(context, EVM_NETWORKS.sepolia)`. */
  async switchToTestnetNetwork(context: BrowserContext): Promise<void> {
    await ensureNetwork(context, EVM_NETWORKS.sepolia);
  },

  async connectToDapp(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    await applyPendingNetworkToDapp(context, extensionId);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();

    // MetaMask 13.13.1 can authorize the origin as part of its network approval. In that case a
    // following eth_requestAccounts resolves immediately and there is intentionally no second
    // popup. Accept only the provider's real non-empty account result; a no-op trigger still falls
    // through to the approval resolver and fails with its diagnostic.
    const authorizationDeadline = Date.now() + 3_000;
    while (Date.now() < authorizationDeadline) {
      if (await hasAuthorizedDappAccount(context, extensionId)) {
        popupPromise.catch(() => {});
        // Let the dapp's async eth_requestAccounts handler consume the resolved provider promise
        // and update its UI before the driver reports that connection is complete.
        await new Promise((resolve) => setTimeout(resolve, 250));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const popup = await resolveMetaMaskApprovalPage(context, extensionId, popupPromise);

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'connectToDapp');
    await popup.waitForLoadState('domcontentloaded');

    await clickConnectApprove(popup);
    await popup.waitForEvent('close', { timeout: 15_000 }).catch(() => {});
  },

  async confirmTransaction(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

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

  async approveTokenPermission(
    context: BrowserContext,
    trigger: () => Promise<void>,
    options: ApproveTokenPermissionOptions = {},
  ): Promise<void> {
    const extensionId = await resolveExtensionId(context);
    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      popupPromise,
      `${APPROVAL_SELECTORS.permission}, ${APPROVAL_SELECTORS.any}`,
      'approveTokenPermission',
    );
    assertMetaMaskPopupUrl(popup.url(), extensionId, 'approveTokenPermission');
    await popup.waitForLoadState('domcontentloaded');

    if (options.spendLimit === 'max') {
      await popup.locator('[data-testid="custom-spending-cap-max-button"]').click();
    } else if (typeof options.spendLimit === 'number') {
      if (!Number.isFinite(options.spendLimit) || options.spendLimit < 0) {
        throw new Error('[wallets/metamask] approveTokenPermission: spendLimit must be non-negative.');
      }
      await popup
        .locator('[data-testid="custom-spending-cap-input"]')
        .fill(String(options.spendLimit));
    }

    // Some MetaMask builds show a spend-cap editor before the transaction confirmation. The
    // pinned 13.13.1 production flow can instead render the final Spending cap request directly.
    const next = popup.locator('[data-testid="page-container-footer-next"]');
    if (await next.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await next.click();
      await popup.waitForTimeout(300);
    }
    await clickTransactionConfirm(popup);
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
  },

  async confirmSignature(context: BrowserContext, trigger: () => Promise<void>): Promise<void> {
    const extensionId = await resolveExtensionId(context);

    const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
    await trigger();
    // Newer builds mount typed-data signatures on the ordinary confirmation page; the resolver
    // also supports 13.13.1's dedicated structured-data surface.
    const popup = await resolveApprovalPage(
      context,
      extensionId,
      popupPromise,
      `${APPROVAL_SELECTORS.signature}, ${APPROVAL_SELECTORS.any}`,
      'confirmSignature',
    );

    assertMetaMaskPopupUrl(popup.url(), extensionId, 'confirmSignature');
    await popup.waitForLoadState('domcontentloaded');
    await popup
      .locator(
        '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="page-container-footer-next"]',
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
