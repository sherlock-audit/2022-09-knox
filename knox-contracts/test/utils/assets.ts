import { network } from "hardhat";

import {
  ETH_PRICE_ORACLE,
  ETH_PRICE_ORACLE_DECIMALS,
  ETH_SPOT_PRICE,
  WETH_NAME,
  WETH_ADDRESS,
  WETH_DECIMALS,
  BTC_PRICE_ORACLE,
  BTC_PRICE_ORACLE_DECIMALS,
  BTC_SPOT_PRICE,
  WBTC_NAME,
  WBTC_ADDRESS,
  WBTC_DECIMALS,
  DAI_PRICE_ORACLE,
  DAI_PRICE_ORACLE_DECIMALS,
  DAI_SPOT_PRICE,
  DAI_NAME,
  DAI_ADDRESS,
  DAI_DECIMALS,
  LINK_PRICE_ORACLE,
  LINK_PRICE_ORACLE_DECIMALS,
  LINK_SPOT_PRICE,
  LINK_NAME,
  LINK_ADDRESS,
  LINK_DECIMALS,
  WETH_DAI_POOL,
  WBTC_DAI_POOL,
  LINK_DAI_POOL,
  PREMIA_VOLATILITY_SURFACE_ORACLE,
} from "../../constants";

const chainId = network.config.chainId;

export const ETH = {
  name: WETH_NAME,
  address: WETH_ADDRESS[chainId],
  decimals: WETH_DECIMALS,
  oracle: {
    address: ETH_PRICE_ORACLE[chainId],
    decimals: ETH_PRICE_ORACLE_DECIMALS,
    price: ETH_SPOT_PRICE,
  },
};

export const BTC = {
  name: WBTC_NAME,
  address: WBTC_ADDRESS[chainId],
  decimals: WBTC_DECIMALS,
  oracle: {
    address: BTC_PRICE_ORACLE[chainId],
    decimals: BTC_PRICE_ORACLE_DECIMALS,
    price: BTC_SPOT_PRICE,
  },
};

export const DAI = {
  name: DAI_NAME,
  address: DAI_ADDRESS[chainId],
  decimals: DAI_DECIMALS,
  oracle: {
    address: DAI_PRICE_ORACLE[chainId],
    decimals: DAI_PRICE_ORACLE_DECIMALS,
    price: DAI_SPOT_PRICE,
  },
};

export const LINK = {
  name: LINK_NAME,
  address: LINK_ADDRESS[chainId],
  decimals: LINK_DECIMALS,
  oracle: {
    address: LINK_PRICE_ORACLE[chainId],
    decimals: LINK_PRICE_ORACLE_DECIMALS,
    price: LINK_SPOT_PRICE,
  },
};

export const PREMIA = {
  WETH_DAI: {
    address: WETH_DAI_POOL[chainId],
    base: DAI,
    underlying: ETH,
    volatility: PREMIA_VOLATILITY_SURFACE_ORACLE[chainId],
  },
  WBTC_DAI: {
    address: WBTC_DAI_POOL[chainId],
    base: DAI,
    underlying: BTC,
    volatility: PREMIA_VOLATILITY_SURFACE_ORACLE[chainId],
  },
  LINK_DAI: {
    address: LINK_DAI_POOL[chainId],
    base: DAI,
    underlying: LINK,
    volatility: PREMIA_VOLATILITY_SURFACE_ORACLE[chainId],
  },
};
