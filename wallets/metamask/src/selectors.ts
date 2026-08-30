import type { EvmNetwork } from '@wallets-e2e/core';
import { chainIdToCaip, chainIdToHex } from '@wallets-e2e/core';

export const HOME_SELECTOR =
  '[data-testid="parent-selector-home"], [data-testid="network-display"], [data-testid="sort-by-networks"]';

export const APPROVAL_SELECTORS = {
  confirmationReady:
    '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="confirmation-submit-button"], [data-testid="confirm-btn"]',
  signatureReady:
    '[data-testid="parent-selector-confirmation-page"], [data-testid="confirm-footer-button"], [data-testid="page-container-footer-next"]',
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

export const LOADING_INDICATORS = [
  '.loading-logo',
  '.loading-spinner',
  '.loading-overlay',
  '.loading-overlay__spinner',
  '.loading-span',
  '.loading-indicator',
  '#loading__logo',
  '#loading__spinner',
  '.mm-button-base__icon-loading',
] as const;

export const CRITICAL_ERROR = '.critical-error';

export const CRITICAL_ERROR_RESTART_BUTTON = '#critical-error-button';

export const ERROR_PAGE = '.error-page';

export const SHOW_TEST_NETWORKS_TOGGLE =
  'label.toggle-button:has([data-testid="networks-page-show-test-networks"])';

interface NetworkSelectors {
  caip: string;
  hex: string;
  listItem: string;
  optionsButton: string;
}

export function networkSelectors(network: EvmNetwork): NetworkSelectors {
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
