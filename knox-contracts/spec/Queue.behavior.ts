import { ethers } from "hardhat";
import { BigNumber, ContractTransaction } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
const { provider } = ethers;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { describeBehaviorOfERC1155Enumerable } from "@solidstate/spec";

import chai, { expect } from "chai";
import chaiAlmost from "chai-almost";

chai.use(chaiAlmost());

import { Auction, IVaultMock, MockERC20, Queue } from "../types";

import {
  almost,
  assert,
  time,
  types,
  uniswap,
  KnoxUtil,
  PoolUtil,
  formatClaimTokenId,
} from "../test/utils";

interface QueueBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
  transferERC1155: (
    from: SignerWithAddress,
    to: SignerWithAddress,
    id: BigNumber,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  mintERC1155: (
    address: string,
    id: BigNumber,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  burnERC1155: (
    address: string,
    id: BigNumber,
    amount: BigNumber
  ) => Promise<ContractTransaction>;
  tokenIdERC1155?: BigNumber;
}

const gasPrice = parseUnits("0.1", "gwei");

export async function describeBehaviorOfQueue(
  {
    getKnoxUtil,
    getParams,
    transferERC1155,
    mintERC1155,
    burnERC1155,
    tokenIdERC1155,
  }: QueueBehaviorArgs,
  skips?: string[]
) {
  describe("::Queue", () => {
    // Contract Utilities
    let knoxUtil: KnoxUtil;
    let poolUtil: PoolUtil;

    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Instances and Proxies
    let asset: MockERC20;
    let auction: Auction;
    let queue: Queue;
    let vault: IVaultMock;
    let weth: MockERC20;

    // Pool Utilities
    let uni: uniswap.IUniswap;

    // Test Suite Globals
    const params = getParams();

    before(async () => {
      knoxUtil = await getKnoxUtil();
      poolUtil = knoxUtil.poolUtil;

      signers = knoxUtil.signers;
      addresses = knoxUtil.addresses;

      asset = knoxUtil.asset;
      vault = knoxUtil.vaultUtil.vault;
      queue = knoxUtil.queue;
      auction = knoxUtil.auction;

      weth = poolUtil.weth;
      uni = knoxUtil.uni;

      await asset
        .connect(signers.deployer)
        .mint(addresses.deployer, params.mint);
      await asset.connect(signers.lp1).mint(addresses.lp1, params.mint);
      await asset.connect(signers.lp2).mint(addresses.lp2, params.mint);
      await asset.connect(signers.lp3).mint(addresses.lp3, params.mint);

      await uni.tokenIn.connect(signers.lp1).mint(addresses.lp1, params.mint);
    });

    describeBehaviorOfERC1155Enumerable(
      async () => queue,
      {
        transfer: transferERC1155,
        mint: mintERC1155,
        burn: burnERC1155,
        tokenId: tokenIdERC1155,
      },
      skips
    );

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should initialize Queue with correct state", async () => {
        await assert.equal(await queue.ERC20(), asset.address);
        await assert.equal(await queue.Vault(), addresses.vault);
        await assert.equal(await queue.WETH(), poolUtil.weth.address);
        await assert.bnEqual(await queue.getEpoch(), ethers.constants.Zero);
        await assert.bnEqual(await queue.getMaxTVL(), params.maxTVL);
      });
    });

    describe("#setMaxTVL(uint256,address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if caller is !owner", async () => {
        await expect(queue.setMaxTVL(1000)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if newMaxTVL <= 0", async () => {
        await expect(
          queue.connect(signers.deployer).setMaxTVL(0)
        ).to.be.revertedWith("value exceeds minimum");
      });

      it("should set newMaxTVL", async () => {
        await queue.connect(signers.deployer).setMaxTVL(1000);
        await assert.bnEqual(await queue.getMaxTVL(), BigNumber.from("1000"));
      });
    });

    describe("#setExchangeHelper(address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if !owner", async () => {
        await expect(queue.setExchangeHelper(addresses.lp1)).to.be.revertedWith(
          "Ownable: sender must be owner"
        );
      });

      it("should revert if address is 0x0", async () => {
        await expect(
          queue
            .connect(signers.deployer)
            .setExchangeHelper(ethers.constants.AddressZero)
        ).to.be.revertedWith("address not provided");
      });

      it("should revert if new address == old address", async () => {
        await expect(
          queue.connect(signers.deployer).setExchangeHelper(addresses.exchange)
        ).to.be.revertedWith("new address equals old");
      });

      it("should set new exchange helper address", async () => {
        await expect(
          queue.connect(signers.deployer).setExchangeHelper(addresses.lp1)
        )
          .to.emit(queue, "ExchangeHelperSet")
          .withArgs(addresses.exchange, addresses.lp1, addresses.deployer);
      });
    });

    describe("#deposit(uint256)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if Queue is paused", async () => {
        await queue.connect(signers.deployer).pause();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        await expect(
          queue.connect(signers.lp1)["deposit(uint256)"](params.deposit)
        ).to.be.revertedWith("Pausable: paused");

        await queue.connect(signers.deployer).unpause();
        await queue.connect(signers.lp1)["deposit(uint256)"](params.deposit);
      });

      it("should revert if maxTVL is exceeded", async () => {
        const deposit = params.maxTVL.add(BigNumber.from("1"));
        await asset.connect(signers.lp3).mint(addresses.lp3, deposit);
        await asset.connect(signers.lp3).approve(addresses.queue, deposit);
        await expect(
          queue.connect(signers.lp3)["deposit(uint256)"](deposit)
        ).to.be.revertedWith("maxTVL exceeded");
      });

      it("should revert if value is <= 0", async () => {
        await expect(
          queue["deposit(uint256)"](ethers.constants.Zero)
        ).to.be.revertedWith("value exceeds minimum");
      });

      it("should mint claim token 1:1 for collateral deposited", async () => {
        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        await queue["deposit(uint256)"](params.deposit);

        let lpClaimBalance = await queue["balanceOf(address,uint256)"](
          addresses.lp1,
          await queue.getCurrentTokenId()
        );

        const queueBalance = await asset.balanceOf(addresses.queue);

        assert.bnEqual(queueBalance, params.deposit);
        assert.bnEqual(lpClaimBalance, queueBalance);
      });

      it("should mint claim tokens if LP deposits multiple times within same epoch", async () => {
        const firstDeposit = params.deposit;

        await asset.connect(signers.lp1).approve(addresses.queue, firstDeposit);
        await queue["deposit(uint256)"](firstDeposit);

        const secondDeposit = params.deposit.div(2);

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, secondDeposit);

        await queue["deposit(uint256)"](secondDeposit);

        let lpClaimBalance = await queue["balanceOf(address,uint256)"](
          addresses.lp1,
          await queue.getCurrentTokenId()
        );

        const totalDeposits = firstDeposit.add(secondDeposit);

        assert.bnEqual(lpClaimBalance, totalDeposits);
      });

      it("should redeem vault shares if LP deposited in past epoch", async () => {
        const [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);
        const tokenId1 = await queue.getCurrentTokenId();

        let lpTokenId1Balance = await queue.balanceOf(addresses.lp1, tokenId1);
        assert.bnEqual(lpTokenId1Balance, params.deposit);

        let lpBalance = await vault.balanceOf(addresses.lp1);
        assert.isTrue(lpBalance.isZero());

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);
        const tokenId2 = await queue.getCurrentTokenId();

        lpTokenId1Balance = await queue.balanceOf(addresses.lp1, tokenId1);
        assert.isTrue(lpTokenId1Balance.isZero());

        let lpTokenId2Balance = await queue.balanceOf(addresses.lp1, tokenId2);
        assert.bnEqual(lpTokenId2Balance, params.deposit);

        lpBalance = await vault.balanceOf(addresses.lp1);
        assert.bnEqual(lpBalance, params.deposit);
      });

      if (params.collateral.name === "wETH") {
        it("should send credit to buyer if they send too much ETH", async () => {
          const queueWETHBalanceBefore = await weth.balanceOf(addresses.queue);
          const lp1WETHBalanceBefore = await weth.balanceOf(addresses.lp1);
          const lp1ETHBalanceBefore = await provider.getBalance(addresses.lp1);

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, ethers.constants.MaxUint256);

          const ethSent = params.deposit.mul(2);

          const tx = await queue["deposit(uint256)"](params.deposit, {
            value: ethSent,
            gasPrice,
          });
          const receipt = await tx.wait();
          const gasFee = receipt.gasUsed.mul(gasPrice);

          const queueWETHBalanceAfter = await weth.balanceOf(addresses.queue);
          const lp1WETHBalanceAfter = await weth.balanceOf(addresses.lp1);
          const lp1ETHBalanceAfter = await provider.getBalance(addresses.lp1);

          assert.bnEqual(
            await queue["balanceOf(address,uint256)"](
              addresses.lp1,
              await queue.getCurrentTokenId()
            ),
            await asset.balanceOf(addresses.queue)
          );

          almost(
            queueWETHBalanceAfter.sub(queueWETHBalanceBefore),
            params.deposit
          );

          almost(lp1WETHBalanceBefore, lp1WETHBalanceAfter);

          almost(
            lp1ETHBalanceBefore.sub(lp1ETHBalanceAfter).sub(gasFee),
            params.deposit
          );
        });
        it("should transfer remainder if buyer does not send enough ETH", async () => {
          const queueWETHBalanceBefore = await weth.balanceOf(addresses.queue);
          const lp1WETHBalanceBefore = await weth.balanceOf(addresses.lp1);
          const lp1ETHBalanceBefore = await provider.getBalance(addresses.lp1);

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, ethers.constants.MaxUint256);

          const ethSent = params.deposit.div(2);

          const tx = await queue["deposit(uint256)"](params.deposit, {
            value: ethSent,
            gasPrice,
          });
          const receipt = await tx.wait();
          const gasFee = receipt.gasUsed.mul(gasPrice);

          const queueWETHBalanceAfter = await weth.balanceOf(addresses.queue);
          const lp1WETHBalanceAfter = await weth.balanceOf(addresses.lp1);
          const lp1ETHBalanceAfter = await provider.getBalance(addresses.lp1);

          assert.bnEqual(
            await queue["balanceOf(address,uint256)"](
              addresses.lp1,
              await queue.getCurrentTokenId()
            ),
            await asset.balanceOf(addresses.queue)
          );

          almost(
            queueWETHBalanceAfter.sub(queueWETHBalanceBefore),
            params.deposit
          );

          almost(
            lp1WETHBalanceBefore.sub(lp1WETHBalanceAfter),
            params.deposit.sub(ethSent)
          );

          almost(
            lp1ETHBalanceBefore.sub(lp1ETHBalanceAfter).sub(gasFee),
            ethSent
          );
        });
      } else {
        it("should revert if collateral != wETH", async () => {
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, ethers.constants.MaxUint256);
          await expect(
            queue["deposit(uint256)"](params.deposit, {
              value: params.deposit,
              gasPrice,
            })
          ).to.be.revertedWith("collateral != wETH");
        });
      }
    });

    describe("#swapAndDeposit(uint256)", () => {
      let tokenIn: MockERC20;
      let tokenOut: MockERC20;
      let path: string[];

      time.revertToSnapshotAfterEach(async () => {
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
        const amountOutMin = params.deposit;

        const [expectedInputAmount] = await uni.router.getAmountsIn(
          amountOutMin,
          path
        );

        const iface = new ethers.utils.Interface(uniswap.abi);

        const data = iface.encodeFunctionData("swapExactTokensForTokens", [
          expectedInputAmount,
          amountOutMin,
          path,
          addresses.exchange,
          (await time.now()) + 86400,
        ]);

        await tokenIn
          .connect(signers.lp1)
          .approve(addresses.queue, ethers.constants.MaxUint256);

        await expect(
          queue[
            "swapAndDeposit((address,uint256,uint256,address,address,bytes,address))"
          ](
            {
              tokenIn: tokenIn.address,
              amountInMax: expectedInputAmount,
              amountOutMin,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.lp1,
            },
            { value: expectedInputAmount }
          )
        ).to.be.revertedWith("tokenIn != wETH");
      });

      if (params.collateral.name !== "wETH") {
        it("should deposit using ETH only", async () => {
          const amountOutMin = parseEther("10");

          path = [weth.address, tokenOut.address];

          const [amountOut] = await uni.router.getAmountsIn(amountOutMin, path);

          const amountInMax = amountOut.mul(120).div(100);

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapTokensForExactTokens", [
            amountOut,
            amountInMax,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const queueWETHBalanceBefore = await weth.balanceOf(addresses.queue);
          const queueTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.queue
          );
          const lp1ETHBalanceBefore = await provider.getBalance(addresses.lp1);

          const tx = await queue[
            "swapAndDeposit((address,uint256,uint256,address,address,bytes,address))"
          ](
            {
              tokenIn: weth.address,
              amountInMax: 0,
              amountOutMin: 0,
              callee: uni.router.address,
              allowanceTarget: uni.router.address,
              data,
              refundAddress: addresses.lp1,
            },
            { value: amountInMax, gasPrice }
          );

          const receipt = await tx.wait();
          const gasFee = receipt.gasUsed.mul(gasPrice);

          const queueWETHBalanceAfter = await weth.balanceOf(addresses.queue);
          const queueTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.queue
          );
          const lp1ETHBalanceAfter = await provider.getBalance(addresses.lp1);

          assert.bnEqual(
            await queue["balanceOf(address,uint256)"](
              addresses.lp1,
              await queue.getCurrentTokenId()
            ),
            amountOut
          );

          almost(queueWETHBalanceAfter, queueWETHBalanceBefore);

          almost(
            queueTokenOutBalanceAfter.sub(queueTokenOutBalanceBefore),
            amountOut
          );

          almost(
            lp1ETHBalanceBefore.sub(lp1ETHBalanceAfter).sub(gasFee),
            amountInMax
          );
        });

        it("should deposit using non-collateral ERC20 token only", async () => {
          const amountOutMin = params.deposit;

          const [amountIn] = await uni.router.getAmountsIn(amountOutMin, path);

          const iface = new ethers.utils.Interface(uniswap.abi);

          const data = iface.encodeFunctionData("swapExactTokensForTokens", [
            amountIn,
            amountOutMin,
            path,
            addresses.exchange,
            (await time.now()) + 86400,
          ]);

          const queueTokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.queue
          );

          const lp1TokenInBalanceBefore = await tokenIn.balanceOf(
            addresses.lp1
          );

          const queueTokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.queue
          );

          const lp1TokenOutBalanceBefore = await tokenOut.balanceOf(
            addresses.lp1
          );

          await tokenIn
            .connect(signers.lp1)
            .approve(addresses.queue, ethers.constants.MaxUint256);

          await queue[
            "swapAndDeposit((address,uint256,uint256,address,address,bytes,address))"
          ]({
            tokenIn: tokenIn.address,
            amountInMax: amountIn,
            amountOutMin: amountOutMin,
            callee: uni.router.address,
            allowanceTarget: uni.router.address,
            data,
            refundAddress: addresses.lp1,
          });

          const queueTokenInBalanceAfter = await tokenIn.balanceOf(
            addresses.queue
          );

          const lp1TokenInBalanceAfter = await tokenIn.balanceOf(addresses.lp1);

          const queueTokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.queue
          );

          const lp1TokenOutBalanceAfter = await tokenOut.balanceOf(
            addresses.lp1
          );

          assert.bnEqual(
            await queue["balanceOf(address,uint256)"](
              addresses.lp1,
              await queue.getCurrentTokenId()
            ),
            amountOutMin
          );

          almost(queueTokenInBalanceAfter, queueTokenInBalanceBefore);

          almost(lp1TokenInBalanceBefore.sub(lp1TokenInBalanceAfter), amountIn);

          almost(
            queueTokenOutBalanceAfter.sub(queueTokenOutBalanceBefore),
            amountOutMin
          );

          almost(lp1TokenOutBalanceAfter, lp1TokenOutBalanceBefore);
        });
      }
    });

    describe("#withdraw(uint256)", () => {
      time.revertToSnapshotAfterEach(async () => {
        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        await queue["deposit(uint256)"](params.deposit);
      });

      it("should withdraw exact amount deposited", async () => {
        const lpBalanceBefore = await asset.balanceOf(addresses.lp1);
        await queue.cancel(params.deposit);

        const lpBalanceAfter = await asset.balanceOf(addresses.lp1);
        assert.bnEqual(lpBalanceBefore, lpBalanceAfter.sub(params.deposit));

        let lpClaimBalance = await queue["balanceOf(address,uint256)"](
          addresses.lp1,
          await queue.getCurrentTokenId()
        );

        // LPs Queue token is burned
        assert.isTrue(lpClaimBalance.isZero());
      });
    });

    describe("#redeem(uint256)", () => {
      describe("if epoch has not been incremented", () => {
        time.revertToSnapshotAfterEach(async () => {
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);
        });

        it("should revert if tokenId == currentTokenId", async () => {
          const tokenId = await queue.getCurrentTokenId();

          await expect(queue["redeem(uint256)"](tokenId)).to.be.revertedWith(
            "current claim token cannot be redeemed"
          );
        });
      });

      describe("else", () => {
        let tokenId: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);

          tokenId = await queue.getCurrentTokenId();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should burn claim tokens when shares are redeemed", async () => {
          await queue["redeem(uint256)"](tokenId);
          const balance = await queue.balanceOf(addresses.lp1, tokenId);
          assert.isTrue(balance.isZero());
        });

        it("should send redeemed vault shares to receiver", async () => {
          await queue["redeem(uint256)"](tokenId);

          const lpBalance = await vault.balanceOf(addresses.lp1);
          assert.bnEqual(lpBalance, params.deposit);

          const queueBalance = await vault.balanceOf(addresses.queue);
          assert.isTrue(queueBalance.isZero());
        });
      });
    });

    describe("#redeem(uint256,address)", () => {
      describe("if epoch has not been incremented", () => {
        time.revertToSnapshotAfterEach(async () => {
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);
        });

        it("should revert if tokenId == currentTokenId", async () => {
          const tokenId = await queue.getCurrentTokenId();

          await expect(
            queue["redeem(uint256,address)"](tokenId, addresses.lp2)
          ).to.be.revertedWith("current claim token cannot be redeemed");
        });
      });

      describe("else", () => {
        let tokenId: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);

          tokenId = await queue.getCurrentTokenId();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should burn claim tokens when shares are redeemed", async () => {
          await queue["redeem(uint256,address)"](tokenId, addresses.lp2);
          const balance = await queue.balanceOf(addresses.lp2, tokenId);
          assert.isTrue(balance.isZero());
        });

        it("should send redeemed vault shares to receiver", async () => {
          await queue["redeem(uint256,address)"](tokenId, addresses.lp2);

          const lpBalance = await vault.balanceOf(addresses.lp2);
          assert.bnEqual(lpBalance, params.deposit);

          const queueBalance = await vault.balanceOf(addresses.queue);
          assert.isTrue(queueBalance.isZero());
        });
      });
    });

    describe("#redeem(uint256,address,address)", () => {
      describe("if epoch has not been incremented", () => {
        time.revertToSnapshotAfterEach(async () => {
          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);
        });

        it("should revert if tokenId == currentTokenId", async () => {
          const tokenId = await queue.getCurrentTokenId();
          await queue.setApprovalForAll(addresses.lp2, true);

          await expect(
            queue
              .connect(signers.lp2)
              ["redeem(uint256,address,address)"](
                tokenId,
                addresses.lp2,
                addresses.lp1
              )
          ).to.be.revertedWith("current claim token cannot be redeemed");
        });
      });

      describe("else", () => {
        let tokenId: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          await knoxUtil.initializeAuction();

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          await queue["deposit(uint256)"](params.deposit);

          tokenId = await queue.getCurrentTokenId();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();
        });

        it("should revert if the owner has not approved the receiver", async () => {
          await expect(
            queue
              .connect(signers.lp2)
              ["redeem(uint256,address,address)"](
                tokenId,
                addresses.lp2,
                addresses.lp1
              )
          ).to.be.revertedWith("ERC1155: caller is not owner nor approved");
        });

        it("should burn claim tokens when shares are redeemed", async () => {
          await queue.setApprovalForAll(addresses.lp2, true);

          await queue
            .connect(signers.lp2)
            ["redeem(uint256,address,address)"](
              tokenId,
              addresses.lp2,
              addresses.lp1
            );
          const balance = await queue.balanceOf(addresses.lp1, tokenId);
          assert.isTrue(balance.isZero());
        });

        it("should send redeemed vault shares to receiver", async () => {
          await queue.setApprovalForAll(addresses.lp2, true);

          await queue
            .connect(signers.lp2)
            ["redeem(uint256,address,address)"](
              tokenId,
              addresses.lp2,
              addresses.lp1
            );

          const lpBalance = await vault.balanceOf(addresses.lp2);
          assert.bnEqual(lpBalance, params.deposit);

          const queueBalance = await vault.balanceOf(addresses.queue);
          assert.isTrue(queueBalance.isZero());
        });
      });
    });

    describe("#redeemMax()", () => {
      let tokenId1: BigNumber;
      let tokenId2: BigNumber;
      let tokenId3: BigNumber;

      time.revertToSnapshotAfterEach(async () => {
        let [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);
        tokenId1 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);
        tokenId2 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 2
        await queue["deposit(uint256)"](params.deposit);
        tokenId3 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();
      });

      it("should burn all claim tokens when shares are redeemed", async () => {
        await queue["redeemMax()"]();

        const balance1 = await queue.balanceOf(addresses.lp1, tokenId1);
        assert.isTrue(balance1.isZero());

        const balance2 = await queue.balanceOf(addresses.lp1, tokenId2);
        assert.isTrue(balance2.isZero());

        const balance3 = await queue.balanceOf(addresses.lp1, tokenId3);
        assert.isTrue(balance3.isZero());
      });

      it("should send all of redeemed vault shares to reciever", async () => {
        await queue["redeemMax()"]();

        const lpBalance = await vault.balanceOf(addresses.lp1);
        assert.bnEqual(lpBalance, params.deposit.mul(3));

        const queueBalance = await vault.balanceOf(addresses.queue);
        assert.isTrue(queueBalance.isZero());
      });
    });

    describe("#redeemMax(address)", () => {
      let tokenId1: BigNumber;
      let tokenId2: BigNumber;
      let tokenId3: BigNumber;

      time.revertToSnapshotAfterEach(async () => {
        let [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);
        tokenId1 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);
        tokenId2 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 2
        await queue["deposit(uint256)"](params.deposit);
        tokenId3 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();
      });

      it("should burn all claim tokens when shares are redeemed", async () => {
        await queue["redeemMax(address)"](addresses.lp2);

        const balance1 = await queue.balanceOf(addresses.lp2, tokenId1);
        assert.isTrue(balance1.isZero());

        const balance2 = await queue.balanceOf(addresses.lp2, tokenId2);
        assert.isTrue(balance2.isZero());

        const balance3 = await queue.balanceOf(addresses.lp2, tokenId3);
        assert.isTrue(balance3.isZero());
      });

      it("should send all available redeemed vault shares to reciever", async () => {
        await queue["redeemMax(address)"](addresses.lp2);

        // reminder: the deposit function redeems vault shares when called
        const lpBalance = await vault.balanceOf(addresses.lp2);
        assert.bnEqual(lpBalance, params.deposit);

        const queueBalance = await vault.balanceOf(addresses.queue);
        assert.isTrue(queueBalance.isZero());
      });
    });

    describe("#redeemMax(address,address)", () => {
      let tokenId1: BigNumber;
      let tokenId2: BigNumber;
      let tokenId3: BigNumber;

      time.revertToSnapshotAfterEach(async () => {
        let [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);
        tokenId1 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);
        tokenId2 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 2
        await queue["deposit(uint256)"](params.deposit);
        tokenId3 = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();
        await knoxUtil.initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();
      });

      it("should burn all claim tokens when shares are redeemed", async () => {
        await queue.setApprovalForAll(addresses.lp3, true);

        await queue
          .connect(signers.lp3)
          ["redeemMax(address,address)"](addresses.lp2, addresses.lp1);

        const balance1 = await queue.balanceOf(addresses.lp2, tokenId1);
        assert.isTrue(balance1.isZero());

        const balance2 = await queue.balanceOf(addresses.lp2, tokenId2);
        assert.isTrue(balance2.isZero());

        const balance3 = await queue.balanceOf(addresses.lp2, tokenId3);
        assert.isTrue(balance3.isZero());
      });

      it("should send all available redeemed vault shares to reciever", async () => {
        await queue.setApprovalForAll(addresses.lp3, true);

        await queue
          .connect(signers.lp3)
          ["redeemMax(address,address)"](addresses.lp2, addresses.lp1);

        // reminder: the deposit function redeems vault shares when called
        const lpBalance = await vault.balanceOf(addresses.lp2);
        assert.bnEqual(lpBalance, params.deposit);

        const queueBalance = await vault.balanceOf(addresses.queue);
        assert.isTrue(queueBalance.isZero());
      });
    });

    describe("#processDeposits()", () => {
      describe("if shares are not minted", () => {
        time.revertToSnapshotAfterEach(async () => {});

        it("should revert if !vault", async () => {
          await expect(queue.processDeposits()).to.be.revertedWith("!vault");
        });

        it("should set price per share to 0 if shares are not minted", async () => {
          let tokenId = await queue.getCurrentTokenId();
          await queue.connect(signers.vault).processDeposits();

          let pricePerShare = await queue.getPricePerShare(tokenId);
          assert.isTrue(pricePerShare.isZero());
        });
      });

      describe("else", () => {
        let endTime: BigNumber;
        let epoch: BigNumber;

        time.revertToSnapshotAfterEach(async () => {
          [, endTime, epoch] = await knoxUtil.initializeAuction();

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          // deposits in epoch 0
          await queue["deposit(uint256)"](params.deposit);

          await asset
            .connect(signers.lp2)
            .approve(addresses.queue, params.deposit);

          // deposits in epoch 0
          await queue.connect(signers.lp2)["deposit(uint256)"](params.deposit);

          await asset
            .connect(signers.lp3)
            .approve(addresses.queue, params.deposit);

          // deposits in epoch 0
          await queue.connect(signers.lp3)["deposit(uint256)"](params.deposit);

          await time.fastForwardToFriday8AM();
        });

        it("should deposit all of queued ERC20 tokens into vault", async () => {
          let erc20Balance = await asset.balanceOf(addresses.queue);
          assert.bnEqual(erc20Balance, params.deposit.mul(3));

          await queue.connect(signers.vault).processDeposits();

          erc20Balance = await asset.balanceOf(addresses.queue);
          assert.isTrue(erc20Balance.isZero());
        });

        it("should calculate price per share correctly", async () => {
          // disable performance fees
          await vault.connect(signers.deployer).setPerformanceFee64x64(0);

          let tokenId = await queue.getCurrentTokenId();

          await knoxUtil.initializeEpoch();

          await time.increaseTo(endTime);
          await auction.finalizeAuction(epoch);
          await vault.connect(signers.keeper).processAuction();

          let pricePerShare = await queue.getPricePerShare(tokenId);

          assert.bnEqual(pricePerShare, parseUnits("1", 18));

          [, endTime, epoch] = await knoxUtil.initializeAuction();

          // simluate vault profits, dilute shares by half
          await asset
            .connect(signers.deployer)
            .transfer(addresses.vault, params.deposit.mul(3));

          await asset
            .connect(signers.lp1)
            .approve(addresses.queue, params.deposit);

          // deposits in epoch 1
          await queue["deposit(uint256)"](params.deposit);

          await asset
            .connect(signers.lp2)
            .approve(addresses.queue, params.deposit);

          // deposits in epoch 1
          await queue.connect(signers.lp2)["deposit(uint256)"](params.deposit);

          tokenId = await queue.getCurrentTokenId();

          await time.fastForwardToFriday8AM();
          await knoxUtil.initializeEpoch();

          await time.increaseTo(endTime);
          await auction.finalizeAuction(epoch);
          await vault.connect(signers.keeper).processAuction();

          pricePerShare = await queue.getPricePerShare(tokenId);

          assert.bnEqual(pricePerShare, parseUnits("5", 17));
        });
      });
    });

    describe("#previewUnredeemed(uint256)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should preview unredeemed shares", async () => {
        let tokenId = await queue.getCurrentTokenId();
        let shares = await queue["previewUnredeemed(uint256)"](tokenId);

        assert.isTrue(shares.isZero());

        // simluate vault profits, not included in totalSupply
        await asset
          .connect(signers.deployer)
          .transfer(addresses.vault, params.deposit.mul(4));

        let [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);

        tokenId = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();

        // totalAssets = 40,000
        // totalSupply = 0
        await vault.connect(signers.keeper).initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        shares = await queue["previewUnredeemed(uint256)"](tokenId);
        assert.bnEqual(shares, params.deposit);

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);

        tokenId = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();

        // totalAssets = 50,000
        // totalSupply = 10,000
        await vault.connect(signers.keeper).initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        shares = await queue["previewUnredeemed(uint256)"](tokenId);

        const pricePerShare = await queue.getPricePerShare(tokenId);
        const expectedShares = pricePerShare
          .mul(params.deposit)
          .div(parseUnits("1", 18));

        assert.bnEqual(shares, expectedShares);
      });
    });

    describe("#previewUnredeemed(uint256,address)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should preview unredeemed shares", async () => {
        let tokenId = await queue.getCurrentTokenId();
        let shares = await queue
          .connect(signers.lp2)
          ["previewUnredeemed(uint256,address)"](tokenId, addresses.lp1);

        assert.isTrue(shares.isZero());

        // simluate vault profits, not included in totalSupply
        await asset
          .connect(signers.deployer)
          .transfer(addresses.vault, params.deposit.mul(4));

        let [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 0
        await queue["deposit(uint256)"](params.deposit);

        tokenId = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();

        // totalAssets = 40,000
        // totalSupply = 0
        await vault.connect(signers.keeper).initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        shares = await queue
          .connect(signers.lp2)
          ["previewUnredeemed(uint256,address)"](tokenId, addresses.lp1);
        assert.bnEqual(shares, params.deposit);

        [, endTime, epoch] = await knoxUtil.initializeAuction();

        await asset
          .connect(signers.lp1)
          .approve(addresses.queue, params.deposit);

        // deposits in epoch 1
        await queue["deposit(uint256)"](params.deposit);

        tokenId = await queue.getCurrentTokenId();

        await time.fastForwardToFriday8AM();

        // totalAssets = 50,000
        // totalSupply = 10,000
        await vault.connect(signers.keeper).initializeEpoch();

        await time.increaseTo(endTime);
        await auction.finalizeAuction(epoch);
        await vault.connect(signers.keeper).processAuction();

        shares = await queue
          .connect(signers.lp2)
          ["previewUnredeemed(uint256,address)"](tokenId, addresses.lp1);

        const pricePerShare = await queue.getPricePerShare(tokenId);
        const expectedShares = pricePerShare
          .mul(params.deposit)
          .div(parseUnits("1", 18));

        assert.bnEqual(shares, expectedShares);
      });
    });

    describe("#formatClaimTokenId(uint64)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should format claim token id correctly", async () => {
        for (let i = 0; i < 10000; i++) {
          let tokenId = formatClaimTokenId({
            address: addresses.queue,
            epoch: BigNumber.from(i),
          });
          assert.bnEqual(
            await queue.formatClaimTokenId(i),
            BigNumber.from(tokenId)
          );
        }
      });
    });

    describe("#parseClaimTokenId(uint256)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should parse claim token id correctly", async () => {
        for (let i = 0; i < 10000; i++) {
          const bn = BigNumber.from(i);
          let tokenId = formatClaimTokenId({
            address: addresses.queue,
            epoch: bn,
          });
          let [address, epoch] = await queue.parseClaimTokenId(tokenId);
          assert.equal(address, addresses.queue);
          assert.bnEqual(epoch, bn);
        }
      });
    });
  });
}
