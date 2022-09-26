import { ethers } from "hardhat";
const { parseUnits } = ethers.utils;

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import { accounts, assets, math, types, KnoxUtil } from "./utils";

import { describeBehaviorOfAuction } from "../spec/Auction.behavior";

describe("Auction Tests", () => {
  behavesLikeAuction({
    name: "Put Options",
    tokenName: `Knox ETH Delta Vault`,
    tokenSymbol: `kETH-DELTA-P`,
    tokenDecimals: 18,
    underlying: assets.ETH,
    base: assets.DAI,
    collateral: assets.DAI,
    delta: 0.2,
    deltaOffset: 0.1,
    maxTVL: parseUnits("1000000", assets.DAI.decimals),
    minSize: parseUnits("1", assets.ETH.decimals - 1),
    reserveRate64x64: 0.001,
    performanceFee64x64: 0.2,
    withdrawalFee64x64: 0.02,
    isCall: false,
    mint: parseUnits("1000000", assets.DAI.decimals),
    size: parseUnits("10", assets.ETH.decimals),
    price: { max: 100, min: 10 },
  });

  behavesLikeAuction({
    name: "Call Options",
    tokenName: `Knox ETH Delta Vault`,
    tokenSymbol: `kETH-DELTA-C`,
    tokenDecimals: 18,
    underlying: assets.ETH,
    base: assets.DAI,
    collateral: assets.ETH,
    delta: 0.2,
    deltaOffset: 0.1,
    maxTVL: parseUnits("1000", assets.ETH.decimals),
    minSize: parseUnits("1", assets.ETH.decimals - 1),
    reserveRate64x64: 0.001,
    performanceFee64x64: 0.2,
    withdrawalFee64x64: 0.02,
    isCall: true,
    mint: parseUnits("1000", assets.ETH.decimals),
    size: parseUnits("10", assets.ETH.decimals),
    price: { max: 0.1, min: 0.01 },
  });
});

function behavesLikeAuction(params: types.VaultParams) {
  describe.only(params.name, () => {
    math.setDecimals(params.collateral.decimals);

    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Utilities
    let knoxUtil: KnoxUtil;

    before(async () => {
      signers = await accounts.getSigners();
      addresses = await accounts.getAddresses(signers);

      knoxUtil = await KnoxUtil.deploy(params, signers, addresses);
    });

    describeBehaviorOfAuction({
      getKnoxUtil: async () => knoxUtil,
      getParams: () => params,
    });
  });
}
