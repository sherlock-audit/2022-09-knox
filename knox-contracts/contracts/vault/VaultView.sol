// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VaultInternal.sol";

/**
 * @title Knox Vault View Contract (read-only)
 * @dev deployed standalone and referenced by VaultDiamond
 */

contract VaultView is IVaultView, VaultInternal {
    using VaultStorage for VaultStorage.Layout;

    constructor(bool isCall, address pool) VaultInternal(isCall, pool) {}

    /************************************************
     *  VIEW
     ***********************************************/

    /**
     * @inheritdoc IVaultView
     */
    function getEpoch() external view returns (uint64) {
        return VaultStorage._getEpoch();
    }

    /**
     * @inheritdoc IVaultView
     */
    function getOption(uint64 epoch)
        external
        view
        returns (VaultStorage.Option memory)
    {
        return VaultStorage._getOption(epoch);
    }

    /**
     * @inheritdoc IVaultView
     */
    function totalCollateral() external view returns (uint256) {
        return _totalCollateral();
    }

    /**
     * @inheritdoc IVaultView
     */
    function totalShortAsCollateral() external view returns (uint256) {
        return _totalShortAsCollateral();
    }

    /**
     * @inheritdoc IVaultView
     */
    function totalShortAsContracts() external view returns (uint256) {
        return _totalShortAsContracts();
    }

    /**
     * @inheritdoc IVaultView
     */
    function totalReserves() external view returns (uint256) {
        return _totalReserves();
    }
}
