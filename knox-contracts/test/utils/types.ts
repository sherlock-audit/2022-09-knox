import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export type Pool = {
  address: string;
  base: Asset;
  underlying: Asset;
  volatility: string;
};

export type Asset = {
  name: string;
  address: string;
  decimals: number;
  oracle: Oracle;
};

export type Oracle = {
  address: string;
  decimals: number;
  price: number;
};

export type Signers = {
  deployer: SignerWithAddress;
  lp1: SignerWithAddress;
  lp2: SignerWithAddress;
  lp3: SignerWithAddress;
  keeper: SignerWithAddress;
  feeRecipient: SignerWithAddress;
  buyer1: SignerWithAddress;
  buyer2: SignerWithAddress;
  buyer3: SignerWithAddress;
  vault?: SignerWithAddress;
};

export type Addresses = {
  deployer: string;
  lp1: string;
  lp2: string;
  lp3: string;
  keeper: string;
  feeRecipient: string;
  buyer1: string;
  buyer2: string;
  buyer3: string;
  auction: string;
  buyer?: string;
  pool?: string;
  helpers?: string;
  pricer?: string;
  exchange: string;
  queue: string;
  vault: string;
  spotOracle?: string;
  volatilityOracle?: string;
};

export type VaultParams = {
  name?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  underlying?: Asset;
  base?: Asset;
  collateral?: Asset;
  pool?: Pool;
  delta?: number;
  deltaOffset?: number;
  maxTVL?: BigNumber;
  minSize?: BigNumber;
  reserveRate64x64?: number;
  performanceFee64x64?: number;
  withdrawalFee64x64?: number;
  isCall?: boolean;
  mint?: BigNumber;
  size?: BigNumber;
  deposit?: BigNumber;
  price?: {
    max: number;
    min: number;
  };
};
