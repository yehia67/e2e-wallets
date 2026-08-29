Feature: MetaMask on Sepolia (metamask-spike dapp)

  Readable product language — no seed phrase, no extension paths, no popup mechanics.
  Wallet steps come from @wallets-e2e/core/bdd; dapp steps live in examples/metamask-bdd/steps/.

  Scenario: The spike dapp shows the connected fixture address
    Given I am connected to MetaMask on Sepolia
    Then my wallet address is shown

  @timeout:600_000
  Scenario: A visitor deposits ERC20 via approve then deposit
    Given I am connected to MetaMask on Sepolia
    When I request ERC20 token approval
    And I approve the wallet popup
    When I request an ERC20 deposit after approve
    And I approve the wallet popup
    Then my vault balance increased by one token

  @timeout:600_000
  Scenario: A visitor deposits ERC20 via EIP-2612 permit
    Given I am connected to MetaMask on Sepolia
    When I request an ERC20 permit signature
    And I approve the wallet signature popup
    When I request an ERC20 deposit with permit
    And I approve the wallet popup
    Then my vault balance increased by one token
