Feature: MetaMask on an EVM network (metamask-spike dapp)

  Readable product language — no seed phrase, no extension paths, no popup mechanics.
  The network is data in the sentence, not part of the step: "Sepolia" is one value the
  step resolves to a full network definition, not the only network these steps can drive.
  Wallet steps come from @wallets-e2e/core/bdd; dapp steps live in examples/metamask-bdd/steps/.

  Scenario: The spike dapp shows the connected fixture address
    Given I am connected to MetaMask on Sepolia
    Then my wallet address is shown

  @sepolia-spending @timeout:600_000
  Scenario: A visitor deposits ERC20 via approve then deposit
    Given I am connected to MetaMask on Sepolia
    When I request ERC20 token approval
    And I approve the token permission popup
    And the EVM transaction is mined
    When I request an ERC20 deposit after approve
    And I approve the wallet popup
    And the EVM transaction is mined
    Then my vault balance increased by one token

  @sepolia-spending @timeout:600_000
  Scenario: A visitor deposits ERC20 via EIP-2612 permit
    Given I am connected to MetaMask on Sepolia
    When I request an ERC20 permit signature
    And I approve the wallet signature popup
    When I request an ERC20 deposit with permit
    And I approve the wallet popup
    And the EVM transaction is mined
    Then my vault balance increased by one token
