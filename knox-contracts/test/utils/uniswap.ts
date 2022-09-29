import { network } from "hardhat";
import { BigNumberish } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  MockERC20,
  MockERC20__factory,
  UniswapV2Factory,
  UniswapV2Factory__factory,
  UniswapV2Pair,
  UniswapV2Pair__factory,
  UniswapV2Router02,
  UniswapV2Router02__factory,
} from "../../types";

import { UNISWAP_V2_FACTORY, UNISWAP_V2_ROUTER02 } from "../../constants";

const chainId = network.config.chainId;

export const abi = [
  "function swapExactTokensForTokens(uint,uint,address[],address,uint) returns (uint[])",
  "function swapExactETHForTokens(uint, address[], address to, uint) returns (uint[])",
  "function swapTokensForExactTokens(uint,uint,address[],address,uint) returns (uint[])",
  "function swapETHForExactTokens(uint,address[],address,uint) returns (uint[])",
];

export interface IUniswap {
  factory: UniswapV2Factory;
  router: UniswapV2Router02;
  tokenIn: MockERC20;
}

export async function createUniswap(admin: SignerWithAddress, weth: string) {
  const factory = UniswapV2Factory__factory.connect(
    UNISWAP_V2_FACTORY[chainId],
    admin
  );

  const router = UniswapV2Router02__factory.connect(
    UNISWAP_V2_ROUTER02[chainId],
    admin
  );

  const tokenIn = await new MockERC20__factory(admin).deploy("", 18);

  return { factory, router, tokenIn };
}

export async function createUniswapPair(
  admin: SignerWithAddress,
  factory: UniswapV2Factory,
  token0: string,
  token1: string
) {
  await factory.createPair(token0, token1);
  const pairAddr = await factory.getPair(token0, token1);
  return UniswapV2Pair__factory.connect(pairAddr, admin);
}

export async function depositUniswapLiquidity(
  user: SignerWithAddress,
  pair: UniswapV2Pair,
  amountToken0: BigNumberish,
  amountToken1: BigNumberish
) {
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  let i = 0;
  for (const t of [token0, token1]) {
    const amount = i === 0 ? amountToken0 : amountToken1;
    await MockERC20__factory.connect(t, user).mint(pair.address, amount);
    i++;
  }
  await pair.mint(user.address);
}
