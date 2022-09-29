import { ethers, network } from "hardhat";

import { Pricer__factory } from "../types";

require("dotenv").config({ path: "../.env.prod" });

const { POOL, VOLATILITY_ORACLE } = process.env;

async function main() {
  const [deployer] = await ethers.getSigners();

  const pricer = await new Pricer__factory(deployer).deploy(
    POOL,
    VOLATILITY_ORACLE
  );

  await pricer.deployed();

  console.log(`Pricer deployed @ ${pricer.address}`);
  console.log(`\t(pool: ${POOL}, volatilityOracle: ${VOLATILITY_ORACLE})`);

  console.log(`-------------------------------------------------------------`);
  console.log(`ChainId: ${network.config.chainId}`);
  console.log(`-------------------------------------------------------------`);

  console.log(`Pricer: ${pricer.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
