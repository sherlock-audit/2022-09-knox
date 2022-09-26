import { ethers, network } from "hardhat";
import { parseUnits } from "ethers/lib/utils";

import { printFacets } from "./diamond";

require("dotenv").config({ path: "../.env.prod" });

import {
  VaultAdmin__factory,
  VaultBase__factory,
  VaultView__factory,
} from "../types";

const {
  POOL,
  IS_CALL,
  MAX_TVL,
  DELTA,
  DELTA_OFFSET,
  RESERVE_RATE,
  PERFORMANCE_FEE,
  WITHDRAWAL_FEE,
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

  const vaultBaseFactory = new VaultBase__factory(deployer);
  const vaultBaseContract = await vaultBaseFactory.deploy(params.isCall, POOL);

  console.log(`Vault Base deployed @ ${vaultBaseContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  printFacets(vaultBaseContract.address, vaultBaseFactory);
  await vaultBaseContract.deployed();

  const vaultAdminFactory = new VaultAdmin__factory(deployer);
  const vaultAdminContract = await vaultAdminFactory.deploy(
    params.isCall,
    POOL
  );

  printFacets(vaultAdminContract.address, vaultAdminFactory);
  await vaultAdminContract.deployed();

  console.log(`Vault Admin deployed @ ${vaultAdminContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  const vaultViewFactory = new VaultView__factory(deployer);
  const vaultViewContract = await vaultViewFactory.deploy(params.isCall, POOL);

  printFacets(vaultViewContract.address, vaultViewFactory);
  await vaultViewContract.deployed();

  console.log(`Vault View deployed @ ${vaultViewContract.address}`);
  console.log(`\t(isCall: ${params.isCall}, pool: ${POOL})`);

  console.log(`-------------------------------------------------------------`);
  console.log(`ChainId: ${network.config.chainId}`);
  console.log(`-------------------------------------------------------------`);

  console.log(`Vault Base: ${vaultBaseContract.address}`);
  console.log(`Vault Admin: ${vaultAdminContract.address}`);
  console.log(`Vault View: ${vaultViewContract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
