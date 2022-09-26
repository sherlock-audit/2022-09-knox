import { ethers } from "hardhat";
const { provider } = ethers;
import { BigNumber } from "ethers";
import { fixedFromFloat, formatTokenId, TokenType } from "@premia/utils";

import { expect } from "chai";

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import {
  UNDERLYING_RESERVED_LIQ_TOKEN_ID,
  BASE_RESERVED_LIQ_TOKEN_ID,
} from "../constants";

import {
  Auction,
  IPremiaPool,
  IVaultMock,
  MockERC20,
  Queue,
  Pricer__factory,
} from "../types";

import {
  assert,
  time,
  types,
  KnoxUtil,
  PoolUtil,
  getEventArgs,
} from "../test/utils";

interface VaultMockBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
}

export function describeBehaviorOfVaultMock(
  { getKnoxUtil, getParams }: VaultMockBehaviorArgs,
  skips?: string[]
) {
  describe("::VaultMock", () => {
    // Contract Utilities
    let knoxUtil: KnoxUtil;
    let poolUtil: PoolUtil;

    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Instances and Proxies
    let asset: MockERC20;
    let queue: Queue;
    let auction: Auction;
    let vault: IVaultMock;
    let pool: IPremiaPool;

    let thisFriday: moment.Moment;
    let nextFriday: moment.Moment;

    const params = getParams();

    before(async () => {
      knoxUtil = await getKnoxUtil();
      poolUtil = knoxUtil.poolUtil;

      signers = knoxUtil.signers;
      addresses = knoxUtil.addresses;

      asset = knoxUtil.asset;
      vault = knoxUtil.vaultUtil.vault;
      pool = knoxUtil.poolUtil.pool;
      queue = knoxUtil.queue;
      auction = knoxUtil.auction;

      await asset
        .connect(signers.deployer)
        .mint(addresses.deployer, params.mint);
      await asset.connect(signers.buyer1).mint(addresses.buyer1, params.mint);
      await asset.connect(signers.lp1).mint(addresses.lp1, params.mint);
    });

    describe("__internal", () => {
      time.revertToSnapshotAfterEach(async () => {});

      describe("#_setOptionParameters()", () => {
        time.revertToSnapshotAfterEach(async () => {});

        it("should set parameters for next option", async () => {
          await vault.setOptionParameters();

          const epoch = await vault.getEpoch();
          const option = await vault.getOption(epoch);

          const nextWeek = (await time.now()) + 604800;
          const expectedExpiry = BigNumber.from(
            await time.getFriday8AM(nextWeek)
          );

          assert.bnEqual(option.expiry, expectedExpiry);

          const expectedStrike = fixedFromFloat(
            params.underlying.oracle.price / params.base.oracle.price
          );

          assert.bnEqual(option.strike64x64, expectedStrike);

          let longTokenType: TokenType;
          let shortTokenType: TokenType;

          longTokenType = params.isCall
            ? TokenType.LongCall
            : TokenType.LongPut;
          shortTokenType = params.isCall
            ? TokenType.ShortCall
            : TokenType.ShortPut;

          const expectedLongTokenId = BigNumber.from(
            formatTokenId({
              tokenType: longTokenType,
              maturity: expectedExpiry,
              strike64x64: expectedStrike,
            })
          );

          assert.bnEqual(option.longTokenId, expectedLongTokenId);

          shortTokenType = params.isCall
            ? TokenType.ShortCall
            : TokenType.ShortPut;

          const expectedShortTokenId = BigNumber.from(
            formatTokenId({
              tokenType: shortTokenType,
              maturity: expectedExpiry,
              strike64x64: expectedStrike,
            })
          );

          assert.bnEqual(option.shortTokenId, expectedShortTokenId);
        });
      });

      describe("#_collectPerformanceFee()", () => {
        time.revertToSnapshotAfterEach(async () => {
          await vault
            .connect(signers.deployer)
            .setPerformanceFee64x64(fixedFromFloat(0.2));

          // lp1 deposits into queue
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue.connect(signers.lp1)["deposit(uint256)"](params.deposit);

          // init epoch 0 auction
          let [startTime, , epoch] = await knoxUtil.initializeAuction();

          // init epoch 1
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();

          // auction 0 starts
          await time.increaseTo(startTime);

          // buyer1 purchases all available options
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          await auction
            .connect(signers.buyer1)
            .addMarketOrder(
              epoch,
              await auction.getTotalContracts(epoch),
              ethers.constants.MaxUint256
            );

          // process auction 0
          await vault.connect(signers.keeper).processAuction();

          // init auction 1
          await knoxUtil.initializeAuction();

          await time.fastForwardToFriday8AM();
          await time.increase(100);
        });

        it("should not collect performance fees if option expires far-ITM", async () => {
          let underlyingPrice = params.underlying.oracle.price;
          let intrinsicValue = underlyingPrice * 0.5;

          // Make sure options expire ITM
          let spot = params.isCall
            ? underlyingPrice + intrinsicValue
            : underlyingPrice - intrinsicValue;

          await poolUtil.underlyingSpotPriceOracle.mock.latestAnswer.returns(
            spot
          );

          // process epoch 0
          await knoxUtil.processExpiredOptions();

          const feeRecipientBalanceBefore = await asset.balanceOf(
            addresses.feeRecipient
          );

          await vault.collectPerformanceFee();

          const feeRecipientBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          assert.bnEqual(feeRecipientBalanceAfter, feeRecipientBalanceBefore);
        });

        it("should collect performance fees if option expires ATM", async () => {
          // process epoch 0

          await knoxUtil.processExpiredOptions();

          const feeRecipientBalanceBefore = await asset.balanceOf(
            addresses.feeRecipient
          );

          const tx = await vault.collectPerformanceFee();
          const args = await getEventArgs(tx, "PerformanceFeeCollected");

          const feeRecipientBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          assert.bnEqual(
            feeRecipientBalanceAfter.sub(feeRecipientBalanceBefore),
            args.feeInCollateral
          );
        });
      });

      describe("#_withdrawReservedLiquidity()", () => {
        time.revertToSnapshotAfterEach(async () => {
          await vault
            .connect(signers.deployer)
            .setPerformanceFee64x64(fixedFromFloat(0.2));

          // lp1 deposits into queue
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue.connect(signers.lp1)["deposit(uint256)"](params.deposit);

          // init epoch 0 auction
          let [startTime, , epoch] = await knoxUtil.initializeAuction();

          // init epoch 1
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();

          // auction 0 starts
          await time.increaseTo(startTime);

          // buyer1 purchases all available options
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          const size = await auction.getTotalContracts(epoch);

          await auction
            .connect(signers.buyer1)
            .addMarketOrder(epoch, size, ethers.constants.MaxUint256);

          // process auction 0
          await vault.connect(signers.keeper).processAuction();

          // init auction 1
          await knoxUtil.initializeAuction();

          await time.fastForwardToFriday8AM();
          await time.increase(100);
        });

        it("should withdraw reserved liquidity from pool", async () => {
          // process epoch 0
          const totalCollateralInShortPosition =
            await vault.totalShortAsCollateral();

          await knoxUtil.processExpiredOptions();

          const reservedLiquidityTokenId = params.isCall
            ? UNDERLYING_RESERVED_LIQ_TOKEN_ID
            : BASE_RESERVED_LIQ_TOKEN_ID;

          const reservedLiquidityBefore = await pool.balanceOf(
            addresses.vault,
            reservedLiquidityTokenId
          );

          assert.bnEqual(
            reservedLiquidityBefore,
            totalCollateralInShortPosition
          );

          const vaultCollateralBalanceBefore = await asset.balanceOf(
            addresses.vault
          );

          await vault["withdrawReservedLiquidity()"]();

          const reservedLiquidityAfter = await pool.balanceOf(
            addresses.vault,
            reservedLiquidityTokenId
          );

          const vaultCollateralBalanceAfter = await asset.balanceOf(
            addresses.vault
          );

          assert.bnEqual(reservedLiquidityAfter, BigNumber.from(0));

          assert.bnEqual(
            reservedLiquidityBefore.add(vaultCollateralBalanceBefore),
            vaultCollateralBalanceAfter
          );
        });
      });

      describe("#_setAuctionPrices()", () => {
        time.revertToSnapshotAfterEach(async () => {
          const pricer = await new Pricer__factory(signers.deployer).deploy(
            params.pool.address,
            params.pool.volatility
          );

          await vault.connect(signers.deployer).setPricer(pricer.address);

          // init epoch 0 auction
          await knoxUtil.initializeAuction();

          // init epoch 1
          await time.fastForwardToFriday8AM();
        });

        // note: it is possible for the offset strike to end up being further ITM than
        // the strike this may occur if the strike is rounded above/below the offset
        // strike. if the delta offset is too small the likelihood of this happening
        // increases.
        it("should set the offset strike price further OTM than the strike price", async () => {
          const tx = await vault.setAuctionPrices();
          const args = await getEventArgs(tx, "AuctionPricesSet");
          params.isCall
            ? assert.bnGt(args.offsetStrike64x64, args.strike64x64)
            : assert.bnGt(args.strike64x64, args.offsetStrike64x64);
        });

        it("should set max price greater than the min price", async () => {
          const tx = await vault.setAuctionPrices();
          const args = await getEventArgs(tx, "AuctionPricesSet");
          assert.bnGt(args.maxPrice64x64, args.minPrice64x64);
        });
      });

      describe("#_getFriday(uint256)", () => {
        time.revertToSnapshotAfterEach(async () => {
          const { timestamp } = await provider.getBlock("latest");

          // The block we're hardcoded to is a Monday
          const currentTime = moment.unix(timestamp);

          const monday = moment(currentTime)
            .startOf("isoWeek")
            .add(1, "week")
            .day("monday")
            .hour(9);

          await time.increaseTo(monday.unix());

          thisFriday = moment(monday).startOf("isoWeek").day("friday").hour(8);

          nextFriday = moment(monday)
            .startOf("isoWeek")
            .add(1, "week")
            .day("friday")
            .hour(8);
        });

        it("should return this Friday, given the day of week is Monday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday
          const monday = currentTime;

          const actualFriday = await vault.getFriday(monday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(thisFriday));
        });

        it("should return this Friday, given the day of week is Tuesday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 1 day to get to Tuesday
          const tuesday = currentTime.add(1, "days");

          const actualFriday = await vault.getFriday(tuesday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(thisFriday));
        });

        it("should return this Friday, given the day of week is Wendesday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 2 days to get to Wendesday
          const wendesday = currentTime.add(2, "days");

          const actualFriday = await vault.getFriday(wendesday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(thisFriday));
        });

        it("should return this Friday, given the day of week is Thursday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 3 days to get to Thursday
          const thursday = currentTime.add(3, "days");

          const actualFriday = await vault.getFriday(thursday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(thisFriday));
        });

        it("should return this Friday, given the day of week is Friday at 7am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(7)
            .minutes(0)
            .seconds(0); // set to 7am UTC

          const actualFriday = await vault.getFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(thisFriday));
        });

        it("should return next Friday, given the day of week is Friday at 8am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(8)
            .minutes(0)
            .seconds(0); // set to 8am UTC

          const actualFriday = await vault.getFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Friday at 9am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(9)
            .minutes(0)
            .seconds(0); // set to 9am UTC

          const actualFriday = await vault.getFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Saturday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 5 days to get to Saturday
          const saturday = currentTime.add(5, "days");

          const actualFriday = await vault.getFriday(saturday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Sunday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 6 days to get to Sunday
          const sunday = currentTime.add(6, "days");

          const actualFriday = await vault.getFriday(sunday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });
      });

      describe("#_getNextFriday(uint256)", () => {
        time.revertToSnapshotAfterEach(async () => {
          const { timestamp } = await provider.getBlock("latest");

          // The block we're hardcoded to is a Monday
          const currentTime = moment.unix(timestamp);

          const monday = moment(currentTime)
            .startOf("isoWeek")
            .add(1, "week")
            .day("monday")
            .hour(9);

          await time.increaseTo(monday.unix());

          thisFriday = moment(monday).startOf("isoWeek").day("friday").hour(8);

          nextFriday = moment(monday)
            .startOf("isoWeek")
            .add(1, "week")
            .day("friday")
            .hour(8);
        });

        it("should return next Friday, given the day of week is Monday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday
          const monday = currentTime;

          const actualFriday = await vault.getNextFriday(monday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Tuesday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 1 day to get to Tuesday
          const tuesday = currentTime.add(1, "days");

          const actualFriday = await vault.getNextFriday(tuesday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Wendesday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 2 days to get to Wendesday
          const wendesday = currentTime.add(2, "days");

          const actualFriday = await vault.getNextFriday(wendesday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Thursday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 3 days to get to Thursday
          const thursday = currentTime.add(3, "days");

          const actualFriday = await vault.getNextFriday(thursday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Friday at 7am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(7)
            .minutes(0)
            .seconds(0); // set to 7am UTC

          const actualFriday = await vault.getNextFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Friday at 8am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(8)
            .minutes(0)
            .seconds(0); // set to 8am UTC

          const actualFriday = await vault.getNextFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Friday at 9am UTC", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 4 days to get to Friday
          const friday = currentTime
            .add(4, "days")
            .hours(9)
            .minutes(0)
            .seconds(0); // set to 9am UTC

          const actualFriday = await vault.getNextFriday(friday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Saturday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 5 days to get to Saturday
          const saturday = currentTime.add(5, "days");

          const actualFriday = await vault.getNextFriday(saturday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });

        it("should return next Friday, given the day of week is Sunday", async () => {
          const { timestamp } = await provider.getBlock("latest");
          const currentTime = moment.unix(timestamp);

          // The block we're hardcoded to is a Monday so we add 6 days to get to Sunday
          const sunday = currentTime.add(6, "days");

          const actualFriday = await vault.getNextFriday(sunday.unix());
          const fridayDate = moment.unix(actualFriday.toNumber());

          assert.equal(fridayDate.weekday(), 5);
          assert.isTrue(fridayDate.isSame(nextFriday));
        });
      });
    });
  });
}
