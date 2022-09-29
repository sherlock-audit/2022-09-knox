// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@solidstate/contracts/access/ownable/OwnableStorage.sol";
import "@solidstate/contracts/introspection/ERC165Storage.sol";
import "@solidstate/contracts/introspection/IERC165.sol";
import "@solidstate/contracts/proxy/upgradeable/UpgradeableProxyOwnable.sol";
import "@solidstate/contracts/proxy/upgradeable/UpgradeableProxyStorage.sol";

import "../vault/IVault.sol";

import "./QueueStorage.sol";

/**
 * @title Knox Queue Proxy Contract
 * @dev contracts are upgradable
 */

contract QueueProxy is UpgradeableProxyOwnable {
    using ERC165Storage for ERC165Storage.Layout;
    using OwnableStorage for OwnableStorage.Layout;
    using QueueStorage for QueueStorage.Layout;
    using UpgradeableProxyStorage for UpgradeableProxyStorage.Layout;

    constructor(
        uint256 maxTVL,
        address exchange,
        address implementation
    ) {
        {
            QueueStorage.Layout storage l = QueueStorage.layout();
            l.Exchange = IExchangeHelper(exchange);
            l.maxTVL = maxTVL;
        }

        {
            ERC165Storage.Layout storage l = ERC165Storage.layout();
            l.setSupportedInterface(type(IERC165).interfaceId, true);
            l.setSupportedInterface(type(IERC1155).interfaceId, true);
        }

        OwnableStorage.layout().setOwner(msg.sender);
        UpgradeableProxyStorage.layout().setImplementation(implementation);
    }

    receive() external payable {}
}
