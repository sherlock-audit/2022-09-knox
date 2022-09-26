import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { fixedFromFloat } from "@premia/utils";

import chai, { expect } from "chai";
import chaiAlmost from "chai-almost";

chai.use(chaiAlmost());

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import {
  UNDERLYING_FREE_LIQ_TOKEN_ID,
  BASE_FREE_LIQ_TOKEN_ID,
  UNDERLYING_RESERVED_LIQ_TOKEN_ID,
  BASE_RESERVED_LIQ_TOKEN_ID,
} from "../constants";

import { Auction, IPremiaPool, IVaultMock, MockERC20, Queue } from "../types";

import { assert, time, types, KnoxUtil, PoolUtil } from "../test/utils";

interface VaultAdminBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
}

export function describeBehaviorOfVaultAdmin(
  { getKnoxUtil, getParams }: VaultAdminBehaviorArgs,
  skips?: string[]
) {
  describe("::VaultAdmin", () => {
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

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should deploy with correct state", async () => {
        assert.equal(await vault.ERC20(), asset.address);
        assert.equal(await vault.Pool(), addresses.pool);
      });
    });

    describe("#setAuction(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setAuction(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setAuction(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          vault.connect(signers.deployer).setAuction(addresses.auction)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(vault.connect(signers.deployer).setAuction(addresses.lp1))
          .to.emit(vault, "AuctionSet")
          .withArgs(0, addresses.auction, addresses.lp1, addresses.deployer);
      });
    });

    describe("#setAuctionWindowOffsets(uint16,uint16)", () => {
      const newStartOffset = 14400;
      const newEndOffset = 21600;

      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(
          vault.setAuctionWindowOffsets(newStartOffset, newEndOffset)
        ).to.be.revertedWith("Ownable: sender must be owner");
      });

      it("should revert start offset > end offset", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setAuctionWindowOffsets(newEndOffset, newStartOffset)
        ).to.be.revertedWith("start offset > end offset");
      });

      it("should set new exchange helper address", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setAuctionWindowOffsets(newStartOffset, newEndOffset)
        )
          .to.emit(vault, "AuctionWindowOffsetsSet")
          .withArgs(
            0,
            7200,
            newStartOffset,
            14400,
            newEndOffset,
            addresses.deployer
          );
      });
    });

    describe("#setDelta64x64(int128)", () => {
      const newDelta = fixedFromFloat(0.2);

      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setDelta64x64(newDelta)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if option delta is <= 0", async () => {
        await expect(
          vault.connect(signers.deployer).setDelta64x64(0)
        ).to.be.revertedWith("delta <= 0");
      });

      it("should revert if option delta is > 1", async () => {
        await expect(
          vault.connect(signers.deployer).setDelta64x64(fixedFromFloat(1))
        ).to.be.revertedWith("delta > 1");
      });

      it("should set a new delta", async () => {
        await expect(vault.connect(signers.deployer).setDelta64x64(newDelta))
          .to.emit(vault, "DeltaSet")
          .withArgs(
            0,
            fixedFromFloat(params.delta),
            newDelta,
            addresses.deployer
          );
      });
    });

    describe("#setDeltaOffset64x64(int128)", () => {
      const newDeltaOffset = fixedFromFloat(0.05);

      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(
          vault.setDeltaOffset64x64(newDeltaOffset)
        ).to.be.revertedWith("Ownable: sender must be owner");
      });

      it("should revert if option delta is <= 0", async () => {
        await expect(
          vault.connect(signers.deployer).setDeltaOffset64x64(0)
        ).to.be.revertedWith("delta <= 0");
      });

      it("should revert if option delta is > 1", async () => {
        await expect(
          vault.connect(signers.deployer).setDeltaOffset64x64(fixedFromFloat(1))
        ).to.be.revertedWith("delta > 1");
      });

      it("should set a new delta", async () => {
        await expect(
          vault.connect(signers.deployer).setDeltaOffset64x64(newDeltaOffset)
        )
          .to.emit(vault, "DeltaSet")
          .withArgs(
            0,
            fixedFromFloat(params.deltaOffset),
            newDeltaOffset,
            addresses.deployer
          );
      });
    });

    describe("#setFeeRecipient(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setFeeRecipient(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setFeeRecipient(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setFeeRecipient(addresses.feeRecipient)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(
          vault.connect(signers.deployer).setFeeRecipient(addresses.lp1)
        )
          .to.emit(vault, "FeeRecipientSet")
          .withArgs(
            0,
            addresses.feeRecipient,
            addresses.lp1,
            addresses.deployer
          );
      });
    });

    describe("#setKeeper(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setKeeper(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setKeeper(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          vault.connect(signers.deployer).setKeeper(addresses.keeper)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(vault.connect(signers.deployer).setKeeper(addresses.lp1))
          .to.emit(vault, "KeeperSet")
          .withArgs(0, addresses.keeper, addresses.lp1, addresses.deployer);
      });
    });

    describe("#setPricer(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setPricer(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setPricer(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          vault.connect(signers.deployer).setPricer(addresses.pricer)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(vault.connect(signers.deployer).setPricer(addresses.lp1))
          .to.emit(vault, "PricerSet")
          .withArgs(0, addresses.pricer, addresses.lp1, addresses.deployer);
      });
    });

    describe("#setQueue(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setQueue(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          vault.connect(signers.deployer).setQueue(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          vault.connect(signers.deployer).setQueue(addresses.queue)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(vault.connect(signers.deployer).setQueue(addresses.lp1))
          .to.emit(vault, "QueueSet")
          .withArgs(0, addresses.queue, addresses.lp1, addresses.deployer);
      });
    });

    describe("#setPerformanceFee64x64(int128)", () => {
      const newFee = fixedFromFloat(0.5);

      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setPerformanceFee64x64(newFee)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if fee exceeds maximum", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setPerformanceFee64x64(fixedFromFloat(1))
        ).to.be.revertedWith("fee > 1");
      });

      it("should set a new fee", async () => {
        await expect(
          vault.connect(signers.deployer).setPerformanceFee64x64(newFee)
        )
          .to.emit(vault, "PerformanceFeeSet")
          .withArgs(0, 0, newFee, addresses.deployer);
      });
    });

    describe("#setWithdrawalFee64x64(int128)", () => {
      const newFee = fixedFromFloat(0.05);

      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(vault.setWithdrawalFee64x64(newFee)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if fee exceeds maximum", async () => {
        await expect(
          vault
            .connect(signers.deployer)
            .setWithdrawalFee64x64(fixedFromFloat(1))
        ).to.be.revertedWith("fee > 1");
      });

      it("should set a new fee", async () => {
        await expect(
          vault.connect(signers.deployer).setWithdrawalFee64x64(newFee)
        )
          .to.emit(vault, "WithdrawalFeeSet")
          .withArgs(0, 0, newFee, addresses.deployer);
      });
    });

    describe("#initializeAuction()", () => {
      let epoch;
      let option;

      time.revertToSnapshotAfterEach(async () => {
        // init auction 0
        await time.fastForwardToThursday8AM();
        await vault.connect(signers.keeper).initializeAuction();

        epoch = await vault.getEpoch();
        option = await vault.getOption(epoch);
      });

      it("should revert if !keeper", async () => {
        await expect(vault.initializeAuction()).to.be.revertedWith("!keeper");
      });

      it("should set auction start to friday of current week if epoch == 0", async () => {
        const friday = await time.getFriday8AM(await time.now());

        // two hours after friday 8am
        const expectedStartTime = BigNumber.from(friday + 7200);
        // four hours after friday 8am
        const expectedEndTime = BigNumber.from(friday + 14400);

        const data = await auction.getAuction(epoch);

        assert.bnEqual(epoch, BigNumber.from(0));
        assert.bnEqual(data.strike64x64, option.strike64x64);
        assert.bnEqual(data.longTokenId, option.longTokenId);
        assert.bnEqual(data.startTime, expectedStartTime);
        assert.bnEqual(data.endTime, expectedEndTime);
      });

      it("should set auction start to option expiry if epoch > 0", async () => {
        // init epoch 1
        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        // init auction 1
        await time.fastForwardToThursday8AM();
        await vault.connect(signers.keeper).initializeAuction();

        epoch = await vault.getEpoch();
        option = await vault.getOption(epoch);

        const friday = await time.getFriday8AM(await time.now());

        // two hours after friday 8am
        const expectedStartTime = BigNumber.from(friday + 7200);
        // four hours after friday 8am
        const expectedEndTime = BigNumber.from(friday + 14400);

        const data = await auction.getAuction(epoch);

        assert.bnEqual(epoch, BigNumber.from(1));
        assert.bnEqual(data.strike64x64, option.strike64x64);
        assert.bnEqual(data.longTokenId, option.longTokenId);
        assert.bnEqual(data.startTime, expectedStartTime);
        assert.bnEqual(data.endTime, expectedEndTime);
      });
    });

    describe("#initializeEpoch()", () => {
      let epoch: BigNumber;
      let startTime: BigNumber;

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
        [startTime, , epoch] = await knoxUtil.initializeAuction();

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
        [, , epoch] = await knoxUtil.initializeAuction();

        await time.fastForwardToFriday8AM();
        await time.increase(100);
      });

      it("should revert if !keeper", async () => {
        await expect(vault.initializeEpoch()).to.be.revertedWith("!keeper");
      });

      it("should set state parameters and increment epoch", async () => {
        const queueEpochBefore = await queue.getEpoch();
        const vaultEpochBefore = await vault.getEpoch();
        const totalShortContractsBefore = await vault.totalShortAsContracts();

        assert.bnEqual(queueEpochBefore, BigNumber.from(epoch));
        assert.bnEqual(vaultEpochBefore, BigNumber.from(epoch));
        assert.bnGt(totalShortContractsBefore, BigNumber.from(0));

        await vault.connect(signers.keeper).initializeEpoch();

        const queueEpochAfter = await queue.getEpoch();
        const vaultEpochAfter = await vault.getEpoch();
        const totalShortContractsAfter = await vault.totalShortAsContracts();

        epoch = epoch.add(1);

        assert.bnEqual(queueEpochAfter, BigNumber.from(epoch));
        assert.bnEqual(vaultEpochAfter, BigNumber.from(epoch));
        assert.bnEqual(totalShortContractsAfter, BigNumber.from(0));
      });
    });

    describe("#processAuction()", () => {
      describe("if auction is not finalized", () => {
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
          await knoxUtil.initializeAuction();

          it("should revert", async () => {
            await expect(
              vault.connect(signers.keeper).processAuction()
            ).to.be.revertedWith("auction is not finalized nor cancelled");
          });
        });
      });

      describe("else", () => {
        let epoch: BigNumber;
        let startTime: BigNumber;
        let size: BigNumber;

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
          [startTime, , epoch] = await knoxUtil.initializeAuction();

          // init epoch 1
          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();

          // auction 0 starts
          await time.increaseTo(startTime);

          // buyer1 purchases all available options
          await asset
            .connect(signers.buyer1)
            .approve(addresses.auction, ethers.constants.MaxUint256);

          size = await auction.getTotalContracts(epoch);

          await auction
            .connect(signers.buyer1)
            .addMarketOrder(epoch, size, ethers.constants.MaxUint256);
        });

        it("should move collateral to reserved liquidity queue if option is exercised", async () => {
          // process auction 0
          await vault.connect(signers.keeper).processAuction();

          const totalCollateralInShortPosition =
            await vault.totalShortAsCollateral();

          const freeLiquidityTokenId = params.isCall
            ? UNDERLYING_FREE_LIQ_TOKEN_ID
            : BASE_FREE_LIQ_TOKEN_ID;

          const reservedLiquidityTokenId = params.isCall
            ? UNDERLYING_RESERVED_LIQ_TOKEN_ID
            : BASE_RESERVED_LIQ_TOKEN_ID;

          const reservedLiquidityBefore = await pool.balanceOf(
            addresses.vault,
            reservedLiquidityTokenId
          );

          const freeLiquidityBefore = await pool.balanceOf(
            addresses.vault,
            freeLiquidityTokenId
          );

          assert.bnEqual(reservedLiquidityBefore, BigNumber.from(0));
          assert.bnEqual(freeLiquidityBefore, BigNumber.from(0));

          // options expires ITM
          let underlyingPrice = params.underlying.oracle.price;
          let intrinsicValue = 1;

          const spot = params.isCall
            ? underlyingPrice + intrinsicValue
            : underlyingPrice - intrinsicValue;

          await poolUtil.underlyingSpotPriceOracle.mock.latestAnswer.returns(
            spot
          );

          // fast forward to hold period end
          const { endTime } = await auction.getAuction(epoch);
          await time.increaseTo(endTime.add(86400));

          const { longTokenId } = await auction.getAuction(epoch);
          await auction.connect(signers.buyer1).withdraw(epoch);
          await pool
            .connect(signers.buyer1)
            .exerciseFrom(addresses.buyer1, longTokenId, size);

          const reservedLiquidityAfter = await pool.balanceOf(
            addresses.vault,
            reservedLiquidityTokenId
          );

          const freeLiquidityAfter = await pool.balanceOf(
            addresses.vault,
            freeLiquidityTokenId
          );

          // reservered liquidity should include notional value + refunded APY fee
          assert.bnGte(reservedLiquidityAfter, totalCollateralInShortPosition);
          assert.bnEqual(freeLiquidityAfter, BigNumber.from(0));
        });
      });
    });
  });
}
