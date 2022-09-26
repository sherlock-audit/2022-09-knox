// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../vault/VaultBase.sol";

/**
 * @title Knox Vault Mock Contract
 * @dev deployed standalone and referenced by VaultDiamond
 */

contract VaultMock is VaultBase {
    using SafeERC20 for IERC20;
    using VaultStorage for VaultStorage.Layout;

    constructor(bool isCall, address pool) VaultBase(isCall, pool) {}

    function setOptionParameters()
        external
        returns (VaultStorage.Option memory)
    {
        VaultStorage.Layout storage l = VaultStorage.layout();
        return _setOptionParameters(l);
    }

    function collectPerformanceFee() external {
        VaultStorage.Layout storage l = VaultStorage.layout();
        _collectPerformanceFee(l);
    }

    function withdrawReservedLiquidity() external {
        VaultStorage.Layout storage l = VaultStorage.layout();
        _withdrawReservedLiquidity(l);
    }

    function setAuctionPrices() external {
        VaultStorage.Layout storage l = VaultStorage.layout();
        _setAuctionPrices(l);
    }

    function getFriday(uint256 timestamp) external pure returns (uint256) {
        return _getFriday(timestamp);
    }

    function getNextFriday(uint256 timestamp) external pure returns (uint256) {
        return _getNextFriday(timestamp);
    }
}
