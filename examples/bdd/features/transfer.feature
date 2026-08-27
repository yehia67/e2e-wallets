Feature: Sending STX from the demo app

  Anyone who can read English can review this file. It says what the automation does and nothing
  about how: no seed phrase, no network switching, no extension paths, no popup mechanics.

  Scenario: The app shows the address of the wallet that connected
    Given I am connected to Stacks testnet
    Then my wallet address is shown

  @timeout:1_200_000
  Scenario: A connected visitor sends 1 STX and it lands on chain
    Given I am connected to Stacks testnet
    When I request a transfer of 1 STX
    And I approve the wallet popup
    Then a transaction id is shown
    And the transaction is mined
