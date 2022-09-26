import { ethers, network } from "hardhat";

import { Registry__factory } from "../types";

async function main() {
  const [deployer] = await ethers.getSigners();

  const registry = await new Registry__factory(deployer).deploy();

  await registry.deployed();

  console.log(`-------------------------------------------------------------`);
  console.log(`ChainId: ${network.config.chainId}`);
  console.log(`-------------------------------------------------------------`);

  console.log(`Registry: ${registry.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
