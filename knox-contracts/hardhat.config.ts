import { HardhatUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "hardhat-dependency-compiler";
import "hardhat-docgen";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import "solidity-coverage";

require("dotenv").config();
require("dotenv").config({ path: "./.env.prod" });

import { TEST_URI, BLOCK_NUMBER } from "./constants";

let { ARBITRUM_URI, GOERLI_URI, REPORT_GAS, SIZER_ON_COMPILE, DEPLOYER_KEY } =
  process.env;

// Defaults to CHAINID=42161 so things will run with mainnet fork if not specified
const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 42161;

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.12",
        settings: {
          optimizer: {
            runs: 200,
            enabled: true,
          },
        },
      },
      // @uniswap/v2-periphery
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // @uniswap/v2-core
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      // WETH
      {
        version: "0.4.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: CHAINID,
      forking: {
        url: TEST_URI[CHAINID],
        blockNumber: BLOCK_NUMBER[CHAINID],
      },
    },
    arbitrum: {
      url: ARBITRUM_URI,
      chainId: CHAINID,
    },
    goerli: {
      url: GOERLI_URI,
      chainId: CHAINID,
    },
  },
  mocha: {
    timeout: 60000,
  },
  typechain: {
    outDir: "./types",
    target: "ethers-v5",
    alwaysGenerateOverloads: true,
  },
  dependencyCompiler: {
    paths: [
      "@uniswap/v2-core/contracts/UniswapV2Factory.sol",
      "@uniswap/v2-core/contracts/UniswapV2Pair.sol",
      "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol",
    ],
  },
  docgen: { clear: true },
  gasReporter: {
    enabled: REPORT_GAS === "true",
  },
  contractSizer: {
    runOnCompile: SIZER_ON_COMPILE === "true",
  },
};

if (DEPLOYER_KEY != null) {
  config.networks.arbitrum.accounts = [DEPLOYER_KEY];
  config.networks.goerli.accounts = [DEPLOYER_KEY];
}

export default config;
