// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./VaultInternal.sol";

/**
 * @title Knox Vault Admin Contract
 * @dev deployed standalone and referenced by VaultDiamond
 */

contract VaultAdmin is IVaultAdmin, VaultInternal {
    using ABDKMath64x64 for int128;
    using OptionMath for uint256;
    using SafeERC20 for IERC20;
    using VaultStorage for VaultStorage.Layout;

    int128 private constant ONE_64x64 = 0x10000000000000000;

    constructor(bool isCall, address pool) VaultInternal(isCall, pool) {}

    /************************************************
     *  ADMIN
     ***********************************************/

    /**
     * @inheritdoc IVaultAdmin
     */
    function setAuction(address newAuction) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newAuction != address(0), "address not provided");
        require(newAuction != address(l.Auction), "new address equals old");

        emit AuctionSet(l.epoch, address(l.Auction), newAuction, msg.sender);

        l.Auction = IAuction(newAuction);
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setAuctionWindowOffsets(
        uint256 newStartOffset,
        uint256 newEndOffset
    ) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newEndOffset > newStartOffset, "start offset > end offset");

        emit AuctionWindowOffsetsSet(
            l.epoch,
            l.startOffset,
            newStartOffset,
            l.endOffset,
            newEndOffset,
            msg.sender
        );

        l.startOffset = newStartOffset;
        l.endOffset = newEndOffset;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setDelta64x64(int128 newDelta64x64) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newDelta64x64 > 0, "delta <= 0");
        require(newDelta64x64 < ONE_64x64, "delta > 1");

        emit DeltaSet(l.epoch, l.delta64x64, newDelta64x64, msg.sender);

        l.delta64x64 = newDelta64x64;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setDeltaOffset64x64(int128 newDeltaOffset64x64)
        external
        onlyOwner
    {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newDeltaOffset64x64 > 0, "delta <= 0");
        require(newDeltaOffset64x64 < ONE_64x64, "delta > 1");

        emit DeltaSet(
            l.epoch,
            l.deltaOffset64x64,
            newDeltaOffset64x64,
            msg.sender
        );

        l.deltaOffset64x64 = newDeltaOffset64x64;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newFeeRecipient != address(0), "address not provided");
        require(newFeeRecipient != l.feeRecipient, "new address equals old");

        emit FeeRecipientSet(
            l.epoch,
            l.feeRecipient,
            newFeeRecipient,
            msg.sender
        );

        l.feeRecipient = newFeeRecipient;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setKeeper(address newKeeper) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newKeeper != address(0), "address not provided");
        require(newKeeper != address(l.keeper), "new address equals old");

        emit KeeperSet(l.epoch, l.keeper, newKeeper, msg.sender);

        l.keeper = newKeeper;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setPricer(address newPricer) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newPricer != address(0), "address not provided");
        require(newPricer != address(l.Pricer), "new address equals old");

        emit PricerSet(l.epoch, address(l.Pricer), newPricer, msg.sender);

        l.Pricer = IPricer(newPricer);
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setQueue(address newQueue) external onlyOwner {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newQueue != address(0), "address not provided");
        require(newQueue != address(l.Queue), "new address equals old");

        emit QueueSet(l.epoch, address(l.Queue), newQueue, msg.sender);

        l.Queue = IQueue(newQueue);
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setPerformanceFee64x64(int128 newPerformanceFee64x64)
        external
        onlyOwner
    {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newPerformanceFee64x64 < ONE_64x64, "fee > 1");

        emit PerformanceFeeSet(
            l.epoch,
            l.performanceFee64x64,
            newPerformanceFee64x64,
            msg.sender
        );

        l.performanceFee64x64 = newPerformanceFee64x64;
    }

    /**
     * @inheritdoc IVaultAdmin
     */
    function setWithdrawalFee64x64(int128 newWithdrawalFee64x64)
        external
        onlyOwner
    {
        VaultStorage.Layout storage l = VaultStorage.layout();
        require(newWithdrawalFee64x64 < ONE_64x64, "fee > 1");

        emit WithdrawalFeeSet(
            l.epoch,
            l.withdrawalFee64x64,
            newWithdrawalFee64x64,
            msg.sender
        );

        l.withdrawalFee64x64 = newWithdrawalFee64x64;
    }

    /************************************************
     *  INITIALIZE AUCTION
     ***********************************************/

    /**
     * @inheritdoc IVaultAdmin
     */
    function initializeAuction() external onlyKeeper {
        VaultStorage.Layout storage l = VaultStorage.layout();
        VaultStorage.Option memory option = _setOptionParameters(l);

        // auctions begin on Friday
        uint256 startTimestamp = _getFriday(block.timestamp);

        // offsets the start and end times by a fixed amount
        uint256 startTime = startTimestamp + l.startOffset;
        uint256 endTime = startTimestamp + l.endOffset;

        // resets withdrawal lock, reactivates when auction starts
        l.startTime = startTime;
        l.auctionProcessed = false;

        // initializes the auction using the option parameters and start/end times
        l.Auction.initialize(
            AuctionStorage.InitAuction(
                l.epoch,
                option.expiry,
                option.strike64x64,
                option.longTokenId,
                startTime,
                endTime
            )
        );
    }

    /************************************************
     *  INITIALIZE EPOCH
     ***********************************************/

    /**
     * @inheritdoc IVaultAdmin
     */
    function initializeEpoch() external onlyKeeper {
        VaultStorage.Layout storage l = VaultStorage.layout();

        // skips epoch 0 as there will be no net income, and the lastTotalAsset balance
        // will not be set
        if (l.epoch > 0) _collectPerformanceFee(l);

        // when the queue processes its deposits, it will send the enitre balance to
        // the vault in exchange for a pro-rata share of the vault tokens.
        l.Queue.processDeposits();

        // increment the epoch id
        l.epoch = l.epoch + 1;

        // sets the max/min auction prices
        _setAuctionPrices(l);
    }

    /************************************************
     *  PROCESS AUCTION
     ***********************************************/

    /**
     * @inheritdoc IVaultAdmin
     */
    function processAuction() external onlyKeeper {
        VaultStorage.Layout storage l = VaultStorage.layout();

        // stores the last total asset amount, this is effectively the amount of assets held
        // in the vault at the start of the auction
        l.lastTotalAssets = _totalAssets();

        uint64 lastEpoch = _lastEpoch(l);
        VaultStorage.Option memory lastOption = _lastOption(l);

        uint256 totalCollateralUsed;
        uint256 totalPremiums;

        bool cancelled = l.Auction.isCancelled(lastEpoch);
        bool finalized = l.Auction.isFinalized(lastEpoch);

        require(
            (!finalized && cancelled) || (finalized && !cancelled),
            "auction is not finalized nor cancelled"
        );

        if (finalized && !cancelled) {
            // transfers the premiums from the auction contract to the vault
            totalPremiums = l.Auction.transferPremium(lastEpoch);
            //fetches the total number of contracts sold during the auction
            uint256 totalContractsSold =
                l.Auction.getTotalContractsSold(lastEpoch);

            if (totalContractsSold > 0) {
                // calculates the total amount of collateral required to underwrite the contracts
                // sold during the auction
                totalCollateralUsed = totalContractsSold
                    .fromContractsToCollateral(
                    l.isCall,
                    l.underlyingDecimals,
                    l.baseDecimals,
                    lastOption.strike64x64
                );

                // approves the Premia pool to spend, the collateral amount + the reserves needed
                // to pay the APY fee
                ERC20.approve(
                    address(Pool),
                    totalCollateralUsed + _totalReserves()
                );

                // underwrites the contracts sold during the auction, the pool sends the short tokens
                // to the vault, and long tokens to the auction contract
                Pool.writeFrom(
                    address(this),
                    address(l.Auction),
                    lastOption.expiry,
                    lastOption.strike64x64,
                    totalContractsSold,
                    l.isCall
                );

                // the divestment timestamp is the time at which collateral locked in the Premia pool
                // will be moved into the pools "reserved liquidity" queue. if the divestment timestamp
                // is not set, collateral will remain in the "free liquidity" queue and could potentially
                // be used to underwrite a position without the directive of the vault. note, the minimum
                // amount of time the divestment timestamp can be set to is 24 hours after the position
                // has been underwritten.
                uint64 divestmentTimestamp = uint64(block.timestamp + 24 hours);
                Pool.setDivestmentTimestamp(divestmentTimestamp, l.isCall);
            }

            l.Auction.processAuction(lastEpoch);
        }

        // deactivates withdrawal lock
        l.auctionProcessed = true;

        emit AuctionProcessed(
            lastEpoch,
            totalCollateralUsed,
            _totalShortAsContracts(),
            totalPremiums
        );
    }
}
