import { ethers } from "hardhat";
import { BigNumber, ContractTransaction } from "ethers";

import { describeBehaviorOfERC4626Base } from "@solidstate/spec";

import { expect } from "chai";

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import { Auction, IPremiaPool, IVaultMock, MockERC20, Queue } from "../types";

import { almost, assert, math, time, types, KnoxUtil } from "../test/utils";
import { fixedFromFloat } from "@premia/utils";
import { parseUnits } from "ethers/lib/utils";

interface VaultBaseBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
  mintERC4626: (
    address: string,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  burnERC4626: (
    address: string,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  mintAsset: (
    address: string,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  supply: BigNumber;
}

export function describeBehaviorOfVaultBase(
  {
    getKnoxUtil,
    getParams,
    mintERC4626,
    burnERC4626,
    mintAsset,
    supply,
  }: VaultBaseBehaviorArgs,
  skips?: string[]
) {
  describe("::VaultBase", () => {
    // Contract Utilities
    let knoxUtil: KnoxUtil;

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

    describeBehaviorOfERC4626Base(
      async () => vault,
      {
        getAsset: async () => asset,
        mint: mintERC4626,
        burn: burnERC4626,
        mintAsset,
        supply,
      },
      skips
    );

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should deploy with correct state", async () => {
        assert.equal(await vault.ERC20(), asset.address);
        assert.equal(await vault.Pool(), addresses.pool);
      });
    });

    describe("#asset()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should return the collateral asset address", async () => {
        assert.equal(await vault.ERC20(), asset.address);
      });
    });

    describe.skip("#totalAssets()", () => {
      time.revertToSnapshotAfterEach(async () => {});
    });

    describe("#deposit(uint256,address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !queue", async () => {
        await expect(
          vault.connect(signers.lp1).deposit(0, addresses.lp1)
        ).to.be.revertedWith("!queue");
      });
    });

    describe("#mint(uint256,address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !queue", async () => {
        await expect(
          vault.connect(signers.lp1).mint(0, addresses.lp1)
        ).to.be.revertedWith("!queue");
      });
    });

    describe("#withdraw(uint256,address,address)", () => {
      describe("if auction has started but not processed", () => {
        time.revertToSnapshotAfterEach(async () => {
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
        });

        it("should revert", async () => {
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await expect(
            vault.connect(signers.lp1).withdraw(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });
      });

      describe("else if auction is cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          // lp1 deposits into queue
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue.connect(signers.lp1)["deposit(uint256)"](params.deposit);

          // init epoch 0 auction
          let [startTime, endTime, epoch] = await knoxUtil.initializeAuction();

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

          // fast forward to 24 hours after auction ends
          await time.increaseTo(endTime.add(86400));
          // await auction.finalizeAuction(epoch);

          // process auction 0
          await vault.connect(signers.keeper).processAuction();
        });

        it("should permit withdrawals after withdrawal lock has been reset", async () => {
          // init auction 1
          let [startTime] = await knoxUtil.initializeAuction();

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .withdraw(0, addresses.lp1, addresses.lp1);

          // auction 1 starts
          await time.increaseTo(startTime);

          // lock should activate when auction starts
          await expect(
            vault.connect(signers.lp1).withdraw(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });
      });

      describe("else if auction has been processed", () => {
        time.revertToSnapshotAfterEach(async () => {
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
        });

        it("should permit withdrawals after withdrawal lock has been reset", async () => {
          // init auction 1
          let [startTime] = await knoxUtil.initializeAuction();

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .withdraw(0, addresses.lp1, addresses.lp1);

          // auction 1 starts
          await time.increaseTo(startTime);

          // lock should activate when auction starts
          await expect(
            vault.connect(signers.lp1).withdraw(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });

        it("should redeem max vault shares from queue", async () => {
          const lpVaultSharesBefore = await vault.balanceOf(addresses.lp1);

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .withdraw(0, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);

          assert.bnEqual(lpVaultSharesBefore, BigNumber.from(0));
          assert.bnEqual(lpVaultSharesAfter, params.deposit);
        });

        it("should collect withdrawal fees in collateral tokens only to LP between epoch end and auction start", async () => {
          await vault
            .connect(signers.deployer)
            .setWithdrawalFee64x64(fixedFromFloat(0.02));

          // init auction 1
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await time.increase(100);

          // process epoch 0
          await knoxUtil.processExpiredOptions();

          // init epoch 2
          await knoxUtil.initializeEpoch();

          await queue.connect(signers.lp1)["redeemMax()"]();

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );
          const feeRecipientCollateralBalanceBefore = await asset.balanceOf(
            addresses.feeRecipient
          );

          const totalCollateral = await vault.totalCollateral();
          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const feeInCollateral = totalDistributionInCollateral * 0.02;

          totalDistributionInCollateral =
            totalDistributionInCollateral - feeInCollateral;

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const assetAmount = await vault
            .connect(signers.lp1)
            .maxWithdraw(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .withdraw(assetAmount, addresses.lp1, addresses.lp1);

          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);
          const feeRecipientCollateralBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          assert.equal(math.bnToNumber(feeRecipientCollateralBalanceBefore), 0);
          almost(feeRecipientCollateralBalanceAfter, feeInCollateral);

          // distribution includes collateral without premiums
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should distribute collateral tokens only to LP between epoch end and auction start", async () => {
          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          // init auction 1
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await time.increase(100);

          // process epoch 0
          await knoxUtil.processExpiredOptions();

          // init epoch 2
          await knoxUtil.initializeEpoch();

          await queue.connect(signers.lp1)["redeemMax()"]();

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();
          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const assetAmount = await vault
            .connect(signers.lp1)
            .maxWithdraw(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .withdraw(assetAmount, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);
          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const vaultShortBalanceAfter = await pool.balanceOf(
            addresses.vault,
            shortTokenId[0]
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          assert.equal(math.bnToNumber(lpVaultSharesAfter), 0);
          assert.equal(math.bnToNumber(vaultShortBalanceAfter), 0);
          assert.equal(math.bnToNumber(lpShortBalanceAfter), 0);

          // distribution includes collateral without premiums
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should collect withdrawal fees in collateral and short tokens to LP after auction ends", async () => {
          await vault
            .connect(signers.deployer)
            .setWithdrawalFee64x64(fixedFromFloat(0.02));

          await queue.connect(signers.lp1)["redeemMax()"]();

          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();

          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const feeInCollateral = totalDistributionInCollateral * 0.02;
          totalDistributionInCollateral =
            totalDistributionInCollateral - feeInCollateral;

          const totalShortContracts = await vault.totalShortAsContracts();

          let totalDistributionInShortContracts =
            math.bnToNumber(totalShortContracts);

          const feeInShortContracts = totalDistributionInShortContracts * 0.02;
          totalDistributionInShortContracts =
            totalDistributionInShortContracts - feeInShortContracts;

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const assetAmount = await vault
            .connect(signers.lp1)
            .maxWithdraw(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .withdraw(assetAmount, addresses.lp1, addresses.lp1);

          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const feeRecipientCollateralBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          const feeRecipientShortBalanceAfter = await pool.balanceOf(
            addresses.feeRecipient,
            shortTokenId[0]
          );

          assert.equal(
            math.bnToNumber(feeRecipientShortBalanceAfter),
            feeInShortContracts
          );

          almost(feeRecipientCollateralBalanceAfter, feeInCollateral);
          almost(lpShortBalanceAfter, totalDistributionInShortContracts);

          // distribution contains collateral and premiums earned from auction
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should distribute collateral and short tokens to LP after auction ends", async () => {
          await queue.connect(signers.lp1)["redeemMax()"]();

          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();

          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const totalShortContracts = await vault.totalShortAsContracts();

          let totalDistributionInShortContracts =
            math.bnToNumber(totalShortContracts);

          // lp1 redeems from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const assetAmount = await vault
            .connect(signers.lp1)
            .maxWithdraw(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .withdraw(assetAmount, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);
          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const vaultShortBalanceAfter = await pool.balanceOf(
            addresses.vault,
            shortTokenId[0]
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          assert.equal(math.bnToNumber(lpVaultSharesAfter), 0);
          almost(
            vaultShortBalanceAfter,
            0,
            parseUnits("1", params.collateral.decimals - 3) // min tolerance
          );

          assert.equal(
            math.bnToNumber(lpShortBalanceAfter),
            totalDistributionInShortContracts
          );

          // distribution contains collateral and premiums earned from auction
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });
      });
    });

    describe("#redeem(uint256,address,address)", () => {
      describe("if auction has started but not processed", () => {
        time.revertToSnapshotAfterEach(async () => {
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
        });

        it("should revert", async () => {
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await expect(
            vault.connect(signers.lp1).redeem(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });
      });

      describe("else if auction is cancelled", () => {
        time.revertToSnapshotAfterEach(async () => {
          // lp1 deposits into queue
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue.connect(signers.lp1)["deposit(uint256)"](params.deposit);

          // init epoch 0 auction
          let [startTime, endTime, epoch] = await knoxUtil.initializeAuction();

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

          // fast forward to 24 hours after auction ends
          await time.increaseTo(endTime.add(86400));
          // await auction.finalizeAuction(epoch);

          // process auction 0
          await vault.connect(signers.keeper).processAuction();
        });

        it("should permit redemptions after withdrawal lock has been reset", async () => {
          // init auction 1
          let [startTime] = await knoxUtil.initializeAuction();

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .redeem(0, addresses.lp1, addresses.lp1);

          // auction 1 starts
          await time.increaseTo(startTime);

          // lock should activate when auction starts
          await expect(
            vault.connect(signers.lp1).redeem(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });
      });

      describe("else if auction has been processed", () => {
        time.revertToSnapshotAfterEach(async () => {
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
        });

        it("should permit redemptions after withdrawal lock has been reset", async () => {
          // init auction 1
          let [startTime] = await knoxUtil.initializeAuction();

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .redeem(0, addresses.lp1, addresses.lp1);

          // auction 1 starts
          await time.increaseTo(startTime);

          // lock should activate when auction starts
          await expect(
            vault.connect(signers.lp1).redeem(0, addresses.lp1, addresses.lp1)
          ).to.be.revertedWith("auction has not been processed");
        });

        it("should redeem max vault shares from queue", async () => {
          const lpVaultSharesBefore = await vault.balanceOf(addresses.lp1);

          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          await vault
            .connect(signers.lp1)
            .redeem(0, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);

          assert.bnEqual(lpVaultSharesBefore, BigNumber.from(0));
          assert.bnEqual(lpVaultSharesAfter, params.deposit);
        });

        it("should collect withdrawal fees in collateral tokens only to LP between epoch end and auction start", async () => {
          await vault
            .connect(signers.deployer)
            .setWithdrawalFee64x64(fixedFromFloat(0.02));

          // init auction 1
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await time.increase(100);

          // process epoch 0
          await knoxUtil.processExpiredOptions();

          // init epoch 2
          await knoxUtil.initializeEpoch();

          await queue.connect(signers.lp1)["redeemMax()"]();

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );
          const feeRecipientCollateralBalanceBefore = await asset.balanceOf(
            addresses.feeRecipient
          );

          const totalCollateral = await vault.totalCollateral();
          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const feeInCollateral = totalDistributionInCollateral * 0.02;

          totalDistributionInCollateral =
            totalDistributionInCollateral - feeInCollateral;

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const shareAmount = await vault
            .connect(signers.lp1)
            .maxRedeem(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .redeem(shareAmount, addresses.lp1, addresses.lp1);

          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);
          const feeRecipientCollateralBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          assert.equal(math.bnToNumber(feeRecipientCollateralBalanceBefore), 0);
          almost(feeRecipientCollateralBalanceAfter, feeInCollateral);

          // distribution includes collateral without premiums
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should distribute collateral tokens only to LP between epoch end and auction start", async () => {
          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          // init auction 1
          await knoxUtil.initializeAuction();
          await time.fastForwardToFriday8AM();
          await time.increase(100);

          // process epoch 0
          await knoxUtil.processExpiredOptions();

          // init epoch 2
          await knoxUtil.initializeEpoch();

          await queue.connect(signers.lp1)["redeemMax()"]();

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();
          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const shareAmount = await vault
            .connect(signers.lp1)
            .maxRedeem(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .redeem(shareAmount, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);
          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const vaultShortBalanceAfter = await pool.balanceOf(
            addresses.vault,
            shortTokenId[0]
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          assert.equal(math.bnToNumber(lpVaultSharesAfter), 0);
          assert.equal(math.bnToNumber(vaultShortBalanceAfter), 0);
          assert.equal(math.bnToNumber(lpShortBalanceAfter), 0);

          // distribution includes collateral without premiums
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should collect withdrawal fees in collateral and short tokens to LP after auction ends", async () => {
          await vault
            .connect(signers.deployer)
            .setWithdrawalFee64x64(fixedFromFloat(0.02));

          await queue.connect(signers.lp1)["redeemMax()"]();

          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();

          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const feeInCollateral = totalDistributionInCollateral * 0.02;
          totalDistributionInCollateral =
            totalDistributionInCollateral - feeInCollateral;

          const totalShortContracts = await vault.totalShortAsContracts();

          let totalDistributionInShortContracts =
            math.bnToNumber(totalShortContracts);

          const feeInShortContracts = totalDistributionInShortContracts * 0.02;
          totalDistributionInShortContracts =
            totalDistributionInShortContracts - feeInShortContracts;

          // lp1 withdraws from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const shareAmount = await vault
            .connect(signers.lp1)
            .maxRedeem(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .redeem(shareAmount, addresses.lp1, addresses.lp1);

          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const feeRecipientCollateralBalanceAfter = await asset.balanceOf(
            addresses.feeRecipient
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          const feeRecipientShortBalanceAfter = await pool.balanceOf(
            addresses.feeRecipient,
            shortTokenId[0]
          );

          assert.equal(
            math.bnToNumber(feeRecipientShortBalanceAfter),
            feeInShortContracts
          );

          almost(feeRecipientCollateralBalanceAfter, feeInCollateral);

          assert.equal(
            math.bnToNumber(lpShortBalanceAfter),
            totalDistributionInShortContracts
          );

          // distribution contains collateral and premiums earned from auction
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });

        it("should distribute collateral and short tokens to LP after auction ends", async () => {
          await queue.connect(signers.lp1)["redeemMax()"]();

          const shortTokenId = await pool["tokensByAccount(address)"](
            addresses.vault
          );

          const lpCollateralBalanceBefore = await asset.balanceOf(
            addresses.lp1
          );

          const totalCollateral = await vault.totalCollateral();

          let totalDistributionInCollateral = math.bnToNumber(totalCollateral);

          const totalShortContracts = await vault.totalShortAsContracts();

          let totalDistributionInShortContracts =
            math.bnToNumber(totalShortContracts);

          // lp1 redeems from vault
          await queue
            .connect(signers.lp1)
            .setApprovalForAll(addresses.vault, true);

          const shareAmount = await vault
            .connect(signers.lp1)
            .maxRedeem(addresses.lp1);

          await vault
            .connect(signers.lp1)
            .redeem(shareAmount, addresses.lp1, addresses.lp1);

          const lpVaultSharesAfter = await vault.balanceOf(addresses.lp1);
          const lpCollateralBalanceAfter = await asset.balanceOf(addresses.lp1);

          const vaultShortBalanceAfter = await pool.balanceOf(
            addresses.vault,
            shortTokenId[0]
          );

          const lpShortBalanceAfter = await pool.balanceOf(
            addresses.lp1,
            shortTokenId[0]
          );

          assert.equal(math.bnToNumber(lpVaultSharesAfter), 0);
          almost(
            vaultShortBalanceAfter,
            0,
            parseUnits("1", params.collateral.decimals - 3) // min tolerance
          );

          assert.equal(
            math.bnToNumber(lpShortBalanceAfter),
            totalDistributionInShortContracts
          );

          // distribution contains collateral and premiums earned from auction
          almost(
            lpCollateralBalanceAfter.sub(lpCollateralBalanceBefore),
            totalDistributionInCollateral
          );
        });
      });
    });
  });
}
