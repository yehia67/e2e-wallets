// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev Spike fixture token — minted to the E2E wallet on deploy.
contract TestToken is ERC20, ERC20Permit {
    constructor() ERC20("Wallets E2E Test", "WET") ERC20Permit("Wallets E2E Test") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}
