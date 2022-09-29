// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../vault/IVault.sol";
import "../vault/VaultStorage.sol";

/**
 * @title Knox Vault Interface
 */

interface IVaultMock is IVault {
    function setOptionParameters()
        external
        returns (VaultStorage.Option memory);

    function collectPerformanceFee() external;

    function withdrawReservedLiquidity() external;

    function setAuctionPrices() external;

    function getFriday(uint256 timestamp) external pure returns (uint256);

    function getNextFriday(uint256 timestamp) external pure returns (uint256);
}
