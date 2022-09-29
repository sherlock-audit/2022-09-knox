import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployMockContract, MockContract } from "ethereum-waffle";
import { fixedFromFloat } from "@premia/utils";

import * as types from "./types";

import {
  IPremiaPool,
  MockERC20,
  IPremiaPool__factory,
  IPremiaProxyManager__factory,
  MockERC20__factory,
} from "../../types";

import { PREMIA_DIAMOND, PREMIA_MULTISIG, WETH_ADDRESS } from "../../constants";

const chainId = network.config.chainId;

interface PoolUtilArgs {
  weth: MockERC20;
  pool: IPremiaPool;
  underlyingSpotPriceOracle: MockContract;
  baseSpotPriceOracle: MockContract;
  underlyingAsset: MockERC20;
  baseAsset: MockERC20;
}

export class PoolUtil {
  weth: MockERC20;
  pool: IPremiaPool;
  underlyingSpotPriceOracle: MockContract;
  baseSpotPriceOracle: MockContract;
  underlyingAsset: MockERC20;
  baseAsset: MockERC20;

  constructor(props: PoolUtilArgs) {
    this.weth = props.weth;
    this.pool = props.pool;
    this.baseSpotPriceOracle = props.baseSpotPriceOracle;
    this.underlyingSpotPriceOracle = props.underlyingSpotPriceOracle;
    this.underlyingAsset = props.underlyingAsset;
    this.baseAsset = props.baseAsset;
  }

  static async deploy(
    underlying: types.Asset,
    base: types.Asset,
    deployer: SignerWithAddress
  ) {
    const underlyingSpotPriceOracle = await deployMockContract(
      deployer as any,
      [
        "function decimals() external view returns (uint8)",
        "function latestAnswer() external view returns (int256)",
        "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
      ]
    );

    await underlyingSpotPriceOracle.mock.decimals.returns(
      underlying.oracle.decimals
    );

    await underlyingSpotPriceOracle.mock.latestAnswer.returns(
      underlying.oracle.price
    );

    await underlyingSpotPriceOracle.mock.latestRoundData.returns(
      0,
      underlying.oracle.price,
      0,
      0,
      0
    );

    const baseSpotPriceOracle = await deployMockContract(deployer as any, [
      "function decimals() external view returns (uint8)",
      "function latestAnswer() external view returns (int256)",
      "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
    ]);

    await baseSpotPriceOracle.mock.decimals.returns(base.oracle.decimals);
    await baseSpotPriceOracle.mock.latestAnswer.returns(base.oracle.price);

    await baseSpotPriceOracle.mock.latestRoundData.returns(
      0,
      base.oracle.price,
      0,
      0,
      0
    );

    const underlyingAsset = await new MockERC20__factory(deployer).deploy(
      underlying.name,
      underlying.decimals
    );

    const baseAsset = await new MockERC20__factory(deployer).deploy(
      base.name,
      base.decimals
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [PREMIA_MULTISIG[chainId]],
    });

    const multisig = await ethers.getSigner(PREMIA_MULTISIG[chainId]);

    await deployer.sendTransaction({
      to: multisig.address,
      value: ethers.utils.parseEther("1.0"),
    });

    const premiaProxyManager = IPremiaProxyManager__factory.connect(
      PREMIA_DIAMOND[chainId],
      multisig
    );

    const poolAddress = await premiaProxyManager
      .connect(multisig)
      .callStatic.deployPool(
        baseAsset.address,
        underlyingAsset.address,
        baseSpotPriceOracle.address,
        underlyingSpotPriceOracle.address,
        fixedFromFloat(1),
        fixedFromFloat(1),
        0
      );

    await premiaProxyManager
      .connect(multisig)
      .deployPool(
        baseAsset.address,
        underlyingAsset.address,
        baseSpotPriceOracle.address,
        underlyingSpotPriceOracle.address,
        fixedFromFloat(1),
        fixedFromFloat(1),
        0
      );

    const pool = IPremiaPool__factory.connect(poolAddress, multisig);

    const weth =
      underlying.name === "wETH"
        ? await MockERC20__factory.connect(underlyingAsset.address, deployer)
        : await MockERC20__factory.connect(WETH_ADDRESS[chainId], deployer);

    return new PoolUtil({
      weth,
      pool,
      underlyingSpotPriceOracle,
      baseSpotPriceOracle,
      underlyingAsset,
      baseAsset,
    });
  }
}
