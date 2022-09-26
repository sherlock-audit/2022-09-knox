// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@solidstate/contracts/access/ownable/OwnableInternal.sol";
import "@solidstate/contracts/token/ERC4626/base/ERC4626BaseInternal.sol";

import "../libraries/OptionMath.sol";

import "../vendor/IPremiaPool.sol";

import "./IVault.sol";
import "./IVaultEvents.sol";
import "./VaultStorage.sol";

/**
 * @title Knox Vault Internal Contract
 */

contract VaultInternal is ERC4626BaseInternal, IVaultEvents, OwnableInternal {
    using ABDKMath64x64 for int128;
    using ABDKMath64x64 for uint256;
    using OptionMath for int128;
    using OptionMath for uint256;
    using SafeERC20 for IERC20;
    using VaultStorage for VaultStorage.Layout;

    IERC20 public immutable ERC20;
    IPremiaPool public immutable Pool;

    constructor(bool isCall, address pool) {
        Pool = IPremiaPool(pool);
        IPremiaPool.PoolSettings memory settings = Pool.getPoolSettings();
        address asset = isCall ? settings.underlying : settings.base;
        ERC20 = IERC20(asset);
    }

    /************************************************
     *  ACCESS CONTROL
     ***********************************************/

    /**
     * @dev Throws if called by any account other than the keeper
     */
    modifier onlyKeeper() {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(msg.sender == l.keeper, "!keeper");
        _;
    }

    /**
     * @dev Throws if called by any account other than the queue
     */
    modifier onlyQueue() {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(msg.sender == address(l.Queue), "!queue");
        _;
    }

    /**
     * @dev Throws if called while withdrawals are locked
     */
    modifier withdrawalsLocked() {
        VaultStorage.Layout storage l = VaultStorage.layout();

        /**
         * the withdrawal lock is active after the auction has started and deactivated
         * when the auction is processed.
         *
         * when the auction has been processed by the keeper the auctionProcessed flag
         * is set to true, deactivating the lock.
         *
         * when the auction is initialized by the keeper the flag is set to false and
         * the startTime is updated.
         *
         * note, the auction must start for the lock to be reactivated. i.e. if the
         * flag is false but the auction has not started the lock is deactivated.
         *
         *
         *    Auction       Auction      Auction       Auction
         *  Initialized     Started     Processed    Initialized
         *       |             |///Locked///|             |
         *       |             |////////////|             |
         * -------------------------Time--------------------------->
         *
         *
         */

        if (block.timestamp >= l.startTime) {
            require(l.auctionProcessed, "auction has not been processed");
        }
        _;
    }

    /************************************************
     *  VIEW
     ***********************************************/

    /**
     * @notice calculates the total active vault collateral
     * @return total vault collateral excluding the total reserves
     */
    function _totalCollateral() internal view returns (uint256) {
        // total reserves are deducted as they are not considered "active" assets
        return ERC20.balanceOf(address(this)) - _totalReserves();
    }

    /**
     * @notice calculates the short position value denominated in the collateral asset
     * @return total short position in collateral amount
     */
    function _totalShortAsCollateral() internal view returns (uint256) {
        VaultStorage.Layout storage l = VaultStorage.layout();
        VaultStorage.Option memory lastOption = _lastOption(l);

        uint256 totalShortContracts = _totalShortAsContracts();

        // calculates the value of the vaults short position
        return
            totalShortContracts.fromContractsToCollateral(
                l.isCall,
                l.underlyingDecimals,
                l.baseDecimals,
                lastOption.strike64x64
            );
    }

    /**
     * @notice returns the amount in short contracts underwitten by the vault
     * @return total short contracts
     */
    function _totalShortAsContracts() internal view returns (uint256) {
        VaultStorage.Layout storage l = VaultStorage.layout();
        uint256 shortTokenId = l.options[_lastEpoch(l)].shortTokenId;
        return Pool.balanceOf(address(this), shortTokenId);
    }

    /**
     * @notice calculates the total reserved collateral
     * @dev collateral is reserved from the auction to ensure the Vault has sufficent funds to
     * cover the APY fee
     * @return total reserved collateral
     */
    function _totalReserves() internal view returns (uint256) {
        VaultStorage.Layout storage l = VaultStorage.layout();
        return l.reserveRate64x64.mulu(ERC20.balanceOf(address(this)));
    }

    /************************************************
     *  ERC4626 OVERRIDES
     ***********************************************/

    /**
     * @notice calculates the total active assets by the vault denominated in the collateral asset
     * @return total active asset amount
     */
    function _totalAssets()
        internal
        view
        override(ERC4626BaseInternal)
        returns (uint256)
    {
        return _totalCollateral() + _totalShortAsCollateral();
    }

    /**
     * @notice execute a withdrawal of assets on behalf of given address
     * @dev owner must approve vault to redeem claim tokens
     * @dev this function may not be called while the auction is in progress
     * @param assetAmount quantity of assets to withdraw
     * @param receiver recipient of assets resulting from withdrawal
     * @param owner holder of shares to be redeemed
     * @return shareAmount quantity of shares to redeem
     */
    function _withdraw(
        uint256 assetAmount,
        address receiver,
        address owner
    ) internal virtual override(ERC4626BaseInternal) returns (uint256) {
        require(
            assetAmount <= _maxWithdraw(owner),
            "ERC4626: maximum amount exceeded"
        );

        uint256 shareAmount = _previewWithdraw(assetAmount);

        _withdraw(msg.sender, receiver, owner, assetAmount, shareAmount);

        return shareAmount;
    }

    /**
     * @notice execute a redemption of shares on behalf of given address
     * @dev owner must approve vault to redeem claim tokens
     * @dev this function may not be called while the auction is in progress
     * @param shareAmount quantity of shares to redeem
     * @param receiver recipient of assets resulting from withdrawal
     * @param owner holder of shares to be redeemed
     * @return assetAmount quantity of assets to withdraw
     */
    function _redeem(
        uint256 shareAmount,
        address receiver,
        address owner
    ) internal virtual override(ERC4626BaseInternal) returns (uint256) {
        require(
            shareAmount <= _maxRedeem(owner),
            "ERC4626: maximum amount exceeded"
        );

        uint256 assetAmount = _previewRedeem(shareAmount);

        _withdraw(msg.sender, receiver, owner, assetAmount, shareAmount);

        return assetAmount;
    }

    /**
     * @notice exchange shares for assets on behalf of given address
     * @param caller transaction operator for purposes of allowance verification
     * @param receiver recipient of assets resulting from withdrawal
     * @param owner holder of shares to be redeemed
     * @param assetAmount quantity of assets to withdraw
     * @param shareAmount quantity of shares to redeem
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assetAmount,
        uint256 shareAmount
    ) private {
        VaultStorage.Layout storage l = VaultStorage.layout();

        // prior to withdrawing, the vault will redeem all available claim tokens
        // in exchange for the pro-rata vault shares
        l.Queue.redeemMax(receiver, owner);

        require(l.epoch > 0, "cannot withdraw on epoch 0");

        if (caller != owner) {
            // if the owner is not equal to the caller, approve the caller
            // to spend up to the allowance
            uint256 allowance = _allowance(owner, caller);

            require(
                allowance >= shareAmount,
                "ERC4626: share amount exceeds allowance"
            );

            unchecked {_approve(owner, caller, allowance - shareAmount);}
        }

        _beforeWithdraw(owner, assetAmount, shareAmount);

        // burns vault shares held by owner
        _burn(owner, shareAmount);

        // aggregate the total assets withdrawn during the current epoch
        l.totalWithdrawals += assetAmount;

        // removes any reserved liquidty from pool in the event an option has been exercised
        _withdrawReservedLiquidity(l);

        // LPs may withdraw funds at any time and receive a proportion of the assets held in
        // the vault. this means that a withdrawal can be mixture of collateral assets and
        // short contracts, 100% collateral, or 100% short contracts. if a user wishes to
        // exit without exposure to a short position, they should wait until the vault holds
        // no short contracts, or withdraw and reassign their short contracts via Premia's
        // contracts.

        // calculate the collateral amount and short contract amount distribution
        (uint256 collateralAmount, uint256 shortContracts) =
            _calculateDistributions(l, assetAmount);

        // calculates and deducts the withdrawal fee
        (uint256 collateralAmountSansFee, uint256 shortContractsSansFee) =
            _collectWithdrawalFee(l, collateralAmount, shortContracts);

        // transfers the collateral and short contracts to the receiver
        _transferCollateralAndShortAssets(
            _lastEpoch(l),
            collateralAmountSansFee,
            shortContractsSansFee,
            _lastOption(l).shortTokenId,
            receiver
        );

        emit Withdraw(caller, receiver, owner, assetAmount, shareAmount);
    }

    /************************************************
     *  WITHDRAW HELPERS
     ***********************************************/

    /**
     * @notice calculates the total amount of collateral and short contracts to distribute
     * @param l vault storage layout
     * @param assetAmount quantity of assets to withdraw
     * @return distribution amount in collateral asset
     * @return distribution amount in the short contracts
     */
    function _calculateDistributions(
        VaultStorage.Layout storage l,
        uint256 assetAmount
    ) private view returns (uint256, uint256) {
        uint256 totalAssets = _totalAssets();

        uint256 collateralAmount =
            _calculateDistributionAmount(
                assetAmount,
                _totalCollateral(),
                totalAssets
            );

        VaultStorage.Option memory lastOption = _lastOption(l);

        uint256 totalShortAsCollateral = _totalShortAsCollateral();

        // calculates the distribution of short contracts denominated as collateral
        uint256 shortAsCollateral =
            _calculateDistributionAmount(
                assetAmount,
                totalShortAsCollateral,
                totalAssets
            );

        // converts the collateral amount back to short contracts.
        uint256 shortContracts =
            shortAsCollateral.fromContractsToCollateral(
                l.isCall,
                l.baseDecimals,
                lastOption.strike64x64
            );

        return (collateralAmount, shortContracts);
    }

    /**
     * @notice calculates the distribution amount
     * @param assetAmount quantity of assets to withdraw
     * @param collateralAmount quantity of asset collateral held by vault
     * @param totalAssets total amount of assets held by vault, denominated in collateral asset
     * @return distribution amount, denominated in the collateral asset
     */
    function _calculateDistributionAmount(
        uint256 assetAmount,
        uint256 collateralAmount,
        uint256 totalAssets
    ) private pure returns (uint256) {
        // calculates the ratio of collateral to total assets
        int128 assetRatio64x64 =
            collateralAmount > 0
                ? collateralAmount.divu(totalAssets)
                : int128(0);
        // calculates the amount of the asset which should be withdrawn
        return assetRatio64x64 > 0 ? assetRatio64x64.mulu(assetAmount) : 0;
    }

    /**
     * @notice calculates, deducts, and transfers withdrawal fees to the fee recipient
     * @param l vault storage layout
     * @param collateralAmount quantity of asset collateral to deduct fees from
     * @param shortContracts quantity of short contracts to deduct fees from
     * @return remaining collateral amount with fees deducted
     * @return remaining short contract amount with fees deducted
     */
    function _collectWithdrawalFee(
        VaultStorage.Layout storage l,
        uint256 collateralAmount,
        uint256 shortContracts
    ) private returns (uint256, uint256) {
        // calculates the collateral fee
        uint256 feeInCollateral = l.withdrawalFee64x64.mulu(collateralAmount);

        // calculates the short contract fee
        uint256 feesInShortContracts =
            l.withdrawalFee64x64.mulu(shortContracts);

        VaultStorage.Option memory lastOption = _lastOption(l);
        uint64 epoch = _lastEpoch(l);

        // transfers the fees to the fee recipient
        _transferCollateralAndShortAssets(
            epoch,
            feeInCollateral,
            feesInShortContracts,
            lastOption.shortTokenId,
            l.feeRecipient
        );

        emit WithdrawalFeeCollected(
            epoch,
            feeInCollateral,
            feesInShortContracts
        );

        // deducts the fee from collateral and short contract amounts
        return (
            collateralAmount - feeInCollateral,
            shortContracts - feesInShortContracts
        );
    }

    /**
     * @notice transfers collateral and short contract tokens to receiver
     * @param epoch vault storage layout
     * @param collateralAmount quantity of asset collateral to deduct fees from
     * @param shortContracts quantity of short contracts to deduct fees from
     * @param shortTokenId quantity of short contracts to deduct fees from
     * @param receiver quantity of short contracts to deduct fees from
     */
    function _transferCollateralAndShortAssets(
        uint64 epoch,
        uint256 collateralAmount,
        uint256 shortContracts,
        uint256 shortTokenId,
        address receiver
    ) private {
        if (collateralAmount > 0) {
            // transfers collateral to receiver
            ERC20.safeTransfer(receiver, collateralAmount);
        }

        if (shortContracts > 0) {
            // transfers short contracts to receiver
            Pool.safeTransferFrom(
                address(this),
                receiver,
                shortTokenId,
                shortContracts,
                ""
            );
        }

        emit DistributionSent(
            epoch,
            collateralAmount,
            shortContracts,
            receiver
        );
    }

    /************************************************
     *  ADMIN HELPERS
     ***********************************************/

    /**
     * @notice sets the parameters for the next option to be sold
     * @param l vault storage layout
     * @return the next option to be sold
     */
    function _setOptionParameters(VaultStorage.Layout storage l)
        internal
        returns (VaultStorage.Option memory)
    {
        // sets the expiry for the next Friday
        uint64 expiry = uint64(_getNextFriday(block.timestamp));

        // calculates the delta strike price
        int128 strike64x64 =
            l.Pricer.getDeltaStrikePrice64x64(l.isCall, expiry, l.delta64x64);

        // rounds the delta strike price
        strike64x64 = l.Pricer.snapToGrid64x64(l.isCall, strike64x64);

        // sets parameters for the next option
        VaultStorage.Option storage option = l.options[l.epoch];
        option.expiry = expiry;
        option.strike64x64 = strike64x64;

        TokenType longTokenType =
            l.isCall ? TokenType.LONG_CALL : TokenType.LONG_PUT;

        // get the formatted long token id
        option.longTokenId = _formatTokenId(longTokenType, expiry, strike64x64);

        TokenType shortTokenType =
            l.isCall ? TokenType.SHORT_CALL : TokenType.SHORT_PUT;

        // get the formatted short token id
        option.shortTokenId = _formatTokenId(
            shortTokenType,
            expiry,
            strike64x64
        );

        emit OptionParametersSet(
            l.epoch,
            option.expiry,
            option.strike64x64,
            option.longTokenId,
            option.shortTokenId
        );

        return option;
    }

    /**
     * @notice collects performance fees on epoch net income
     * @dev auction must be processed before fees can be collected, do not call
     * this function on epoch 0
     * @param l vault storage layout
     */
    function _collectPerformanceFee(VaultStorage.Layout storage l) internal {
        // pool must return all available "reserved liquidity" to the vault after the
        // option expires and before performance fee can be collected
        _withdrawReservedLiquidity(l);

        uint256 netIncome;
        uint256 feeInCollateral;

        // adjusts total assets to account for assets withdrawn during the epoch
        uint256 adjustedTotalAssets = _totalAssets() + l.totalWithdrawals;

        if (adjustedTotalAssets > l.lastTotalAssets) {
            // collect performance fee ONLY if the vault returns a positive net income
            // if the net income is negative, last week's option expired ITM past breakeven,
            // and the vault took a loss so we do not collect performance fee for last week
            netIncome = adjustedTotalAssets - l.lastTotalAssets;

            // calculate the performance fee denominated in the collateral asset
            feeInCollateral = l.performanceFee64x64.mulu(netIncome);

            // send collected fee to recipient wallet
            ERC20.safeTransfer(l.feeRecipient, feeInCollateral);
        }

        // reset totalWithdrawals
        l.totalWithdrawals = 0;

        emit PerformanceFeeCollected(_lastEpoch(l), netIncome, feeInCollateral);
    }

    /**
     * @notice removes reserved liquidity from Premia pool
     * @param l vault storage layout
     */
    function _withdrawReservedLiquidity(VaultStorage.Layout storage l)
        internal
    {
        // gets the vaults reserved liquidity balance
        uint256 reservedLiquidity =
            Pool.balanceOf(
                address(this),
                l.isCall
                    ? uint256(TokenType.UNDERLYING_RESERVED_LIQ) << 248
                    : uint256(TokenType.BASE_RESERVED_LIQ) << 248
            );

        if (reservedLiquidity > 0) {
            // remove reserved liquidity from the pool, if available
            Pool.withdraw(reservedLiquidity, l.isCall);
        }

        emit ReservedLiquidityWithdrawn(l.epoch, reservedLiquidity);
    }

    /**
     * @notice calculates and sets the auction prices
     * @param l vault storage layout
     */
    function _setAuctionPrices(VaultStorage.Layout storage l) internal {
        VaultStorage.Option memory lastOption = _lastOption(l);

        // assumes that the strike price has been set
        require(lastOption.strike64x64 > 0, "delta strike unset");

        // the delta offset is used to calculate an offset strike price which should always be
        // further OTM.

        // calculates the delta strike price using the offset delta
        int128 offsetStrike64x64 =
            l.Pricer.getDeltaStrikePrice64x64(
                l.isCall,
                lastOption.expiry,
                l.delta64x64.sub(l.deltaOffset64x64)
            );

        // fetches the spot price of the underlying
        int128 spot64x64 = l.Pricer.latestAnswer64x64();

        // fetches the time to maturity of the option
        int128 timeToMaturity64x64 =
            l.Pricer.getTimeToMaturity64x64(lastOption.expiry);

        /**
         * it is assumed that the rounded strike price will always be further ITM than the offset
         * strike price. the further ITM option will always be more expensive and will therefore
         * be used to determine the max price of the auction. likewise, the offset strike price
         * (further OTM) should resemble a cheaper option and it is therefore used as the min
         * option price in our auction.
         *
         *
         * Call Option
         * -----------
         * Strike    Rounded Strike             Offset Strike
         *   |  ---------> |                          |
         *   |             |                          |
         * -----------------------Price------------------------>
         *
         *
         * Put Option
         * -----------
         * Offset Strike              Rounded Strike    Strike
         *       |                           | <--------- |
         *       |                           |            |
         * -----------------------Price------------------------>
         *
         *
         */

        // calculates the auction max price using the strike price further (ITM)
        int128 maxPrice64x64 =
            l.Pricer.getBlackScholesPrice64x64(
                spot64x64,
                lastOption.strike64x64,
                timeToMaturity64x64,
                l.isCall
            );

        // calculates the auction min price using the offset strike price further (OTM)
        int128 minPrice64x64 =
            l.Pricer.getBlackScholesPrice64x64(
                spot64x64,
                offsetStrike64x64,
                timeToMaturity64x64,
                l.isCall
            );

        if (l.isCall) {
            // denominates price in the collateral asset
            maxPrice64x64 = maxPrice64x64.div(spot64x64);
            minPrice64x64 = minPrice64x64.div(spot64x64);
        }

        uint64 epoch = _lastEpoch(l);

        emit AuctionPricesSet(
            epoch,
            lastOption.strike64x64,
            offsetStrike64x64,
            spot64x64,
            timeToMaturity64x64,
            maxPrice64x64,
            minPrice64x64
        );

        l.Auction.setAuctionPrices(epoch, maxPrice64x64, minPrice64x64);
    }

    /************************************************
     *  PREMIA HELPERS
     ***********************************************/

    // Premia ERC1155 token types
    enum TokenType {
        UNDERLYING_FREE_LIQ,
        BASE_FREE_LIQ,
        UNDERLYING_RESERVED_LIQ,
        BASE_RESERVED_LIQ,
        LONG_CALL,
        SHORT_CALL,
        LONG_PUT,
        SHORT_PUT
    }

    /**
     * @notice calculate ERC1155 token id for given option parameters
     * @param tokenType TokenType enum
     * @param maturity timestamp of option maturity
     * @param strike64x64 64x64 fixed point representation of strike price
     * @return tokenId token id
     */
    function _formatTokenId(
        TokenType tokenType,
        uint64 maturity,
        int128 strike64x64
    ) internal pure returns (uint256 tokenId) {
        tokenId =
            (uint256(tokenType) << 248) +
            (uint256(maturity) << 128) +
            uint256(int256(strike64x64));
    }

    /************************************************
     *  HELPERS
     ***********************************************/

    /**
     * @notice returns the last epoch
     * @param l vault storage layout
     * @return last epoch
     */
    function _lastEpoch(VaultStorage.Layout storage l)
        internal
        view
        returns (uint64)
    {
        return l.epoch > 0 ? l.epoch - 1 : 0;
    }

    /**
     * @notice returns option from the last epoch
     * @param l vault storage layout
     * @return option from last epoch
     */
    function _lastOption(VaultStorage.Layout storage l)
        internal
        view
        returns (VaultStorage.Option memory)
    {
        return l.options[_lastEpoch(l)];
    }

    /**
     * @notice returns the next Friday 8AM timestamp
     * @param timestamp is the current timestamp
     * Examples:
     * getFriday(week 1 thursday) -> week 1 friday
     * getFriday(week 1 friday) -> week 2 friday
     * getFriday(week 1 saturday) -> week 2 friday
     */
    function _getFriday(uint256 timestamp) internal pure returns (uint256) {
        // dayOfWeek = 0 (sunday) - 6 (saturday)
        uint256 dayOfWeek = ((timestamp / 1 days) + 4) % 7;
        uint256 nextFriday = timestamp + ((7 + 5 - dayOfWeek) % 7) * 1 days;
        uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

        // If the passed timestamp is day = Friday hour > 8am,
        // we increment it by a week to next Friday
        if (timestamp >= friday8am) {
            friday8am += 7 days;
        }
        return friday8am;
    }

    /**
     * @notice returns the Friday 8AM timestamp of the following week
     * @param timestamp is the current timestamp
     * Reference: https://codereview.stackexchange.com/a/33532
     * Examples:
     * getNextFriday(week 1 thursday) -> week 2 friday
     * getNextFriday(week 1 friday) -> week 2 friday
     * getNextFriday(week 1 saturday) -> week 2 friday
     */
    function _getNextFriday(uint256 timestamp) internal pure returns (uint256) {
        // dayOfWeek = 0 (sunday) - 6 (saturday)
        uint256 dayOfWeek = ((timestamp / 1 days) + 4) % 7;
        uint256 nextFriday = timestamp + ((7 + 5 - dayOfWeek) % 7) * 1 days;
        uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

        // If the timestamp is on a Friday or between Monday-Thursday
        // return Friday of the following week
        if (timestamp >= friday8am || friday8am - timestamp < 4 days) {
            friday8am += 7 days;
        }
        return friday8am;
    }
}
