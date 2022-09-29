// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VaultStorage.sol";

/**
 * @title Knox Vault View Interface
 */

interface IVaultView {
    /************************************************
     *  VIEW
     ***********************************************/

    /**
     * @notice returns the current epoch
     * @return current epoch id
     */
    function getEpoch() external view returns (uint64);

    /**
     * @notice returns the option by epoch id
     * @return option parameters
     */
    function getOption(uint64 epoch)
        external
        view
        returns (VaultStorage.Option memory);

    /**
     * @notice calculates the total active vault collateral
     * @return total vault collateral excluding the total reserves
     */
    function totalCollateral() external view returns (uint256);

    /**
     * @notice calculates the short position value denominated in the collateral asset
     * @return total short position in collateral amount
     */
    function totalShortAsCollateral() external view returns (uint256);

    /**
     * @notice returns the amount in short contracts underwitten by the vault
     * @return total short contracts
     */
    function totalShortAsContracts() external view returns (uint256);

    /**
     * @notice calculates the total reserved collateral
     * @dev collateral is reserved from the auction to ensure the Vault has sufficent
     * funds to cover the APY fee
     * @return total reserved collateral
     */
    function totalReserves() external view returns (uint256);
}
