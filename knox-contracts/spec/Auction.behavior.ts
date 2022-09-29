import { ethers } from "hardhat";
import { BigNumber, ContractTransaction } from "ethers";
import { parseUnits } from "ethers/lib/utils";
const { provider } = ethers;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { fixedFromFloat, fixedToBn, fixedToNumber } from "@premia/utils";

import { expect } from "chai";

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import { Auction, IPremiaPool, IVaultMock, MockERC20 } from "../types";

import {
  accounts,
  almost,
  assert,
  math,
  time,
  types,
  KnoxUtil,
  PoolUtil,
  getEventArgs,
  uniswap,
} from "../test/utils";

interface AuctionBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
}

enum Status {
  UNINITIALIZED,
  INITIALIZED,
  FINALIZED,
  PROCESSED,
  CANCELLED,
}

const gasPrice = parseUnits("0.1", "gwei");

export function describeBehaviorOfAuction(
  { getKnoxUtil, getParams }: AuctionBehaviorArgs,
  skips?: string[]
) {
  describe("::Auction", () => {
    // Contract Utilities
    let knoxUtil: KnoxUtil;
    let poolUtil: PoolUtil;

    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Instances and Proxies
    let asset: MockERC20;
    let auction: Auction;
    let vault: IVaultMock;
    let pool: IPremiaPool;
    let weth: MockERC20;

    // Pool Utilities
    let uni: uniswap.IUniswap;

    const params = getParams();

    // max price is assumed to be the same unit as the vault collateral asset
    // e.g. WETH Vault -> WETH, DAI Vault -> DAI
    const maxPrice64x64 = fixedFromFloat(params.price.max);

    // min price is assumed to be the same unit as the vault collateral asset
    // e.g. WETH Vault -> WETH, DAI Vault -> DAI
    const minPrice64x64 = fixedFromFloat(params.price.min);

    before(async () => {
      knoxUtil = await getKnoxUtil();
      poolUtil = knoxUtil.poolUtil;

      signers = knoxUtil.signers;
      addresses = knoxUtil.addresses;

      asset = knoxUtil.asset;
      vault = knoxUtil.vaultUtil.vault;
      pool = knoxUtil.poolUtil.pool;
      auction = knoxUtil.auction;

      weth = poolUtil.weth;
      uni = knoxUtil.uni;

      await asset.connect(signers.buyer1).mint(addresses.buyer1, params.mint);
      await asset.connect(signers.buyer2).mint(addresses.buyer2, params.mint);
      await asset.connect(signers.buyer3).mint(addresses.buyer3, params.mint);
      await asset.connect(signers.vault).mint(addresses.vault, params.mint);

      await uni.tokenIn
        .connect(signers.buyer1)
        .mint(addresses.buyer1, params.mint);

      signers.vault = await accounts.impersonateVault(signers, addresses);
    });

    const setupSimpleAuction = async (processAuction: boolean) => {
      const [startTime, , epoch] = await knoxUtil.initializeAuction();

      await time.fastForwardToFriday8AM();
      await knoxUtil.initializeEpoch();
      await time.increaseTo(startTime);

      const [txs, totalContractsSold] =
        await utilizeAllContractsMarketOrdersOnly(epoch);

      const buyerOrderSize = totalContractsSold.div(3);

      if (processAuction) {
        await vault.connect(signers.keeper).processAuction();
      }

      const clearingPrice64x64 = await auction.clearingPrice64x64(epoch);

      return {
        txs,
        totalContractsSold,
        buyerOrderSize,
        clearingPrice: fixedToNumber(clearingPrice64x64),
      };
    };

    const setupAdvancedAuction = async (processAuction: boolean) => {
      const [startTime] = await knoxUtil.initializeAuction();

      let epoch = await vault.getEpoch();

      const totalContracts = await auction.getTotalContracts(epoch);

      const buyer1OrderSize = totalContracts.sub(totalContracts.div(10));
      const buyer2OrderSize = totalContracts;
      const buyer3OrderSize = totalContracts.div(10).mul(2);

      await asset
        .connect(signers.buyer1)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      await auction.addLimitOrder(epoch, maxPrice64x64, buyer1OrderSize);

      await asset
        .connect(signers.buyer2)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      await auction
        .connect(signers.buyer2)
        .addLimitOrder(epoch, minPrice64x64, buyer2OrderSize);

      await time.fastForwardToFriday8AM();
      await knoxUtil.initializeEpoch();

      await time.increaseTo(startTime);

      await asset
        .connect(signers.buyer3)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      const marketOrder = await auction
        .connect(signers.buyer3)
        .addMarketOrder(epoch, buyer3OrderSize, ethers.constants.MaxUint256);

      if (processAuction) {
        await vault.connect(signers.keeper).processAuction();
      }

      const clearingPrice64x64 = await auction.clearingPrice64x64(epoch);

      return {
        marketOrder,
        buyer1OrderSize,
        buyer2OrderSize,
        buyer3OrderSize,
        clearingPrice: fixedToNumber(clearingPrice64x64),
      };
    };

    const utilizeAllContractsMarketOrdersOnly = async (
      epoch: BigNumber
    ): Promise<[ContractTransaction[], BigNumber]> => {
      let totalContracts = await auction.getTotalContracts(epoch);
      const size = totalContracts.div(3).add(1);

      await asset
        .connect(signers.buyer1)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      const tx1 = await auction.addMarketOrder(
        epoch,
        size,
        ethers.constants.MaxUint256
      );

      await time.increase(100);

      await asset
        .connect(signers.buyer2)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      const tx2 = await auction
        .connect(signers.buyer2)
        .addMarketOrder(epoch, size, ethers.constants.MaxUint256);
      await time.increase(100);

      await asset
        .connect(signers.buyer3)
        .approve(addresses.auction, ethers.constants.MaxUint256);

      const tx3 = await auction
        .connect(signers.buyer3)
        .addMarketOrder(epoch, size, ethers.constants.MaxUint256);

      return [[tx1, tx2, tx3], totalContracts];
    };

    // calculates estimated refund in the vault collateral asset
    // e.g. WETH Vault -> WETH, DAI Vault -> DAI
    const estimateRefund = (
      size: BigNumber,
      fill: BigNumber,
      pricePaid: number,
      clearingPrice: number
    ) => {
      const paid = math.toUnits(pricePaid * math.bnToNumber(size));
      const cost = math.toUnits(clearingPrice * math.bnToNumber(fill));
      return paid.sub(cost);
    };

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should initialize Auction with correct state", async () => {
        await assert.equal(await auction.ERC20(), asset.address);
        await assert.equal(await auction.Vault(), addresses.vault);
        await assert.equal(await auction.WETH(), poolUtil.weth.address);
        await assert.bnEqual(await auction.getMinSize(), params.minSize);
      });
    });

    describe("#initialize(AuctionStorage.InitAuction)", () => {
      const underlyingPrice = params.underlying.oracle.price;
      const basePrice = params.base.oracle.price;

      const strike = underlyingPrice / basePrice;
      const strike64x64 = fixedFromFloat(strike);

      let timestamp: number;

      time.revertToSnapshotAfterEach(async () => {
        timestamp = await time.now();
      });

      it("should revert if caller is !vault", async () => {
        await expect(
          auction.initialize({
            epoch: 0,
            expiry: await time.getFriday8AM(timestamp),
            strike64x64: strike64x64,
            longTokenId: BigNumber.from("1"),
            startTime: BigNumber.from(timestamp + 60),
            endTime: BigNumber.from(timestamp + 86400),
          })
        ).to.be.revertedWith("!vault");
      });

      it("should revert if auction is already initialized", async () => {
        const initAuction = {
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp + 60),
          endTime: BigNumber.from(timestamp + 86400),
        };

        await auction.connect(signers.vault).initialize(initAuction);

        await expect(
          auction.connect(signers.vault).initialize(initAuction)
        ).to.be.revertedWith("status != uninitialized");
      });

      it("should revert if endTime <= startTime", async () => {
        await auction.connect(signers.vault).initialize({
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp + 60),
          endTime: BigNumber.from(timestamp + 60),
        });

        assert.equal(await auction.getStatus(0), Status.CANCELLED);
      });

      it("should revert if block.timestamp > startTime", async () => {
        await auction.connect(signers.vault).initialize({
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp),
          endTime: BigNumber.from(timestamp + 86400),
        });

        assert.equal(await auction.getStatus(0), Status.CANCELLED);
      });

      it("should revert if block.timestamp > expiry", async () => {
        await auction.connect(signers.vault).initialize({
          epoch: 0,
          expiry: (await time.getFriday8AM(timestamp)) - 86400,
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp),
          endTime: BigNumber.from(timestamp + 86400),
        });

        assert.equal(await auction.getStatus(0), Status.CANCELLED);
      });

      it("should revert if strike price == 0", async () => {
        await auction.connect(signers.vault).initialize({
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: BigNumber.from("0"),
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp + 60),
          endTime: BigNumber.from(timestamp + 86400),
        });

        assert.equal(await auction.getStatus(0), Status.CANCELLED);
      });

      it("should revert if long token id == 0", async () => {
        await auction.connect(signers.vault).initialize({
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("0"),
          startTime: BigNumber.from(timestamp + 60),
          endTime: BigNumber.from(timestamp + 86400),
        });

        assert.equal(await auction.getStatus(0), Status.CANCELLED);
      });

      it("should initialize new auction with correct state", async () => {
        const initAuction = {
          epoch: 0,
          expiry: await time.getFriday8AM(timestamp),
          strike64x64: strike64x64,
          longTokenId: BigNumber.from("1"),
          startTime: BigNumber.from(timestamp + 60),
          endTime: BigNumber.from(timestamp + 86400),
        };

        await auction.connect(signers.vault).initialize(initAuction);

        const data = await auction.getAuction(0);

        assert.equal(await auction.getStatus(0), Status.INITIALIZED);

        await assert.bnEqual(data.startTime, initAuction.startTime);
        await assert.bnEqual(data.endTime, initAuction.endTime);

        await assert.bnEqual(data.totalContracts, ethers.constants.Zero);
        await assert.bnEqual(data.totalContractsSold, ethers.constants.Zero);

        await assert.bnEqual(data.totalPremiums, ethers.constants.Zero);
        await assert.bnEqual(data.lastPrice64x64, ethers.constants.Zero);
        await assert.bnEqual(data.longTokenId, initAuction.longTokenId);
      });
    });

    describe("#setAuctionPrices(uint64,int128,int128)", () => {
      describe("if not initialized", () => {
        it("should revert", async () => {
          await expect(
            auction
              .connect(signers.vault)
              .setAuctionPrices(0, maxPrice64x64, minPrice64x64)
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if initialized", () => {
        let startTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, , epoch] = await knoxUtil.initializeAuction();
          await time.increaseTo(startTime);
        });

        it("should revert if caller is !vault", async () => {
          await expect(
            auction.setAuctionPrices(epoch, maxPrice64x64, minPrice64x64)
          ).to.be.revertedWith("!vault");
        });

        it("should set last price to int128.max if auction is cancelled (max price == 0, min price == 0, max price < min price)", async () => {
          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, 0, fixedFromFloat(params.price.min));

          assert.bnEqual(
            await auction.lastPrice64x64(epoch),
            BigNumber.from("170141183460469231731687303715884105727") // max int128
          );
        });

        it("should finalize auction if maxPrice64x64 >= minPrice64x64", async () => {
          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, minPrice64x64, maxPrice64x64);

          assert.equal(await auction.getStatus(epoch), Status.CANCELLED);
        });

        it("should finalize auction if maxPrice64x64 <= 0", async () => {
          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, 0, minPrice64x64);

          assert.equal(await auction.getStatus(epoch), Status.CANCELLED);
        });

        it("should finalize auction if minPrice64x64 <= 0", async () => {
          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, maxPrice64x64, 0);

          assert.equal(await auction.getStatus(epoch), Status.CANCELLED);
        });

        it("should set correct auction prices", async () => {
          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, maxPrice64x64, minPrice64x64);

          const data = await auction.getAuction(epoch);

          await assert.bnEqual(data.maxPrice64x64, maxPrice64x64);
          await assert.bnEqual(data.minPrice64x64, minPrice64x64);
        });
      });
    });

    describe("#setExchangeHelper(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(
          auction.setExchangeHelper(addresses.lp1)
        ).to.be.revertedWith("Ownable: sender must be owner");
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          auction
            .connect(signers.deployer)
            .setExchangeHelper(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          auction
            .connect(signers.deployer)
            .setExchangeHelper(addresses.exchange)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(
          auction.connect(signers.deployer).setExchangeHelper(addresses.lp1)
        )
          .to.emit(auction, "ExchangeHelperSet")
          .withArgs(addresses.exchange, addresses.lp1, addresses.deployer);
      });
    });

    describe("#priceCurve64x64(uint64)", () => {
      describe("if not initialized", () => {
        it("should revert", async () => {
          await expect(auction.priceCurve64x64(0)).to.be.reverted;
        });
      });

      describe("else if initialized", () => {
        let startTime: BigNumber;
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, endTime, epoch] = await knoxUtil.initializeAuction();

          await auction
            .connect(signers.vault)
            .setAuctionPrices(epoch, maxPrice64x64, minPrice64x64);
        });

        it("should return max price", async () => {
          const priceBeforeAuctionStart = fixedToNumber(
            await auction.priceCurve64x64(epoch)
          );

          assert.equal(priceBeforeAuctionStart, fixedToNumber(maxPrice64x64));

          await time.increaseTo(startTime);
          const priceAtAuctionStart = fixedToNumber(
            await auction.priceCurve64x64(epoch)
          );

          assert.equal(priceAtAuctionStart, fixedToNumber(maxPrice64x64));
        });

        it("should return min price", async () => {
          await time.increaseTo(endTime);
          assert.bnEqual(await auction.priceCurve64x64(epoch), minPrice64x64);
        });
      });
    });

    describe("#addLimitOrder(uint64,int128,uint256)", () => {
      describe("if not initialized", () => {
        it("should revert", async () => {
          await expect(
            auction.addLimitOrder(
              0,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if auction has not started", () => {
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, endTime, epoch] = await knoxUtil.initializeAuction();
        });

        it("should revert if auction expires", async () => {
          await time.increaseTo(endTime.add(1));

          await expect(
            auction.addLimitOrder(
              epoch,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("auction has ended");
        });

        it("should revert if order size is below min size", async () => {
          await expect(
            auction.addLimitOrder(
              epoch,
              fixedFromFloat(params.price.max),
              parseUnits("1", params.collateral.decimals - 2)
            )
          ).to.be.revertedWith("size < minimum");
        });

        it("should emit OrderAdded event if successful", async () => {
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const price = fixedFromFloat(params.price.max);

          await expect(auction.addLimitOrder(epoch, price, params.size))
            .to.emit(auction, "OrderAdded")
            .withArgs(0, 1, addresses.buyer1, price, params.size, true);
        });

        it("should send funds to Auction if successful", async () => {
          const auctionBalanceBefore = await asset.balanceOf(addresses.auction);
          const buyerBalanceBefore = await asset.balanceOf(addresses.buyer1);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          const auctionBalanceAfter = await asset.balanceOf(addresses.auction);
          const buyerBalanceAfter = await asset.balanceOf(addresses.buyer1);

          const cost = math.bnToNumber(params.size) * params.price.max;

          assert.equal(
            math.bnToNumber(auctionBalanceAfter.sub(auctionBalanceBefore)),
            cost
          );

          assert.equal(
            math.bnToNumber(buyerBalanceBefore.sub(buyerBalanceAfter)),
            cost
          );
        });

        it("should add order to orderbook if successful", async () => {
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const tx = await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          const args = await getEventArgs(tx, "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, BigNumber.from("1"));
          await assert.bnEqual(
            order.price64x64,
            fixedFromFloat(params.price.max)
          );
          await assert.bnEqual(order.size, params.size);
          await assert.equal(order.buyer, addresses.buyer1);
        });

        it("should add epoch to buyer if successful", async () => {
          assert.isEmpty(await auction.getEpochsByBuyer(addresses.buyer1));

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          const epochByBuyer = await auction.getEpochsByBuyer(addresses.buyer1);

          assert.equal(epochByBuyer.length, 1);
          assert.bnEqual(epochByBuyer[0], epoch);
        });

        if (params.collateral.name === "wETH") {
          it("should send credit to buyer if they send too much ETH", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const auctionWETHBalanceBefore = await weth.balanceOf(
              addresses.auction
            );

            const buyer1WETHBalanceBefore = await weth.balanceOf(
              addresses.buyer1
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            const expectedCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            const ethSent = expectedCost.mul(2);

            const tx = await auction.addLimitOrder(
              epoch,
              fixedFromFloat(params.price.max),
              params.size,
              { value: ethSent, gasPrice }
            );
            const receipt = await tx.wait();
            const gasFee = receipt.gasUsed.mul(gasPrice);

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionWETHBalanceAfter = await weth.balanceOf(
              addresses.auction
            );

            const buyer1WETHBalanceAfter = await weth.balanceOf(
              addresses.buyer1
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            almost(
              auctionWETHBalanceAfter.sub(auctionWETHBalanceBefore),
              expectedCost
            );

            almost(buyer1WETHBalanceAfter, buyer1WETHBalanceBefore);

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter).sub(gasFee),
              expectedCost
            );
          });

          it("should transfer remainder if buyer does not send enough ETH", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const auctionWETHBalanceBefore = await weth.balanceOf(
              addresses.auction
            );

            const buyer1WETHBalanceBefore = await weth.balanceOf(
              addresses.buyer1
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            const expectedCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            const ethSent = expectedCost.div(2);

            const tx = await auction.addLimitOrder(
              epoch,
              fixedFromFloat(params.price.max),
              params.size,
              { value: ethSent, gasPrice }
            );
            const receipt = await tx.wait();
            const gasFee = receipt.gasUsed.mul(gasPrice);

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionWETHBalanceAfter = await weth.balanceOf(
              addresses.auction
            );

            const buyer1WETHBalanceAfter = await weth.balanceOf(
              addresses.buyer1
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            almost(
              auctionWETHBalanceAfter.sub(auctionWETHBalanceBefore),
              expectedCost
            );

            almost(
              buyer1WETHBalanceBefore.sub(buyer1WETHBalanceAfter),
              expectedCost.sub(ethSent)
            );

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter).sub(gasFee),
              ethSent
            );
          });
        } else {
          it("should revert if collateral != wETH", async () => {
            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            await expect(
              auction.addLimitOrder(
                epoch,
                fixedFromFloat(params.price.max),
                params.size,
                { value: params.size }
              )
            ).to.be.revertedWith("collateral != wETH");
          });
        }
      });

      describe("else if auction has started", () => {
        let startTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, , epoch] = await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should check if auction is finalized", async () => {
          await time.increaseTo(startTime);

          const totalContracts = await auction.getTotalContracts(epoch);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            totalContracts
          );

          assert.equal(await auction.getStatus(epoch), Status.FINALIZED);
        });
      });

      describe("else if finalized", () => {
        time.revertToSnapshotAfterEach(async () => {
          const [, endTime, epoch] = await knoxUtil.initializeAuction();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(endTime.add(1));
          await auction.finalizeAuction(epoch);
        });

        it("should revert", async () => {
          await expect(
            auction.addLimitOrder(
              0,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(
            auction.addLimitOrder(
              0,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should revert", async () => {
          await expect(
            auction.addLimitOrder(
              0,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("status != initialized");
        });
      });
    });

    describe("#swapAndAddLimitOrder(SwapArgs,uint64,int128,uint256)", () => {
      describe("else if auction has not started", () => {
        let epoch: BigNumber;
        let tokenIn: MockERC20;
        let tokenOut: MockERC20;
        let path: string[];

        time.revertToSnapshotAfterEach(async () => {
          [, , epoch] = await knoxUtil.initializeAuction();

          tokenIn = uni.tokenIn;

          tokenOut = params.isCall
            ? poolUtil.underlyingAsset
            : poolUtil.baseAsset;

          path =
            tokenOut.address === weth.address
              ? [tokenIn.address, weth.address]
              : [tokenIn.address, weth.address, tokenOut.address];
        });

        it("should revert if buyer sends ETH and tokenIn !== wETH", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const expectedCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const amountOutMin = expectedCost;

          const [amountIn] = await uni.router.getAmountsIn(amountOutMin, path);

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            amountIn,
            amountOutMin,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends partial amount of tokenIn needed to execute order, remaining collateral tokens are transferred to auction
          const tx = auction.connect(signers.buyer1).swapAndAddLimitOrder(
            {
              tokenIn: tokenIn.address,
              amountInMax: amountIn,
              amountOutMin: amountOutMin,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.buyer1,
            },
            epoch,
            fixedFromFloat(params.price.max),
            params.size,
            { value: amountIn }
          );

          await expect(tx).to.be.revertedWith("tokenIn != wETH");
        });

        if (params.collateral.name !== "wETH") {
          it("should execute limit order using ETH only", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const expectedCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            path = [weth.address, tokenOut.address];

            const [amountOut] = await uni.router.getAmountsIn(
              expectedCost,
              path
            );

            const amountInMax = amountOut.mul(120).div(100);

            const iface = new ethers.utils.Interface(uniswap.abi);

            const data = iface.encodeFunctionData("swapTokensForExactTokens", [
              amountOut,
              amountInMax,
              path,
              addresses.exchange,
              (await time.now()) + 86400,
            ]);

            const auctionETHBalanceBefore = await provider.getBalance(
              addresses.auction
            );

            const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
              addresses.buyer1
            );

            await auction.connect(signers.buyer1).swapAndAddLimitOrder(
              {
                tokenIn: weth.address,
                amountInMax: 0,
                amountOutMin: amountOut,
                callee: uni.router.address,
                allowanceTarget: uni.router.address,
                data,
                refundAddress: addresses.buyer1,
              },
              epoch,
              fixedFromFloat(params.price.max),
              params.size,
              { value: amountInMax }
            );

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionETHBalanceAfter = await provider.getBalance(
              addresses.auction
            );

            const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
              addresses.buyer1
            );

            almost(auctionETHBalanceAfter, auctionETHBalanceBefore);

            almost(
              auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
              expectedCost
            );

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter),
              amountInMax
            );

            almost(buyer1TokenOutBalanceAfter, buyer1TokenOutBalanceBefore);
          });
        }

        it("should execute limit order using collateral and non-collateral ERC20 token", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const expectedCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const amountOutMin = expectedCost.div(2);

          const [amountIn] = await uni.router.getAmountsIn(amountOutMin, path);

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            amountIn,
            amountOutMin,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const auctionTokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.buyer1
          );

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await tokenOut
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends partial amount of tokenIn needed to execute order, remaining collateral tokens are transferred to auction
          await auction.connect(signers.buyer1).swapAndAddLimitOrder(
            {
              tokenIn: tokenIn.address,
              amountInMax: amountIn,
              amountOutMin: amountOutMin,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.buyer1,
            },
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, addresses.buyer1);

          const auctionTokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.buyer1
          );

          almost(auctionTokenInBalanceAfter, auctionTokenInBalanceBefore);

          almost(
            auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
            expectedCost
          );

          almost(
            buyer1TokenInBalanceBefore.sub(buyer1TokenInBalanceAfter),
            amountIn
          );

          // buyer1 should only send amount remaining in collateral tokens after swapping
          almost(
            buyer1TokenOutBalanceBefore.sub(buyer1TokenOutBalanceAfter),
            expectedCost.sub(amountOutMin)
          );
        });

        it("should execute limit order using non-collateral ERC20 token only", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const expectedCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const amountOutMin = expectedCost.mul(2);

          const [amountIn] = await uni.router.getAmountsIn(amountOutMin, path);

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            amountIn,
            amountOutMin,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const auctionTokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.buyer1
          );

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends double the amount of tokenIn needed to execute order
          await auction.connect(signers.buyer1).swapAndAddLimitOrder(
            {
              tokenIn: tokenIn.address,
              amountInMax: amountIn,
              amountOutMin: amountOutMin,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.buyer1,
            },
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, addresses.buyer1);

          const auctionTokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.buyer1
          );

          almost(auctionTokenInBalanceAfter, auctionTokenInBalanceBefore);

          almost(
            auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
            expectedCost
          );

          almost(
            buyer1TokenInBalanceBefore.sub(buyer1TokenInBalanceAfter),
            amountIn
          );

          // buyer1 should receive amount overpaid
          almost(
            buyer1TokenOutBalanceAfter.sub(buyer1TokenOutBalanceBefore),
            amountOutMin.sub(expectedCost)
          );
        });
      });
    });

    describe("#cancelLimitOrder(uint64,uint256)", () => {
      describe("if not initialized", () => {
        it("should revert", async () => {
          await expect(
            auction.addLimitOrder(
              0,
              fixedFromFloat(params.price.max),
              params.size
            )
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if auction has not started", () => {
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, endTime, epoch] = await knoxUtil.initializeAuction();
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );
        });

        it("should revert if auction expires", async () => {
          await time.increaseTo(endTime);
          await expect(auction.cancelLimitOrder(epoch, 1)).to.be.revertedWith(
            "auction has ended"
          );
        });

        it("should revert if order id is invalid", async () => {
          await expect(auction.cancelLimitOrder(epoch, 0)).to.be.revertedWith(
            "invalid order id"
          );
        });

        it("should revert if order is not in orderbook", async () => {
          await expect(auction.cancelLimitOrder(epoch, 2)).to.be.revertedWith(
            "order does not exist"
          );
        });

        it("should revert if buyer != sender", async () => {
          await expect(
            auction.connect(signers.buyer2).cancelLimitOrder(epoch, 1)
          ).to.be.revertedWith("buyer != msg.sender");
        });

        it("should issue refund if successful", async () => {
          const cost = math.bnToNumber(params.size) * params.price.max;

          const auctionBalanceBefore = await asset.balanceOf(addresses.auction);
          const buyerBalanceBefore = await asset.balanceOf(addresses.buyer1);

          await auction.cancelLimitOrder(epoch, 1);

          const auctionBalanceAfter = await asset.balanceOf(addresses.auction);
          const buyerBalanceAfter = await asset.balanceOf(addresses.buyer1);

          assert.equal(
            math.bnToNumber(auctionBalanceBefore.sub(auctionBalanceAfter)),
            cost
          );

          assert.equal(
            math.bnToNumber(buyerBalanceAfter.sub(buyerBalanceBefore)),
            cost
          );
        });

        it("should remove order from orderbook if successful", async () => {
          await auction.cancelLimitOrder(epoch, 1);

          const order = await auction.getOrderById(epoch, 1);

          await assert.bnEqual(order.id, ethers.constants.Zero);
          await assert.bnEqual(order.price64x64, ethers.constants.Zero);
          await assert.bnEqual(order.size, ethers.constants.Zero);
          await assert.equal(order.buyer, ethers.constants.AddressZero);
        });

        it("should remove claim from buyer if successful", async () => {
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          let epochByBuyer = await auction.getEpochsByBuyer(addresses.buyer1);
          assert.equal(epochByBuyer.length, 1);

          await auction.cancelLimitOrder(epoch, 1);

          epochByBuyer = await auction.getEpochsByBuyer(addresses.buyer1);
          assert.isEmpty(epochByBuyer);
        });
      });

      describe("else if auction has started", () => {
        let startTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, , epoch] = await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should check if auction is finalized", async () => {
          const totalContracts = await auction.getTotalContracts(epoch);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            totalContracts
          );

          await asset
            .connect(signers.buyer2)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer2)
            .addLimitOrder(
              epoch,
              fixedFromFloat(params.price.max),
              totalContracts
            );

          await time.increaseTo(startTime);
          assert.equal(await auction.getStatus(epoch), Status.INITIALIZED);

          // Buyer 2 cancels order but utilization is >= 100%
          await auction.connect(signers.buyer1).cancelLimitOrder(epoch, 1);

          assert.equal(await auction.getStatus(epoch), Status.FINALIZED);
        });
      });

      describe("else if finalized", () => {
        time.revertToSnapshotAfterEach(async () => {
          const [, endTime, epoch] = await knoxUtil.initializeAuction();

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(endTime.add(1));
          await auction.finalizeAuction(epoch);
        });

        it("should revert", async () => {
          await expect(auction.cancelLimitOrder(0, 1)).to.be.revertedWith(
            "status != initialized"
          );
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(auction.cancelLimitOrder(0, 1)).to.be.revertedWith(
            "status != initialized"
          );
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should revert", async () => {
          await expect(auction.cancelLimitOrder(0, 1)).to.be.revertedWith(
            "status != initialized"
          );
        });
      });
    });

    describe("#addMarketOrder(uint64,uint256)", () => {
      describe("if not initialized", () => {
        it("should revert", async () => {
          await expect(
            auction.addMarketOrder(0, params.size, ethers.constants.MaxUint256)
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if auction has not started", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should revert", async () => {
          await expect(
            auction.addMarketOrder(0, params.size, ethers.constants.MaxUint256)
          ).to.be.revertedWith("auction not started");
        });
      });

      describe("else if auction has started", () => {
        let startTime: BigNumber;
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, , epoch] = await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(startTime);
        });

        it("should revert if auction has ended", async () => {
          it("should revert", async () => {
            await time.increaseTo(endTime);

            await expect(
              auction.addMarketOrder(
                0,
                params.size,
                ethers.constants.MaxUint256
              )
            ).to.be.revertedWith("auction has ended");
          });
        });

        it("should revert if order size is below min size", async () => {
          await expect(
            auction.addMarketOrder(
              epoch,
              parseUnits("1", params.collateral.decimals - 2),
              ethers.constants.MaxUint256
            )
          ).to.be.revertedWith("size < minimum");
        });

        it("should set the totalContracts equal to Vault ERC20 balance if totalContracts is unset", async () => {
          let totalContracts = await auction.getTotalContracts(epoch);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addMarketOrder(
            epoch,
            params.size,
            ethers.constants.MaxUint256
          );
          const data = await auction.getAuction(epoch);
          await assert.bnEqual(data.totalContracts, totalContracts);
        });

        it("should emit OrderAdded event if successful", async () => {
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const tx = await auction.addMarketOrder(
            epoch,
            params.size,
            ethers.constants.MaxUint256
          );
          const args = await getEventArgs(tx, "OrderAdded");

          await expect(tx).to.emit(auction, "OrderAdded").withArgs(
            0,
            1,
            addresses.buyer1,
            // Exact price depends on the time the tx was settled
            args.price64x64,
            params.size,
            false
          );
        });

        it("should send funds to Auction if successful", async () => {
          const auctionBalanceBefore = await asset.balanceOf(addresses.auction);
          const buyerBalanceBefore = await asset.balanceOf(addresses.buyer1);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const tx = await auction.addMarketOrder(
            epoch,
            params.size,
            ethers.constants.MaxUint256
          );
          const args = await getEventArgs(tx, "OrderAdded");
          const cost = math.bnToNumber(
            params.size
              .mul(fixedToBn(args.price64x64))
              .div((10 ** params.collateral.decimals).toString())
          );

          const auctionBalanceAfter = await asset.balanceOf(addresses.auction);
          const buyerBalanceAfter = await asset.balanceOf(addresses.buyer1);

          assert.equal(
            math.bnToNumber(auctionBalanceAfter.sub(auctionBalanceBefore)),
            cost
          );

          assert.equal(
            math.bnToNumber(buyerBalanceBefore.sub(buyerBalanceAfter)),
            cost
          );
        });

        it("should add order to orderbook if successful", async () => {
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const tx = await auction.addMarketOrder(
            epoch,
            params.size,
            ethers.constants.MaxUint256
          );
          const args = await getEventArgs(tx, "OrderAdded");

          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, BigNumber.from("1"));
          // Exact price depends on the time the tx was settled
          await assert.equal(order.price64x64.toString(), args.price64x64);
          await assert.bnEqual(order.size, params.size);
          await assert.equal(order.buyer, addresses.buyer1);
        });

        it("should add epoch to buyer if successful", async () => {
          assert.isEmpty(await auction.getEpochsByBuyer(addresses.buyer1));

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addMarketOrder(
            epoch,
            params.size,
            ethers.constants.MaxUint256
          );

          const epochByBuyer = await auction.getEpochsByBuyer(addresses.buyer1);

          assert.equal(epochByBuyer.length, 1);
          assert.bnEqual(epochByBuyer[0], epoch);
        });

        if (params.collateral.name === "wETH") {
          it("should send credit to buyer if they send too much ETH", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const auctionWETHBalanceBefore = await weth.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            const estimatedCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            const ethSent = estimatedCost.mul(2);

            const tx = await auction.addMarketOrder(
              epoch,
              params.size,
              ethers.constants.MaxUint256,
              { value: ethSent, gasPrice }
            );

            const args = await getEventArgs(tx, "OrderAdded");
            const expectedCost = params.size
              .mul(fixedToBn(args.price64x64))
              .div((10 ** params.collateral.decimals).toString());

            const receipt = await tx.wait();
            const gasFee = receipt.gasUsed.mul(gasPrice);

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionWETHBalanceAfter = await weth.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            almost(
              auctionWETHBalanceAfter.sub(auctionWETHBalanceBefore),
              expectedCost
            );

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter).sub(gasFee),
              expectedCost
            );
          });

          it("should transfer remainder if buyer does not send enough ETH", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const auctionWETHBalanceBefore = await weth.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            const estimatedCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            const ethSent = estimatedCost.div(2);

            const tx = await auction.addMarketOrder(
              epoch,
              params.size,
              ethers.constants.MaxUint256,
              { value: ethSent, gasPrice }
            );

            const args = await getEventArgs(tx, "OrderAdded");
            const expectedCost = params.size
              .mul(fixedToBn(args.price64x64))
              .div((10 ** params.collateral.decimals).toString());

            const receipt = await tx.wait();
            const gasFee = receipt.gasUsed.mul(gasPrice);

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionWETHBalanceAfter = await weth.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            almost(
              auctionWETHBalanceAfter.sub(auctionWETHBalanceBefore),
              expectedCost
            );

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter).sub(gasFee),
              ethSent
            );
          });
        } else {
          it("should revert if collateral != wETH", async () => {
            await asset
              .connect(signers.buyer1)
              .approve(addresses.auction, ethers.constants.MaxUint256);

            await expect(
              auction.addMarketOrder(
                epoch,
                params.size,
                ethers.constants.MaxUint256,
                { value: params.size }
              )
            ).to.be.revertedWith("collateral != wETH");
          });
        }
      });

      describe("else if finalized", () => {
        time.revertToSnapshotAfterEach(async () => {
          const [, endTime, epoch] = await knoxUtil.initializeAuction();

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            fixedFromFloat(params.price.max),
            params.size
          );

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(endTime.add(1));
          await auction.finalizeAuction(epoch);
        });

        it("should revert", async () => {
          await expect(
            auction.addMarketOrder(0, params.size, ethers.constants.MaxUint256)
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(
            auction.addMarketOrder(0, params.size, ethers.constants.MaxUint256)
          ).to.be.revertedWith("status != initialized");
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should revert", async () => {
          await expect(
            auction.addMarketOrder(0, params.size, ethers.constants.MaxUint256)
          ).to.be.revertedWith("status != initialized");
        });
      });
    });

    describe("#swapAndAddMarketOrder(SwapArgs,uint64,uint256,uint256)", () => {
      describe("else if auction has started", () => {
        let startTime: BigNumber;
        let epoch: BigNumber;
        let tokenIn: MockERC20;
        let tokenOut: MockERC20;
        let path: string[];

        time.revertToSnapshotAfterEach(async () => {
          [startTime, , epoch] = await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(startTime);

          tokenIn = uni.tokenIn;

          tokenOut = params.isCall
            ? poolUtil.underlyingAsset
            : poolUtil.baseAsset;

          path =
            tokenOut.address === weth.address
              ? [tokenIn.address, weth.address]
              : [tokenIn.address, weth.address, tokenOut.address];
        });

        it("should revert if buyer sends ETH and tokenIn !== wETH", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const expectedCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const [expectedInputAmount] = await uni.router.getAmountsIn(
            expectedCost,
            path
          );

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            expectedInputAmount,
            expectedCost,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends partial amount of tokenIn needed to execute order, remaining collateral tokens are transferred to auction
          const tx = auction.connect(signers.buyer1).swapAndAddMarketOrder(
            {
              tokenIn: tokenIn.address,
              amountInMax: expectedInputAmount,
              amountOutMin: expectedCost,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.buyer1,
            },
            epoch,
            params.size,
            ethers.constants.MaxUint256,
            { value: expectedInputAmount }
          );

          await expect(tx).to.be.revertedWith("tokenIn != wETH");
        });

        if (params.collateral.name !== "wETH") {
          it("should execute limit order using ETH only", async () => {
            let order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, ethers.constants.AddressZero);

            const maxCost = parseUnits(
              (math.bnToNumber(params.size) * params.price.max).toString()
            );

            path = [weth.address, tokenOut.address];

            const [amountOut] = await uni.router.getAmountsIn(maxCost, path);

            const amountInMax = amountOut.mul(120).div(100);

            const iface = new ethers.utils.Interface(uniswap.abi);

            const data = iface.encodeFunctionData("swapTokensForExactTokens", [
              amountOut,
              amountInMax,
              path,
              addresses.exchange,
              (await time.now()) + 86400,
            ]);

            const auctionETHBalanceBefore = await provider.getBalance(
              addresses.auction
            );

            const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceBefore = await provider.getBalance(
              addresses.buyer1
            );

            const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
              addresses.buyer1
            );

            const tx = await auction
              .connect(signers.buyer1)
              .swapAndAddMarketOrder(
                {
                  tokenIn: weth.address,
                  amountInMax: 0,
                  amountOutMin: amountOut,
                  callee: uni.router.address,
                  allowanceTarget: uni.router.address,
                  data,
                  refundAddress: addresses.buyer1,
                },
                epoch,
                params.size,
                ethers.constants.MaxUint256,
                { value: amountInMax }
              );

            const args = await getEventArgs(tx, "OrderAdded");
            const expectedCost = params.size
              .mul(fixedToBn(args.price64x64))
              .div((10 ** params.collateral.decimals).toString());

            order = await auction.getOrderById(epoch, 1);
            assert.equal(order.buyer, addresses.buyer1);

            const auctionETHBalanceAfter = await provider.getBalance(
              addresses.auction
            );

            const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
              addresses.auction
            );

            const buyer1ETHBalanceAfter = await provider.getBalance(
              addresses.buyer1
            );

            const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
              addresses.buyer1
            );

            almost(auctionETHBalanceAfter, auctionETHBalanceBefore);

            almost(
              auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
              expectedCost
            );

            almost(
              buyer1ETHBalanceBefore.sub(buyer1ETHBalanceAfter),
              amountInMax
            );

            almost(buyer1TokenOutBalanceAfter, buyer1TokenOutBalanceBefore);
          });
        }

        it("should execute limit order using collateral and non-collateral ERC20 token", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const maxCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const swapAmountOut = maxCost.div(2);

          const [expectedInputAmount] = await uni.router.getAmountsIn(
            swapAmountOut,
            path
          );

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            expectedInputAmount,
            swapAmountOut,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const auctionTokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.buyer1
          );

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await tokenOut
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends partial amount of tokenIn needed to execute order, remaining collateral tokens are transferred to auction
          const tx = await auction
            .connect(signers.buyer1)
            .swapAndAddMarketOrder(
              {
                tokenIn: tokenIn.address,
                amountInMax: expectedInputAmount,
                amountOutMin: swapAmountOut,
                callee: uni.router.address,
                allowanceTarget: uni.router.address,
                data,
                refundAddress: addresses.buyer1,
              },
              epoch,
              params.size,
              ethers.constants.MaxUint256
            );

          const args = await getEventArgs(tx, "OrderAdded");
          const expectedCost = params.size
            .mul(fixedToBn(args.price64x64))
            .div((10 ** params.collateral.decimals).toString());

          order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, addresses.buyer1);

          const auctionTokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.buyer1
          );

          almost(auctionTokenInBalanceAfter, auctionTokenInBalanceBefore);

          almost(
            auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
            expectedCost
          );

          almost(
            buyer1TokenInBalanceBefore.sub(buyer1TokenInBalanceAfter),
            expectedInputAmount
          );

          // buyer1 should only send amount remaining in collateral tokens after swapping
          almost(
            buyer1TokenOutBalanceBefore.sub(buyer1TokenOutBalanceAfter),
            expectedCost.sub(swapAmountOut)
          );
        });

        it("should execute limit order using non-collateral ERC20 token only", async () => {
          let order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, ethers.constants.AddressZero);

          const maxCost = parseUnits(
            (math.bnToNumber(params.size) * params.price.max).toString()
          );

          const swapAmountOut = maxCost.mul(2);

          const [expectedInputAmount] = await uni.router.getAmountsIn(
            swapAmountOut,
            path
          );

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            expectedInputAmount,
            swapAmountOut,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const auctionTokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.buyer1
          );

          await tokenIn
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          // buyer1 sends double the amount of tokenIn needed to execute order
          const tx = await auction
            .connect(signers.buyer1)
            .swapAndAddMarketOrder(
              {
                tokenIn: tokenIn.address,
                amountInMax: expectedInputAmount,
                amountOutMin: swapAmountOut,
                callee: uni.router.address,
                allowanceTarget: uni.router.address,
                data,
                refundAddress: addresses.buyer1,
              },
              epoch,
              params.size,
              ethers.constants.MaxUint256
            );

          const args = await getEventArgs(tx, "OrderAdded");
          const expectedCost = params.size
            .mul(fixedToBn(args.price64x64))
            .div((10 ** params.collateral.decimals).toString());

          order = await auction.getOrderById(epoch, 1);
          assert.equal(order.buyer, addresses.buyer1);

          const auctionTokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.auction
          );

          const auctionTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.auction
          );

          const buyer1TokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.buyer1
          );

          const buyer1TokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.buyer1
          );

          almost(auctionTokenInBalanceAfter, auctionTokenInBalanceBefore);

          almost(
            auctionTokenOutBalanceAfter.sub(auctionTokenOutBalanceBefore),
            expectedCost
          );

          almost(
            buyer1TokenInBalanceBefore.sub(buyer1TokenInBalanceAfter),
            expectedInputAmount
          );

          // buyer1 should receive amount overpaid
          almost(
            buyer1TokenOutBalanceAfter.sub(buyer1TokenOutBalanceBefore),
            swapAmountOut.sub(expectedCost)
          );
        });
      });
    });

    describe("#finalizeAuction(uint64)", () => {
      describe("if not initialized", () => {
        it("should not finalize auction", async () => {
          await auction.finalizeAuction(0);
          assert.isFalse(await auction.isFinalized(0));
        });
      });

      describe("else if auction has not started", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should not finalize auction", async () => {
          await auction.finalizeAuction(0);
          assert.isFalse(await auction.isFinalized(0));
        });
      });

      describe("else if auction has started", () => {
        let startTime: BigNumber;
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [startTime, endTime, epoch] = await knoxUtil.initializeAuction();
        });

        it("should emit AuctionStatusSet event if utilization == %100", async () => {
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(startTime);

          const [txs] = await utilizeAllContractsMarketOrdersOnly(epoch);

          await expect(txs[2])
            .to.emit(auction, "AuctionStatusSet")
            .withArgs(0, Status.FINALIZED);
        });

        it("should emit AuctionStatusSet event if auction time limit has expired", async () => {
          await time.increaseTo(endTime.add(1));
          const tx = await auction.finalizeAuction(epoch);
          await expect(tx)
            .to.emit(auction, "AuctionStatusSet")
            .withArgs(0, Status.FINALIZED);
        });

        it("should cancel auction if it has not been processed within 24 hours of end time", async () => {
          await time.increaseTo(endTime.add(86400));
          await auction.finalizeAuction(epoch);
          assert.equal(await auction.getStatus(0), Status.CANCELLED);
        });
      });

      describe("else if finalized", () => {
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, endTime, epoch] = await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
          await time.increaseTo(endTime.add(1));
          await auction.finalizeAuction(0);
        });

        it("should cancel auction if it has not been processed within 24 hours of end time", async () => {
          await time.increaseTo(endTime.add(86400));
          await auction.finalizeAuction(epoch);
          assert.equal(await auction.getStatus(0), Status.CANCELLED);
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should not finalize auction", async () => {
          await auction.finalizeAuction(0);
          assert.isFalse(await auction.isFinalized(0));
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should not finalize auction", async () => {
          await auction.finalizeAuction(0);
          assert.isFalse(await auction.isFinalized(0));
        });
      });
    });

    describe("#transferPremium(uint64)", () => {
      describe("if not finalized", () => {
        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).transferPremium(0)
          ).to.be.revertedWith("status != finalized");
        });
      });

      describe("else if utilization == 100%", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(false);
        });

        it("should revert if !vault", async () => {
          await expect(auction.transferPremium(0)).to.be.revertedWith("!vault");
        });

        it("should revert if premiums have been transferred", async () => {
          await auction.connect(signers.vault).transferPremium(0);

          await expect(
            auction.connect(signers.vault).transferPremium(0)
          ).to.be.revertedWith("premiums transferred");
        });

        it("should transfer premiums to Vault if successful", async () => {
          const auctionBalanceBefore = await asset.balanceOf(addresses.auction);
          const vaultBalanceBefore = await asset.balanceOf(addresses.vault);

          await auction.connect(signers.vault).transferPremium(0);
          const { totalPremiums } = await auction.getAuction(0);

          const auctionBalanceAfter = await asset.balanceOf(addresses.auction);
          const vaultBalanceAfter = await asset.balanceOf(addresses.vault);

          assert.bnEqual(
            auctionBalanceAfter,
            auctionBalanceBefore.sub(totalPremiums)
          );

          assert.bnEqual(
            vaultBalanceAfter,
            vaultBalanceBefore.add(totalPremiums)
          );
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).transferPremium(0)
          ).to.be.revertedWith("status != finalized");
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).transferPremium(0)
          ).to.be.revertedWith("status != finalized");
        });
      });
    });

    describe("#processAuction(uint64)", () => {
      describe("if not finalized", () => {
        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).transferPremium(0)
          ).to.be.revertedWith("status != finalized");
        });
      });

      describe("else if auction has no orders", () => {
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, endTime, epoch] = await knoxUtil.initializeAuction();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();

          await time.increaseTo(endTime.add(1));
          await auction.finalizeAuction(epoch);
        });

        it("should revert if !vault", async () => {
          await expect(auction.processAuction(0)).to.be.revertedWith("!vault");
        });

        it("should emit AuctionStatusSet event when processed", async () => {
          await expect(auction.connect(signers.vault).processAuction(0))
            .to.emit(auction, "AuctionStatusSet")
            .withArgs(0, Status.PROCESSED);
        });
      });

      describe("else if utilization == 100%", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(false);
        });

        it("should revert if premiums have not been transferred to Vault", async () => {
          await expect(
            auction.connect(signers.vault).processAuction(0)
          ).to.be.revertedWith("premiums not transferred");
        });

        it("should revert if long tokens have not been transferred to Auction", async () => {
          await auction.connect(signers.vault).transferPremium(0);
          await expect(
            auction.connect(signers.vault).processAuction(0)
          ).to.be.revertedWith("long tokens not transferred");
        });

        it("should emit AuctionStatusSet event when processed", async () => {
          await expect(vault.connect(signers.keeper).processAuction())
            .to.emit(auction, "AuctionStatusSet")
            .withArgs(0, Status.PROCESSED);
        });
      });

      describe("else if processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).processAuction(0)
          ).to.be.revertedWith("status != finalized");
        });
      });

      describe("else if cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await auction.connect(signers.vault).setAuctionPrices(0, 0, 0);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.vault).processAuction(0)
          ).to.be.revertedWith("status != finalized");
        });
      });
    });

    describe("#withdraw(uint64)", () => {
      let buyer1OrderSize1 = 40;
      let buyer1OrderSize2 = 1;
      let buyer2OrderSize = 20;
      let buyer3OrderSize = 10;

      const verifyBalancesAfterWithdraw = async (
        buyer: SignerWithAddress,
        estimatedRefund: BigNumber,
        estimatedFill: BigNumber,
        longTokenId: BigNumber,
        tolerance?: BigNumber
      ) => {
        const auctionERC20BalanceBefore = await asset.balanceOf(
          addresses.auction
        );

        const auctionERC1155BalanceBefore = await pool.balanceOf(
          addresses.auction,
          longTokenId
        );

        const buyerERC20BalanceBefore = await asset.balanceOf(buyer.address);
        const buyerERC1155BalanceBefore = await pool.balanceOf(
          buyer.address,
          longTokenId
        );

        await auction.connect(buyer).withdraw(0);

        const auctionERC20BalanceAfter = await asset.balanceOf(
          addresses.auction
        );

        const auctionERC1155BalanceAfter = await pool.balanceOf(
          addresses.auction,
          longTokenId
        );

        const buyerERC20BalanceAfter = await asset.balanceOf(buyer.address);

        const buyerERC1155BalanceAfter = await pool.balanceOf(
          buyer.address,
          longTokenId
        );

        almost(
          auctionERC20BalanceBefore.sub(auctionERC20BalanceAfter),
          estimatedRefund,
          tolerance
        );

        almost(
          buyerERC20BalanceAfter.sub(buyerERC20BalanceBefore),
          estimatedRefund,
          tolerance
        );

        almost(
          auctionERC1155BalanceBefore.sub(auctionERC1155BalanceAfter),
          estimatedFill,
          tolerance
        );

        almost(
          buyerERC1155BalanceAfter.sub(buyerERC1155BalanceBefore),
          estimatedFill,
          tolerance
        );
      };

      const fastForwardToHoldPeriodEnd = async (epoch: BigNumber) => {
        const { endTime } = await auction.getAuction(epoch);
        await time.increaseTo(endTime.add(86400));
      };

      describe("if not processed", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(false);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.buyer1).withdraw(0)
          ).to.be.revertedWith("status != processed || cancelled");
        });
      });

      describe("else if hold period has not ended", () => {
        time.revertToSnapshotAfterEach(async () => {
          await setupSimpleAuction(true);
        });

        it("should revert", async () => {
          await expect(
            auction.connect(signers.buyer1).withdraw(0)
          ).to.be.revertedWith("hold period has not ended");
        });
      });

      describe("else if cancelled", () => {
        let epoch: BigNumber;
        let longTokenId: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, , epoch] = await knoxUtil.initializeAuction();
          [, , longTokenId] = await vault.getOption(epoch);

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            maxPrice64x64,
            math.toUnits(buyer1OrderSize1)
          );
          await auction.addLimitOrder(
            epoch,
            minPrice64x64,
            math.toUnits(buyer1OrderSize2)
          );

          await asset
            .connect(signers.buyer2)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer2)
            .addLimitOrder(epoch, minPrice64x64, math.toUnits(buyer2OrderSize));

          await asset
            .connect(signers.buyer3)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer3)
            .addLimitOrder(epoch, maxPrice64x64, math.toUnits(buyer3OrderSize));

          await time.fastForwardToFriday8AM();

          // initialize next epoch
          // prices are unset, auction is cancelled
          await vault.connect(signers.keeper).initializeEpoch();
          await auction.connect(signers.vault).setAuctionPrices(epoch, 0, 0);
        });

        it("should send buyer1 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.max * buyer1OrderSize1 +
              params.price.min * buyer1OrderSize2
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer1,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer2 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.min * buyer2OrderSize
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer2,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer3 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.max * buyer3OrderSize
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer3,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });
      });

      describe("else if some orders are filled", () => {
        let advancedAuction;
        let longTokenId: BigNumber;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          advancedAuction = await setupAdvancedAuction(true);
          await fastForwardToHoldPeriodEnd(epoch);
          [, , longTokenId] = await vault.getOption(epoch);
        });

        it("should send buyer1 fill and refund", async () => {
          const estimatedRefund = estimateRefund(
            advancedAuction.buyer1OrderSize,
            advancedAuction.buyer1OrderSize,
            params.price.max,
            advancedAuction.clearingPrice
          );

          const estimatedFill = advancedAuction.buyer1OrderSize;

          await verifyBalancesAfterWithdraw(
            signers.buyer1,
            estimatedRefund,
            estimatedFill,
            longTokenId
          );
        });

        it("should send buyer2 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.min * math.bnToNumber(advancedAuction.buyer2OrderSize)
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer2,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer3 partial fill, and refund", async () => {
          const estimatedFill = advancedAuction.buyer3OrderSize.div(2);
          const args = await getEventArgs(
            advancedAuction.marketOrder,
            "OrderAdded"
          );

          const estimatedRefund = estimateRefund(
            advancedAuction.buyer3OrderSize,
            estimatedFill,
            fixedToNumber(args.price64x64),
            advancedAuction.clearingPrice
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer3,
            estimatedRefund,
            estimatedFill,
            longTokenId
          );
        });
      });

      describe("else if all orders are filled", () => {
        let simpleAuction;
        let longTokenId: BigNumber;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          simpleAuction = await setupSimpleAuction(true);
          await fastForwardToHoldPeriodEnd(epoch);
          [, , longTokenId] = await vault.getOption(epoch);
        });

        it("should send buyer1 fill and refund", async () => {
          const args = await getEventArgs(simpleAuction.txs[0], "OrderAdded");

          const estimatedRefund = estimateRefund(
            simpleAuction.buyerOrderSize,
            simpleAuction.buyerOrderSize,
            fixedToNumber(args.price64x64),
            simpleAuction.clearingPrice
          );

          const estimatedFill = simpleAuction.buyerOrderSize;

          await verifyBalancesAfterWithdraw(
            signers.buyer1,
            estimatedRefund,
            estimatedFill,
            longTokenId
          );
        });

        it("should send buyer2 fill and refund", async () => {
          const args = await getEventArgs(simpleAuction.txs[1], "OrderAdded");

          const estimatedRefund = estimateRefund(
            simpleAuction.buyerOrderSize,
            simpleAuction.buyerOrderSize,
            fixedToNumber(args.price64x64),
            simpleAuction.clearingPrice
          );

          const estimatedFill = simpleAuction.buyerOrderSize;

          await verifyBalancesAfterWithdraw(
            signers.buyer2,
            estimatedRefund,
            estimatedFill,
            longTokenId
          );
        });

        it("should send buyer3 fill only", async () => {
          const estimatedRefund = BigNumber.from(0);
          const estimatedFill = simpleAuction.buyerOrderSize;

          await verifyBalancesAfterWithdraw(
            signers.buyer3,
            estimatedRefund,
            estimatedFill,
            longTokenId,
            parseUnits("1", params.collateral.decimals - 3) // min tolerance
          );
        });
      });

      describe("else if options have expired ITM", () => {
        let advancedAuction;
        let spot: number;
        let underlyingPrice = params.underlying.oracle.price;
        let intrinsicValue = underlyingPrice * 0.5;
        let expiry: BigNumber;
        let longTokenId: BigNumber;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          advancedAuction = await setupAdvancedAuction(true);

          // Make sure options expire ITM
          spot = params.isCall
            ? underlyingPrice + intrinsicValue
            : underlyingPrice - intrinsicValue;

          await poolUtil.underlyingSpotPriceOracle.mock.latestAnswer.returns(
            spot
          );

          // fast-forward to maturity date
          [expiry, , longTokenId] = await vault.getOption(epoch);
          await time.increaseTo(expiry.add(1));
          await knoxUtil.processExpiredOptions();
        });

        it("should send buyer1 exercised amount for fill and refund", async () => {
          const estimatedFill = advancedAuction.buyer1OrderSize;

          let estimatedRefund = estimateRefund(
            advancedAuction.buyer1OrderSize,
            advancedAuction.buyer1OrderSize,
            params.price.max,
            advancedAuction.clearingPrice
          );

          let exercisedAmount = math.toUnits(
            math.bnToNumber(BigNumber.from(intrinsicValue), 8) *
              math.bnToNumber(estimatedFill)
          );

          if (params.isCall) {
            // convert to underlying amount
            exercisedAmount = exercisedAmount.div(
              math.bnToNumber(BigNumber.from(spot), 8)
            );
          }

          estimatedRefund = estimatedRefund.add(exercisedAmount);

          await verifyBalancesAfterWithdraw(
            signers.buyer1,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer2 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.min * math.bnToNumber(advancedAuction.buyer2OrderSize)
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer2,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer3 exercised amount for partial fill and refund", async () => {
          const estimatedFill = advancedAuction.buyer3OrderSize.div(2);

          let estimatedRefund = estimateRefund(
            advancedAuction.buyer3OrderSize,
            estimatedFill,
            advancedAuction.clearingPrice,
            advancedAuction.clearingPrice
          );

          let exercisedAmount = math.toUnits(
            math.bnToNumber(BigNumber.from(intrinsicValue), 8) *
              math.bnToNumber(estimatedFill)
          );

          if (params.isCall) {
            // convert to underlying amount
            exercisedAmount = exercisedAmount.div(
              math.bnToNumber(BigNumber.from(spot), 8)
            );
          }

          estimatedRefund = estimatedRefund.add(exercisedAmount);

          await verifyBalancesAfterWithdraw(
            signers.buyer3,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });
      });

      describe("else if options have expired ATM", () => {
        let advancedAuction;
        let expiry: BigNumber;
        let longTokenId: BigNumber;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          advancedAuction = await setupAdvancedAuction(true);

          // fast-forward to maturity date
          [expiry, , longTokenId] = await vault.getOption(epoch);
          await time.increaseTo(expiry.add(1));
          await knoxUtil.processExpiredOptions();
        });

        it("should send buyer1 refund for fill", async () => {
          const estimatedRefund = estimateRefund(
            advancedAuction.buyer1OrderSize,
            advancedAuction.buyer1OrderSize,
            params.price.max,
            advancedAuction.clearingPrice
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer1,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer2 refund, only", async () => {
          const estimatedRefund = math.toUnits(
            params.price.min * math.bnToNumber(advancedAuction.buyer2OrderSize)
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer2,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });

        it("should send buyer3 overpaid amount for partial fill and refund", async () => {
          const estimatedFill = advancedAuction.buyer3OrderSize.div(2);
          const args = await getEventArgs(
            advancedAuction.marketOrder,
            "OrderAdded"
          );

          const estimatedRefund = estimateRefund(
            advancedAuction.buyer3OrderSize,
            estimatedFill,
            fixedToNumber(args.price64x64),
            advancedAuction.clearingPrice
          );

          await verifyBalancesAfterWithdraw(
            signers.buyer3,
            estimatedRefund,
            BigNumber.from(0),
            longTokenId
          );
        });
      });

      describe("else", () => {
        let simpleAuction;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          simpleAuction = await setupSimpleAuction(true);
          await fastForwardToHoldPeriodEnd(epoch);
        });

        it("should remove tx1 from order book", async () => {
          await auction.withdraw(epoch);

          const args = await getEventArgs(simpleAuction.txs[0], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, ethers.constants.Zero);
          await assert.bnEqual(order.price64x64, ethers.constants.Zero);
          await assert.bnEqual(order.size, ethers.constants.Zero);
          await assert.equal(order.buyer, ethers.constants.AddressZero);
        });

        it("should remove tx2 from order book", async () => {
          await auction.connect(signers.buyer2).withdraw(epoch);

          const args = await getEventArgs(simpleAuction.txs[1], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, ethers.constants.Zero);
          await assert.bnEqual(order.price64x64, ethers.constants.Zero);
          await assert.bnEqual(order.size, ethers.constants.Zero);
          await assert.equal(order.buyer, ethers.constants.AddressZero);
        });

        it("should remove tx3 from order book", async () => {
          await auction.connect(signers.buyer3).withdraw(epoch);

          const args = await getEventArgs(simpleAuction.txs[2], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, ethers.constants.Zero);
          await assert.bnEqual(order.price64x64, ethers.constants.Zero);
          await assert.bnEqual(order.size, ethers.constants.Zero);
          await assert.equal(order.buyer, ethers.constants.AddressZero);
        });
      });
    });

    describe("#previewWithdraw(uint64)", () => {
      let buyer1OrderSize1 = 40;
      let buyer1OrderSize2 = 1;
      let buyer2OrderSize = 20;
      let buyer3OrderSize = 10;

      describe("if cancelled", () => {
        const underlyingPrice = params.underlying.oracle.price;
        const basePrice = params.base.oracle.price;

        const strike = underlyingPrice / basePrice;
        const strike64x64 = fixedFromFloat(strike);

        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          let timestamp = await time.now();
          const startTime = BigNumber.from(timestamp + 60);
          const endTime = BigNumber.from(timestamp + 86400);

          await auction.connect(signers.vault).initialize({
            epoch: epoch,
            expiry: await time.getFriday8AM(timestamp),
            strike64x64: strike64x64,
            longTokenId: BigNumber.from("1"),
            startTime: startTime,
            endTime: endTime,
          });

          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction.addLimitOrder(
            epoch,
            maxPrice64x64,
            math.toUnits(buyer1OrderSize1)
          );
          await auction.addLimitOrder(
            epoch,
            minPrice64x64,
            math.toUnits(buyer1OrderSize2)
          );

          await asset
            .connect(signers.buyer2)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer2)
            .addLimitOrder(epoch, minPrice64x64, math.toUnits(buyer2OrderSize));

          await asset
            .connect(signers.buyer3)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer3)
            .addLimitOrder(epoch, maxPrice64x64, math.toUnits(buyer3OrderSize));

          // auction prices are unset, auction is cancelled
          await auction.connect(signers.vault).setAuctionPrices(epoch, 0, 0);
        });

        it("should preview buyer1 refund, only", async () => {
          const estimatedRefund =
            params.price.max * buyer1OrderSize1 +
            params.price.min * buyer1OrderSize2;

          const [refund, fill] = await auction.callStatic[
            "previewWithdraw(uint64)"
          ](epoch);

          assert.isTrue(fill.isZero());
          assert.equal(math.bnToNumber(refund), estimatedRefund);
        });

        it("should preview buyer2 refund, only", async () => {
          const estimatedRefund = params.price.min * buyer2OrderSize;

          const [refund, fill] = await auction
            .connect(signers.buyer2)
            .callStatic["previewWithdraw(uint64)"](epoch);

          assert.isTrue(fill.isZero());
          assert.equal(math.bnToNumber(refund), estimatedRefund);
        });

        it("should preview buyer3 refund, only", async () => {
          const estimatedRefund = params.price.max * buyer3OrderSize;

          const [refund, fill] = await auction
            .connect(signers.buyer3)
            .callStatic["previewWithdraw(uint64)"](epoch);

          assert.isTrue(fill.isZero());
          assert.equal(math.bnToNumber(refund), estimatedRefund);
        });
      });

      describe("else if some orders are filled", () => {
        let advancedAuction;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          advancedAuction = await setupAdvancedAuction(false);
        });

        it("should preview buyer1 with fill and refund", async () => {
          const paid = math.toUnits(
            params.price.max * math.bnToNumber(advancedAuction.buyer1OrderSize)
          );

          const cost = math.toUnits(
            advancedAuction.clearingPrice *
              math.bnToNumber(advancedAuction.buyer1OrderSize)
          );

          const estimatedRefund = paid.sub(cost);

          const [refund, fill] = await auction
            .connect(signers.buyer1)
            .callStatic["previewWithdraw(uint64)"](epoch);

          almost(refund, estimatedRefund);
          almost(fill, advancedAuction.buyer1OrderSize);
        });

        it("should preview buyer2 with refund only", async () => {
          const estimatedRefund =
            params.price.min * math.bnToNumber(advancedAuction.buyer2OrderSize);

          const [refund, fill] = await auction
            .connect(signers.buyer2)
            .callStatic["previewWithdraw(uint64)"](epoch);

          assert.isTrue(fill.isZero());
          almost(refund, estimatedRefund);
        });

        it("should preview buyer3 with partial fill and refund", async () => {
          const estimatedFill = advancedAuction.buyer3OrderSize.div(2);
          const remainder = math.bnToNumber(
            advancedAuction.buyer3OrderSize.sub(estimatedFill)
          );

          const price = advancedAuction.clearingPrice;
          const paid = price * math.bnToNumber(advancedAuction.buyer3OrderSize);
          const cost = price * remainder;

          const estimatedRefund = paid - cost;

          const [refund, fill] = await auction
            .connect(signers.buyer3)
            .callStatic["previewWithdraw(uint64)"](epoch);

          almost(fill, estimatedFill);
          almost(refund, estimatedRefund);
        });
      });

      describe("else if all orders are filled", () => {
        let simpleAuction;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          simpleAuction = await setupSimpleAuction(true);
        });

        it("should preview buyer1 with fill and refund", async () => {
          const args = await getEventArgs(simpleAuction.txs[0], "OrderAdded");

          const estimatedRefund = estimateRefund(
            simpleAuction.buyerOrderSize,
            simpleAuction.buyerOrderSize,
            fixedToNumber(args.price64x64),
            simpleAuction.clearingPrice
          );

          const [refund, fill] = await auction.callStatic[
            "previewWithdraw(uint64)"
          ](epoch);

          almost(refund, estimatedRefund);
          almost(fill, simpleAuction.buyerOrderSize);
        });

        it("should preview buyer2 with fill and refund", async () => {
          const args = await getEventArgs(simpleAuction.txs[1], "OrderAdded");

          const estimatedRefund = estimateRefund(
            simpleAuction.buyerOrderSize,
            simpleAuction.buyerOrderSize,
            fixedToNumber(args.price64x64),
            simpleAuction.clearingPrice
          );

          const [refund, fill] = await auction
            .connect(signers.buyer2)
            .callStatic["previewWithdraw(uint64)"](epoch);

          almost(refund, estimatedRefund);
          almost(fill, simpleAuction.buyerOrderSize);
        });

        it("should preview buyer3 with fill only", async () => {
          const [refund, fill] = await auction
            .connect(signers.buyer3)
            .callStatic["previewWithdraw(uint64)"](epoch);

          almost(refund, 0, parseUnits("1", params.collateral.decimals - 3)); // min tolerance
          almost(fill, simpleAuction.buyerOrderSize);
        });
      });

      describe("else", () => {
        let simpleAuction;
        let epoch = BigNumber.from(0);

        time.revertToSnapshotAfterEach(async () => {
          simpleAuction = await setupSimpleAuction(true);
        });

        it("should not remove tx1 from order book", async () => {
          await auction["previewWithdraw(uint64)"](epoch);

          const args = await getEventArgs(simpleAuction.txs[0], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, args.id);
          await assert.bnEqual(order.price64x64, args.price64x64);
          await assert.bnEqual(order.size, args.size);
          await assert.equal(order.buyer, args.buyer);
        });

        it("should not remove tx2 from order book", async () => {
          await auction
            .connect(signers.buyer2)
            ["previewWithdraw(uint64)"](epoch);

          const args = await getEventArgs(simpleAuction.txs[1], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, args.id);
          await assert.bnEqual(order.price64x64, args.price64x64);
          await assert.bnEqual(order.size, args.size);
          await assert.equal(order.buyer, args.buyer);
        });

        it("should not remove tx3 from order book", async () => {
          await auction
            .connect(signers.buyer3)
            ["previewWithdraw(uint64)"](epoch);

          const args = await getEventArgs(simpleAuction.txs[2], "OrderAdded");
          const order = await auction.getOrderById(epoch, args.id);

          await assert.bnEqual(order.id, args.id);
          await assert.bnEqual(order.price64x64, args.price64x64);
          await assert.bnEqual(order.size, args.size);
          await assert.equal(order.buyer, args.buyer);
        });
      });
    });

    describe("#getTotalContracts(uint64)", () => {
      time.revertToSnapshotAfterEach(async () => {
        await knoxUtil.initializeAuction();
      });

      it("should return the total contracts available", async () => {
        let expectedTotalContracts =
          math.bnToNumber(params.mint) * (1 - params.reserveRate64x64);

        if (!params.isCall) {
          const price =
            params.underlying.oracle.price / params.base.oracle.price;

          expectedTotalContracts = expectedTotalContracts / price;
        }

        assert.equal(
          math.bnToNumber(await auction.getTotalContracts(0)),
          expectedTotalContracts
        );
      });
    });
  });
}
