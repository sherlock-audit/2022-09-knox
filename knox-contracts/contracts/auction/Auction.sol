// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@solidstate/contracts/introspection/ERC165Storage.sol";
import "@solidstate/contracts/utils/ReentrancyGuard.sol";

import "./AuctionInternal.sol";
import "./IAuction.sol";

/**
 * @title Knox Dutch Auction Contract
 * @dev deployed standalone and referenced by AuctionProxy
 */

contract Auction is AuctionInternal, IAuction, ReentrancyGuard {
    using ABDKMath64x64 for int128;
    using AuctionStorage for AuctionStorage.Layout;
    using EnumerableSet for EnumerableSet.UintSet;
    using ERC165Storage for ERC165Storage.Layout;
    using OrderBook for OrderBook.Index;
    using SafeERC20 for IERC20;

    constructor(
        bool isCall,
        address pool,
        address vault,
        address weth
    ) AuctionInternal(isCall, pool, vault, weth) {}

    /************************************************
     *  ADMIN
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function setExchangeHelper(address newExchangeHelper) external onlyOwner {
        AuctionStorage.Layout storage l = AuctionStorage.layout();

        require(newExchangeHelper != address(0), "address not provided");
        require(
            newExchangeHelper != address(l.Exchange),
            "new address equals old"
        );

        emit ExchangeHelperSet(
            address(l.Exchange),
            newExchangeHelper,
            msg.sender
        );

        l.Exchange = IExchangeHelper(newExchangeHelper);
    }

    /************************************************
     *  INITIALIZE AUCTION
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function initialize(AuctionStorage.InitAuction memory initAuction)
        external
        onlyVault
    {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[initAuction.epoch];

        require(
            auction.status == AuctionStorage.Status.UNINITIALIZED,
            "status != uninitialized"
        );

        if (
            initAuction.startTime >= initAuction.endTime ||
            block.timestamp > initAuction.startTime ||
            block.timestamp > initAuction.expiry ||
            initAuction.strike64x64 <= 0 ||
            initAuction.longTokenId <= 0
        ) {
            // the auction is cancelled if the start time is greater than or equal to
            // the end time, the current time is greater than the start time, or the
            // option parameters are invalid
            _cancel(l.auctions[initAuction.epoch], initAuction.epoch);
        } else {
            auction.status = AuctionStorage.Status.INITIALIZED;
            auction.expiry = initAuction.expiry;
            auction.strike64x64 = initAuction.strike64x64;
            auction.startTime = initAuction.startTime;
            auction.endTime = initAuction.endTime;
            auction.longTokenId = initAuction.longTokenId;
            emit AuctionStatusSet(initAuction.epoch, auction.status);
        }
    }

    /**
     * @inheritdoc IAuction
     */
    function setAuctionPrices(
        uint64 epoch,
        int128 maxPrice64x64,
        int128 minPrice64x64
    ) external onlyVault {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        require(
            AuctionStorage.Status.INITIALIZED == auction.status,
            "status != initialized"
        );

        // stores the auction max/ min prices
        auction.maxPrice64x64 = maxPrice64x64;
        auction.minPrice64x64 = minPrice64x64;

        if (
            auction.maxPrice64x64 <= 0 ||
            auction.minPrice64x64 <= 0 ||
            auction.maxPrice64x64 <= auction.minPrice64x64
        ) {
            // if either price is 0 or the max price is less than or equal to the min price,
            // the auction should always be cancelled.
            _cancel(l.auctions[epoch], epoch);
        }
    }

    /************************************************
     *  PRICING
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function lastPrice64x64(uint64 epoch) external view returns (int128) {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];
        return _lastPrice64x64(auction);
    }

    /**
     * @inheritdoc IAuction
     */
    function priceCurve64x64(uint64 epoch) external view returns (int128) {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];
        return _priceCurve64x64(auction);
    }

    /**
     * @inheritdoc IAuction
     */
    function clearingPrice64x64(uint64 epoch) external view returns (int128) {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];
        return _clearingPrice64x64(auction);
    }

    /************************************************
     *  PURCHASE
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function addLimitOrder(
        uint64 epoch,
        int128 price64x64,
        uint256 size
    ) external payable nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        _limitOrdersAllowed(auction);

        uint256 cost = _validateLimitOrder(l, price64x64, size);
        uint256 credited = _wrapNativeToken(cost);
        // an approve() by the msg.sender is required beforehand
        ERC20.safeTransferFrom(msg.sender, address(this), cost - credited);
        _addOrder(l, auction, epoch, price64x64, size, true);
    }

    /**
     * @inheritdoc IAuction
     */
    function swapAndAddLimitOrder(
        IExchangeHelper.SwapArgs calldata s,
        uint64 epoch,
        int128 price64x64,
        uint256 size
    ) external payable nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        _limitOrdersAllowed(auction);

        uint256 cost = _validateLimitOrder(l, price64x64, size);
        uint256 credited = _swapForPoolTokens(l.Exchange, s, address(ERC20));
        _transferAssets(credited, cost, msg.sender);
        _addOrder(l, auction, epoch, price64x64, size, true);
    }

    /**
     * @inheritdoc IAuction
     */
    function cancelLimitOrder(uint64 epoch, uint256 id) external nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        _limitOrdersAllowed(auction);

        require(id > 0, "invalid order id");

        OrderBook.Index storage orderbook = l.orderbooks[epoch];
        OrderBook.Data memory data = orderbook._getOrderById(id);

        require(data.buyer != address(0), "order does not exist");
        require(data.buyer == msg.sender, "buyer != msg.sender");

        orderbook._remove(id);
        l.epochsByBuyer[data.buyer].remove(epoch);

        if (block.timestamp >= auction.startTime) {
            _finalizeAuction(l, auction, epoch);
        }

        uint256 cost = data.price64x64.mulu(data.size);
        ERC20.safeTransfer(msg.sender, cost);

        emit OrderCanceled(epoch, id, msg.sender);
    }

    /**
     * @inheritdoc IAuction
     */
    function addMarketOrder(
        uint64 epoch,
        uint256 size,
        uint256 maxCost
    ) external payable nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        _marketOrdersAllowed(auction);

        (int128 price64x64, uint256 cost) =
            _validateMarketOrder(l, auction, size, maxCost);

        uint256 credited = _wrapNativeToken(cost);
        // an approve() by the msg.sender is required beforehand
        ERC20.safeTransferFrom(msg.sender, address(this), cost - credited);
        _addOrder(l, auction, epoch, price64x64, size, false);
    }

    /**
     * @inheritdoc IAuction
     */
    function swapAndAddMarketOrder(
        IExchangeHelper.SwapArgs calldata s,
        uint64 epoch,
        uint256 size,
        uint256 maxCost
    ) external payable nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        _marketOrdersAllowed(auction);

        (int128 price64x64, uint256 cost) =
            _validateMarketOrder(l, auction, size, maxCost);

        uint256 credited = _swapForPoolTokens(l.Exchange, s, address(ERC20));
        _transferAssets(credited, cost, msg.sender);
        _addOrder(l, auction, epoch, price64x64, size, false);
    }

    /************************************************
     *  WITHDRAW
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function withdraw(uint64 epoch) external nonReentrant {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        require(
            AuctionStorage.Status.PROCESSED == auction.status ||
                AuctionStorage.Status.CANCELLED == auction.status,
            "status != processed || cancelled"
        );

        if (AuctionStorage.Status.PROCESSED == auction.status) {
            // long tokens are withheld for 24 hours after the auction has been processed, otherwise
            // if a long position is exercised within 24 hours of the position being underwritten
            // the collateral from the position will be moved to the pools "free liquidity" queue.
            require(
                block.timestamp >= auction.processedTime + 24 hours,
                "hold period has not ended"
            );
        }

        _withdraw(l, epoch);
    }

    /**
     * @inheritdoc IAuction
     */
    function previewWithdraw(uint64 epoch) external returns (uint256, uint256) {
        return _previewWithdraw(epoch, msg.sender);
    }

    /**
     * @inheritdoc IAuction
     */
    function previewWithdraw(uint64 epoch, address buyer)
        external
        returns (uint256, uint256)
    {
        return _previewWithdraw(epoch, buyer);
    }

    /************************************************
     *  FINALIZE AUCTION
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function finalizeAuction(uint64 epoch) external {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        if (
            block.timestamp >= auction.endTime + 24 hours &&
            (auction.status == AuctionStorage.Status.INITIALIZED ||
                auction.status == AuctionStorage.Status.FINALIZED)
        ) {
            // cancel the auction if it has not been processed within 24 hours of the
            // auction end time so that buyers may withdraw their refunded amount
            _cancel(auction, epoch);
        } else if (
            block.timestamp > auction.startTime &&
            auction.status == AuctionStorage.Status.INITIALIZED
        ) {
            // finalize the auction only if the auction has started
            _finalizeAuction(l, auction, epoch);
        }
    }

    /**
     * @inheritdoc IAuction
     */
    function transferPremium(uint64 epoch)
        external
        onlyVault
        returns (uint256)
    {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        require(
            AuctionStorage.Status.FINALIZED == auction.status,
            "status != finalized"
        );

        require(auction.totalPremiums <= 0, "premiums transferred");

        uint256 totalPremiums =
            _lastPrice64x64(auction).mulu(auction.totalContractsSold);

        auction.totalPremiums = totalPremiums;
        ERC20.safeTransfer(address(Vault), totalPremiums);

        return auction.totalPremiums;
    }

    /**
     * @inheritdoc IAuction
     */
    function processAuction(uint64 epoch) external onlyVault {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];

        require(
            AuctionStorage.Status.FINALIZED == auction.status,
            "status != finalized"
        );

        uint256 totalContractsSold = auction.totalContractsSold;

        if (totalContractsSold > 0) {
            uint256 longTokenId = auction.longTokenId;

            uint256 longTokenBalance =
                Pool.balanceOf(address(this), longTokenId);

            require(auction.totalPremiums > 0, "premiums not transferred");

            require(
                longTokenBalance >= totalContractsSold,
                "long tokens not transferred"
            );
        }

        auction.processedTime = block.timestamp;
        auction.status = AuctionStorage.Status.PROCESSED;
        emit AuctionStatusSet(epoch, auction.status);
    }

    /************************************************
     *  VIEW
     ***********************************************/

    /**
     * @inheritdoc IAuction
     */
    function getAuction(uint64 epoch)
        external
        view
        returns (AuctionStorage.Auction memory)
    {
        return AuctionStorage._getAuction(epoch);
    }

    /**
     * @inheritdoc IAuction
     */
    function getEpochsByBuyer(address buyer)
        external
        view
        returns (uint64[] memory)
    {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        EnumerableSet.UintSet storage epochs = l.epochsByBuyer[buyer];

        uint64[] memory epochsByBuyer = new uint64[](epochs.length());

        unchecked {
            for (uint256 i; i < epochs.length(); i++) {
                epochsByBuyer[i] = uint64(epochs.at(i));
            }
        }

        return epochsByBuyer;
    }

    /**
     * @inheritdoc IAuction
     */
    function getMinSize() external view returns (uint256) {
        return AuctionStorage._getMinSize();
    }

    /**
     * @inheritdoc IAuction
     */
    function getOrderById(uint64 epoch, uint256 id)
        external
        view
        returns (OrderBook.Data memory)
    {
        return AuctionStorage._getOrderById(epoch, id);
    }

    /**
     * @inheritdoc IAuction
     */
    function getStatus(uint64 epoch)
        external
        view
        returns (AuctionStorage.Status)
    {
        return AuctionStorage._getStatus(epoch);
    }

    /**
     * @inheritdoc IAuction
     */
    function getTotalContracts(uint64 epoch) external view returns (uint256) {
        AuctionStorage.Layout storage l = AuctionStorage.layout();
        AuctionStorage.Auction storage auction = l.auctions[epoch];
        return _getTotalContracts(auction);
    }

    /**
     * @inheritdoc IAuction
     */
    function getTotalContractsSold(uint64 epoch)
        external
        view
        returns (uint256)
    {
        return AuctionStorage._getTotalContractsSold(epoch);
    }

    /**
     * @inheritdoc IAuction
     */
    function isCancelled(uint64 epoch) external view returns (bool) {
        return AuctionStorage._isCancelled(epoch);
    }

    /**
     * @inheritdoc IAuction
     */
    function isFinalized(uint64 epoch) external view returns (bool) {
        return AuctionStorage._isFinalized(epoch);
    }

    /************************************************
     *  ERC165 SUPPORT
     ***********************************************/

    /**
     * @inheritdoc IERC165
     */
    function supportsInterface(bytes4 interfaceId)
        external
        view
        returns (bool)
    {
        return ERC165Storage.layout().isSupportedInterface(interfaceId);
    }

    /************************************************
     *  ERC1155 SUPPORT
     ***********************************************/

    /**
     * @inheritdoc IERC1155Receiver
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @inheritdoc IERC1155Receiver
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
