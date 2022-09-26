// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@solidstate/contracts/access/ownable/OwnableInternal.sol";
import "@solidstate/contracts/access/ownable/OwnableStorage.sol";

struct Vault {
    address vault;
    address queue;
    address auction;
    address pricer;
}

contract Registry is OwnableInternal {
    using OwnableStorage for OwnableStorage.Layout;

    constructor() {
        OwnableStorage.layout().setOwner(msg.sender);
    }

    event VaultDeployed(Vault vault);
    Vault[] public vaults;

    function count() external view returns (uint256) {
        return vaults.length;
    }

    function addVault(Vault memory vault) external onlyOwner {
        vaults.push(vault);
        emit VaultDeployed(vault);
    }
}
