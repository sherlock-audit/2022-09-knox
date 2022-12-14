/* eslint-disable no-unused-vars */
export enum CHAINID {
  ARB_MAINNET = 42161,
  GOERLI = 5,
}
/* eslint-enable */

export const BLOCK_NUMBER = {
  // MUST BE ON A MONDAY
  [CHAINID.ARB_MAINNET]: 19700000, // Aug-08-2022 09:31:23 AM +UTC
  [CHAINID.GOERLI]: 7662000, // Sep-26-2022 08:44:00 AM +UTC
};

export const TEST_URI = {
  [CHAINID.ARB_MAINNET]: process.env.ARBITRUM_URI,
  [CHAINID.GOERLI]: process.env.GOERLI_URI,
};

export const UNDERLYING_FREE_LIQ_TOKEN_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const BASE_FREE_LIQ_TOKEN_ID =
  "0x0100000000000000000000000000000000000000000000000000000000000000";
export const UNDERLYING_RESERVED_LIQ_TOKEN_ID =
  "0x0200000000000000000000000000000000000000000000000000000000000000";
export const BASE_RESERVED_LIQ_TOKEN_ID =
  "0x0300000000000000000000000000000000000000000000000000000000000000";

/**
 * Assets
 */
export const WETH_ADDRESS = {
  [CHAINID.ARB_MAINNET]: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
};

export const WBTC_ADDRESS = {
  [CHAINID.ARB_MAINNET]: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
};

export const DAI_ADDRESS = {
  [CHAINID.ARB_MAINNET]: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
};

export const LINK_ADDRESS = {
  [CHAINID.ARB_MAINNET]: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
};

export const WETH_NAME = "wETH";
export const WBTC_NAME = "wBTC";
export const DAI_NAME = "DAI";
export const LINK_NAME = "LINK";

export const WETH_DECIMALS = 18;
export const WBTC_DECIMALS = 8;
export const DAI_DECIMALS = 18;
export const LINK_DECIMALS = 18;

/**
 * Assets Storage Slots
 *
 * Used https://npmjs.com/package/slot20 to get slots.
 */
export const SLOTS = {
  [DAI_ADDRESS[CHAINID.ARB_MAINNET]]: 2,
  [WETH_ADDRESS[CHAINID.ARB_MAINNET]]: 51,
  [WBTC_ADDRESS[CHAINID.ARB_MAINNET]]: 51,
  [LINK_ADDRESS[CHAINID.ARB_MAINNET]]: 51,
};

/**
 * Oracles
 *
 * Chainlink: https://data.chain.link/
 */
export const ETH_PRICE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
};

export const BTC_PRICE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0x6ce185860a4963106506C203335A2910413708e9",
};

export const USDC_PRICE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0x50834f3163758fcc1df9973b6e91f0f0f0434ad3",
};

export const DAI_PRICE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB",
};

export const LINK_PRICE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0x86E53CF1B870786351Da77A57575e79CB55812CB",
};

export const ETH_PRICE_ORACLE_DECIMALS = 8;
export const BTC_PRICE_ORACLE_DECIMALS = 8;
export const USDC_PRICE_ORACLE_DECIMALS = 8;
export const DAI_PRICE_ORACLE_DECIMALS = 8;
export const LINK_PRICE_ORACLE_DECIMALS = 8;

export const ETH_SPOT_PRICE = 200000000000;
export const BTC_SPOT_PRICE = 2000000000000;
export const DAI_SPOT_PRICE = 100000000;
export const LINK_SPOT_PRICE = 1000000000;

/**
 * Premia Deployments
 * https://github.com/Premian-Labs/premia-contracts/blob/master/docs/deployments
 */
export const WETH_DAI_POOL = {
  [CHAINID.ARB_MAINNET]: "0xE5DbC4EDf467B609A063c7ea7fAb976C6b9BAa1a",
};

export const WBTC_DAI_POOL = {
  [CHAINID.ARB_MAINNET]: "0xb5fE3bc2eF4c34cC233922dfF2Fcb1B1BF89A38E",
};

export const LINK_DAI_POOL = {
  [CHAINID.ARB_MAINNET]: "0xf87Ca9EB60c2E40A6C5Ab14ca291934a95F845Ff",
};

export const PREMIA_VOLATILITY_SURFACE_ORACLE = {
  [CHAINID.ARB_MAINNET]: "0xC4B2C51f969e0713E799De73b7f130Fb7Bb604CF",
};

export const PREMIA_MULTISIG = {
  [CHAINID.ARB_MAINNET]: "0xa079C6B032133b95Cf8b3d273D27eeb6B110a469",
};

export const PREMIA_DIAMOND = {
  [CHAINID.ARB_MAINNET]: "0x89b36CE3491f2258793C7408Bd46aac725973BA2",
};

export const PREMIA_EXCHANGE_HELPER = {
  [CHAINID.ARB_MAINNET]: "0xD8A0D357171beBC63CeA559c4e9CD182c1bf25ef",
};

/**
 * Uniswap V2
 */
export const UNISWAP_V2_FACTORY = {
  [CHAINID.ARB_MAINNET]: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
};

export const UNISWAP_V2_ROUTER02 = {
  [CHAINID.ARB_MAINNET]: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
};
