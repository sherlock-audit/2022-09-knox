import { ethers, network } from "hardhat";
import { fixedFromFloat } from "@premia/utils";
import { parseUnits } from "ethers/lib/utils";

import { diamondCut } from "./diamond";

require("dotenv").config({ path: "../.env.prod" });

import {
  Auction__factory,
  AuctionProxy__factory,
  IVault__factory,
  Queue__factory,
  QueueProxy__factory,
  Registry__factory,
  VaultDiamond__factory,
  VaultAdmin__factory,
  VaultBase__factory,
  VaultView__factory,
} from "../types";

const {
  POOL,
  PRICER,
  EXCHANGE,
  REGISTRY,
  KEEPER,
  FEE_RECIPIENT,
  IS_CALL,
  WETH,
  MAX_TVL,
  DELTA,
  DELTA_OFFSET,
  RESERVE_RATE,
  PERFORMANCE_FEE,
  WITHDRAWAL_FEE,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} = process.env;

async function main() {
  const [deployer] = await ethers.getSigners();

  const params = {
    isCall: IS_CALL === "true",
    maxTVL: parseUnits(MAX_TVL, 18),
    minSize: parseUnits("1", 17),
    delta: Number(DELTA),
    deltaOffset: Number(DELTA_OFFSET),
    reserveRate: Number(RESERVE_RATE),
    performanceFee: Number(PERFORMANCE_FEE),
    withdrawalFee: Number(WITHDRAWAL_FEE),
  };

  // deploy Vault
  const initProxy = {
    isCall: params.isCall,
    minSize: params.minSize,
    delta64x64: fixedFromFloat(params.delta),
    deltaOffset64x64: fixedFromFloat(params.deltaOffset),
    reserveRate64x64:
      params.reserveRate > 0 ? fixedFromFloat(params.reserveRate) : 0,
    performanceFee64x64:
      params.performanceFee > 0 ? fixedFromFloat(params.performanceFee) : 0,
    withdrawalFee64x64:
      params.withdrawalFee > 0 ? fixedFromFloat(params.withdrawalFee) : 0,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    keeper: KEEPER,
    feeRecipient: FEE_RECIPIENT,
    pool: POOL,
  };

  const vaultDiamond = await new VaultDiamond__factory(deployer).deploy(
    initProxy
  );

  console.log(`Vault Diamond deployed @ ${vaultDiamond.address}`);
  console.log(`\t(initProxy: ${JSON.stringify(initProxy)})`);

  await vaultDiamond.deployed();

  let registeredSelectors = [
    vaultDiamond.interface.getSighash("supportsInterface(bytes4)"),
  ];

  const vaultBaseFactory = new VaultBase__factory(deployer);
  const vaultBaseContract = await vaultBaseFactory.deploy(params.isCall, POOL);
  await vaultBaseContract.deployed();

  console.log(`Vault Base deployed @ ${vaultBaseContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  registeredSelectors = registeredSelectors.concat(
    await diamondCut(
      vaultDiamond,
      vaultBaseContract.address,
      vaultBaseFactory,
      registeredSelectors
    )
  );

  const vaultAdminFactory = new VaultAdmin__factory(deployer);
  const vaultAdminContract = await vaultAdminFactory.deploy(
    params.isCall,
    POOL
  );

  await vaultAdminContract.deployed();

  console.log(`Vault Admin deployed @ ${vaultAdminContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  registeredSelectors = registeredSelectors.concat(
    await diamondCut(
      vaultDiamond,
      vaultAdminContract.address,
      vaultAdminFactory,
      registeredSelectors
    )
  );

  const vaultViewFactory = new VaultView__factory(deployer);
  const vaultViewContract = await vaultViewFactory.deploy(params.isCall, POOL);

  await vaultViewContract.deployed();

  console.log(`Vault View deployed @ ${vaultViewContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  registeredSelectors.concat(
    await diamondCut(
      vaultDiamond,
      vaultViewContract.address,
      vaultViewFactory,
      registeredSelectors
    )
  );

  const vault = IVault__factory.connect(vaultDiamond.address, deployer);

  // deploy Queue
  let queue = await new Queue__factory(deployer).deploy(
    params.isCall,
    POOL,
    vault.address,
    WETH
  );

  await queue.deployed();

  console.log(`Queue Implementation deployed @ ${queue.address}`);
  console.log(
    `\t(isCall: ${params.isCall}, pool: ${POOL}, vault: ${vault.address}, weth: ${WETH})`
  );

  const queueProxy = await new QueueProxy__factory(deployer).deploy(
    params.maxTVL,
    EXCHANGE,
    queue.address
  );

  await queueProxy.deployed();

  console.log(`Queue Proxy deployed @ ${queueProxy.address}`);
  console.log(
    `\t(maxTVL: ${params.maxTVL}, exchange: ${EXCHANGE}, implementation: ${queue.address})`
  );

  // deploy Auction
  let auction = await new Auction__factory(deployer).deploy(
    params.isCall,
    POOL,
    vault.address,
    WETH
  );

  await auction.deployed();

  console.log(`Auction Implementation deployed @ ${auction.address}`);
  console.log(
    `\t(isCall: ${params.isCall}, pool: ${POOL}, vault: ${vault.address}, weth: ${WETH})`
  );

  const auctionProxy = await new AuctionProxy__factory(deployer).deploy(
    params.minSize,
    EXCHANGE,
    auction.address
  );

  await auctionProxy.deployed();

  console.log(`Auction Proxy deployed @ ${auctionProxy.address}`);
  console.log(
    `\t(minSize: ${params.minSize}, exchange: ${EXCHANGE}, implementation: ${auction.address})`
  );

  await vault.connect(deployer).setAuction(auction.address);
  await vault.connect(deployer).setPricer(PRICER);
  await vault.connect(deployer).setQueue(queue.address);

  await Registry__factory.connect(REGISTRY, deployer).addVault({
    vault: vault.address,
    queue: queue.address,
    auction: auction.address,
    pricer: PRICER,
  });

  console.log(`-------------------------------------------------------------`);
  console.log(`ChainId: ${network.config.chainId}`);
  console.log(`-------------------------------------------------------------`);

  console.log(`Vault Diamond: ${vaultDiamond.address}`);
  console.log(`Vault Base: ${vaultBaseContract.address}`);
  console.log(`Vault Admin: ${vaultAdminContract.address}`);
  console.log(`Vault View: ${vaultViewContract.address}`);
  console.log(`Queue Implementation: ${queue.address}`);
  console.log(`Queue Proxy: ${queueProxy.address}`);
  console.log(`Auction Implementation: ${auction.address}`);
  console.log(`Auction Proxy: ${auctionProxy.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
