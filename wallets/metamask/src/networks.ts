import type { BrowserContext, EvmNetwork, Page } from '@wallets-e2e/core';
import { chainIdToHex, evmRpcCandidates, probeEvmRpc, resolveWorkingRpc } from '@wallets-e2e/core';
import { APPROVAL_SELECTORS, SHOW_TEST_NETWORKS_TOGGLE, networkSelectors } from './selectors.js';
import {
  assertMetaMaskPopupUrl,
  bodySnippet,
  escapeRegExp,
  formInput,
  goHome,
  rpcNickname,
} from './utils.js';
import { getUnlockedHomePage } from './session.js';
import { resolveApprovalPage } from './approvals.js';

interface PendingDappNetwork {
  network: EvmNetwork;
  rpcUrl?: string;
}

const pendingDappNetworks = new WeakMap<BrowserContext, PendingDappNetwork>();

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

async function isNetworkListed(page: Page, network: EvmNetwork, timeoutMs = 6_000): Promise<boolean> {
  const { listItem } = networkSelectors(network);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator(listItem).first().isVisible({ timeout: 400 }).catch(() => false)) {
      return true;
    }

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

async function submitRpcUrlForm(page: Page, rpcUrl: string): Promise<boolean> {
  const nick = rpcNickname(rpcUrl);
  const rpcInput = page.locator('[data-testid="rpc-url-input-test"]');
  const nameInput = page.locator('[data-testid="rpc-name-input-test"]');
  await rpcInput.waitFor({ state: 'visible', timeout: 10_000 });
  await rpcInput.fill('');
  await rpcInput.fill(rpcUrl);
  await nameInput.fill(nick);

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

  return closed;
}

async function selectOrAddRpcInForm(page: Page, network: EvmNetwork, preferredRpc: string): Promise<string> {
  const dropdown = page.locator('[data-testid="test-add-rpc-drop-down"]');
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 });
  await dropdown.click({ timeout: 10_000 });

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

async function addCustomNetwork(page: Page, network: EvmNetwork, preferredRpc: string): Promise<string> {
  await page.locator('[data-testid="networks-page-add-custom-network-button"]').click({ timeout: 15_000 });

  const nameInput = formInput(page, 'network-form-network-name', 'network-form-name-input');
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await nameInput.fill(network.name);

  const activeRpc = await selectOrAddRpcInForm(page, network, preferredRpc);

  const chainIdInput = formInput(page, 'network-form-chain-id', 'network-form-chain-id-input');
  if (await chainIdInput.isEditable({ timeout: 5_000 }).catch(() => false)) {
    await chainIdInput.fill(String(network.chainId));
  }

  const tickerInput = formInput(page, 'network-form-ticker-input', 'network-form-ticker');
  if (await tickerInput.isEditable({ timeout: 5_000 }).catch(() => false)) {
    await tickerInput.fill(network.currencySymbol);
  }

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

async function selectFromHomePicker(page: Page, network: EvmNetwork): Promise<void> {
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

export async function ensureNetwork(context: BrowserContext, network: EvmNetwork): Promise<void> {
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
    if (explicitOverride && network.builtIn) {
      await openManageNetworks(page);
      if (network.testnet) {
        await ensureShowTestNetworksEnabled(page);
      }
      if (await isNetworkListed(page, network)) {
        await editExistingNetworkRpc(page, network, explicitOverride);
      } else {
        await addCustomNetwork(page, network, explicitOverride);
      }
      await goHome(page, extensionId);
      pendingDappNetworks.set(context, { network });
      return;
    }

    const rpcUrl = explicitOverride || (!network.builtIn ? await resolveWorkingRpc(network) : undefined);
    pendingDappNetworks.set(context, { network, rpcUrl });
    return;
  }

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

  const listed = await isNetworkListed(page, network);
  const activeRpc = listed
    ? await editExistingNetworkRpc(page, network, preferredRpc)
    : await addCustomNetwork(page, network, preferredRpc);

  await goHome(page, extensionId);

  const { page: home } = await getUnlockedHomePage(context);
  await selectFromHomePicker(home, network);

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

export async function applyPendingNetworkToDapp(
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
  if (rpcUrl && (network.currencySymbol.length < 2 || network.currencySymbol.length > 6)) {
    throw new Error(
      `[wallets/metamask] switchNetwork: ${network.name} has currencySymbol ` +
        `"${network.currencySymbol}" (${network.currencySymbol.length} characters). ` +
        `wallet_addEthereumChain requires 2-6, and rejects anything else with code -32602.`,
    );
  }
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

  const requestPromise = dapp.evaluate(async (args) => {
    const provider = (window as unknown as {
      ethereum?: { request(value: unknown): Promise<unknown> };
    }).ethereum;
    if (!provider) return { error: 'no injected window.ethereum provider' };
    try {
      await provider.request(args);
      return {};
    } catch (cause) {
      const err = cause as { code?: number; message?: string };
      return { error: `code ${err.code ?? '?'}: ${err.message ?? String(cause)}` };
    }
  }, request);

  const approval = resolveApprovalPage(
    context,
    extensionId,
    `${APPROVAL_SELECTORS.network}, ${APPROVAL_SELECTORS.confirmation}`,
    'switchNetwork',
  ).then(
    (page) => ({ page }) as const,
    (cause: unknown) => ({ failure: cause as Error }) as const,
  );

  const outcome = await Promise.race([
    approval,
    requestPromise.then(() => ({ completed: true }) as const),
  ]);

  if ('page' in outcome) {
    const popup = outcome.page;
    assertMetaMaskPopupUrl(popup.url(), extensionId, 'switchNetwork');
    const approve = popup
      .locator(APPROVAL_SELECTORS.network)
      .or(popup.getByRole('button', { name: /^(switch network|approve|confirm)$/i }))
      .first();
    await approve.waitFor({ state: 'visible', timeout: 30_000 });
    await approve.click();
  } else if ('failure' in outcome) {
    throw outcome.failure;
  }

  const { error } = await requestPromise;
  if (error) {
    throw new Error(
      `[wallets/metamask] switchNetwork: MetaMask rejected ${request.method} for ${network.name} ` +
        `(${chainId}${rpcUrl ? `, RPC=${rpcUrl}` : ''}): ${error}`,
    );
  }

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
