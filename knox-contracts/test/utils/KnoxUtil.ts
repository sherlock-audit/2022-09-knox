import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
const { provider } = ethers;
const { hexConcat, hexZeroPad } = ethers.utils;

import { fixedFromFloat } from "@premia/utils";

import { PREMIA_EXCHANGE_HELPER } from "../../constants";

import {
  Auction,
  MockERC20,
  Queue,
  Auction__factory,
  AuctionProxy__factory,
  PricerMock__factory,
  Queue__factory,
  QueueProxy__factory,
} from "../../types";

import { accounts, time, types, uniswap, PoolUtil, VaultUtil } from ".";

const chainId = network.config.chainId;

export interface ClaimTokenId {
  address: string;
  epoch: BigNumber;
}

export function formatClaimTokenId({ address, epoch }: ClaimTokenId) {
  return hexConcat([
    hexZeroPad(BigNumber.from(address).toHexString(), 20),
    hexZeroPad(epoch.toHexString(), 8),
  ]);
}

export async function getEvent(tx: any, event: string) {
  let receipt = await tx.wait();
  return receipt.events?.filter((x) => {
    return x.event == event;
  });
}

export async function getEventArgs(tx: any, event: string) {
  return (await getEvent(tx, event))[0].args;
}

interface KnoxUtilArgs {
  params: types.VaultParams;
  signers: types.Signers;
  addresses: types.Addresses;
  asset: MockERC20;
  vaultUtil: VaultUtil;
  poolUtil: PoolUtil;
  queue: Queue;
  auction: Auction;
  uni: uniswap.IUniswap;
}

export class KnoxUtil {
  params: types.VaultParams;
  signers: types.Signers;
  addresses: types.Addresses;
  asset: MockERC20;
  vaultUtil: VaultUtil;
  poolUtil: PoolUtil;
  queue: Queue;
  auction: Auction;
  uni: uniswap.IUniswap;

  constructor(props: KnoxUtilArgs) {
    this.params = props.params;
    this.signers = props.signers;
    this.addresses = props.addresses;
    this.asset = props.asset;
    this.vaultUtil = props.vaultUtil;
    this.poolUtil = props.poolUtil;
    this.queue = props.queue;
    this.auction = props.auction;
    this.uni = props.uni;
  }

  static async deploy(
    params: types.VaultParams,
    signers: types.Signers,
    addresses: types.Addresses
  ) {
    signers = await accounts.getSigners();
    addresses = await accounts.getAddresses(signers);

    // deploy Premia's Option Pool
    const poolUtil = await PoolUtil.deploy(
      params.underlying,
      params.base,
      signers.deployer
    );

    const pool = poolUtil.pool;
    addresses.pool = pool.address;

    // deploy Vault
    const vaultUtil = await VaultUtil.deploy(params, signers, addresses);

    const vault = vaultUtil.vault;
    addresses.vault = vault.address;

    addresses.exchange = PREMIA_EXCHANGE_HELPER[chainId];

    // deploy mock Pricer
    const mockPricer = await new PricerMock__factory(signers.deployer).deploy();

    await mockPricer.setDelta64x64(
      fixedFromFloat(params.delta),
      fixedFromFloat(params.delta).sub(fixedFromFloat(params.deltaOffset))
    );

    const underlyingPrice = params.underlying.oracle.price;
    const basePrice = params.base.oracle.price;

    const strike = underlyingPrice / basePrice;
    const strike64x64 = fixedFromFloat(strike);

    const offsetStrike64x64 = params.isCall
      ? fixedFromFloat(strike + strike / 10)
      : fixedFromFloat(strike - strike / 10);

    await mockPricer.setStrikePrices64x64(strike64x64, offsetStrike64x64);

    await mockPricer.setPrices64x64(
      fixedFromFloat(params.price.max),
      fixedFromFloat(params.price.min)
    );

    addresses.pricer = mockPricer.address;

    // deploy Queue
    let weth = poolUtil.weth;

    let queue = await new Queue__factory(signers.deployer).deploy(
      params.isCall,
      addresses.pool,
      addresses.vault,
      weth.address
    );

    const queueProxy = await new QueueProxy__factory(signers.deployer).deploy(
      params.maxTVL,
      addresses.exchange,
      queue.address
    );

    queue = Queue__factory.connect(queueProxy.address, signers.lp1);
    addresses.queue = queue.address;

    // deploy Auction

    let auction = await new Auction__factory(signers.deployer).deploy(
      params.isCall,
      addresses.pool,
      addresses.vault,
      weth.address
    );

    const auctionProxy = await new AuctionProxy__factory(
      signers.deployer
    ).deploy(params.minSize, addresses.exchange, auction.address);

    auction = Auction__factory.connect(auctionProxy.address, signers.buyer1);
    addresses.auction = auction.address;

    // inititialize Vault
    await vault.connect(signers.deployer).setAuction(addresses.auction);
    await vault.connect(signers.deployer).setPricer(addresses.pricer);
    await vault.connect(signers.deployer).setQueue(addresses.queue);

    const asset = vaultUtil.asset;

    // gets vault signer
    signers.vault = await accounts.impersonateVault(signers, addresses);

    // setup Uniswap Pools
    const uni = await uniswap.createUniswap(signers.deployer, weth.address);

    const pairTokenIn = await uniswap.createUniswapPair(
      signers.deployer,
      uni.factory,
      uni.tokenIn.address,
      weth.address
    );

    await uniswap.depositUniswapLiquidity(
      signers.deployer,
      pairTokenIn,
      params.mint.div(10),
      params.mint.div(10)
    );

    if (asset.address !== weth.address) {
      const pairTokenOut = await uniswap.createUniswapPair(
        signers.deployer,
        uni.factory,
        asset.address, // vault collateral asset
        weth.address
      );

      await uniswap.depositUniswapLiquidity(
        signers.deployer,
        pairTokenOut,
        params.mint.div(10),
        params.mint.div(10)
      );
    }

    return new KnoxUtil({
      params,
      signers,
      addresses,
      asset,
      vaultUtil,
      poolUtil,
      queue,
      auction,
      uni,
    });
  }

  async initializeAuction(): Promise<[BigNumber, BigNumber, BigNumber]> {
    const block = await provider.getBlock(await provider.getBlockNumber());
    await time.increaseTo(await time.getThursday8AM(block.timestamp));

    const vault = this.vaultUtil.vault;
    await vault.connect(this.signers.keeper).initializeAuction();

    const epoch = await vault.getEpoch();
    const auction = await this.auction.getAuction(epoch);

    return [auction.startTime, auction.endTime, epoch];
  }

  async processExpiredOptions() {
    const vault = this.vaultUtil.vault;
    const lastEpoch = (await vault.getEpoch()).sub(1);
    const expiredOption = await vault.getOption(lastEpoch);

    const pool = this.poolUtil.pool;
    const accounts = await pool.accountsByToken(expiredOption.longTokenId);
    let balances = BigNumber.from(0);

    for (const account of accounts) {
      const balance = await pool.balanceOf(account, expiredOption.longTokenId);
      balances = balances.add(balance);
    }

    await pool.processExpired(expiredOption.longTokenId, balances);
  }

  async initializeEpoch() {
    const vault = this.vaultUtil.vault;
    await vault.connect(this.signers.keeper).initializeEpoch();
  }
}
