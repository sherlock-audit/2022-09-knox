import { ethers } from "hardhat";
import { BigNumber } from "ethers";
const { parseUnits } = ethers.utils;

import { accounts, assets, types, KnoxUtil, formatClaimTokenId } from "./utils";

import { describeBehaviorOfQueue } from "../spec/Queue.behavior";

describe("Queue Tests", () => {
  behavesLikeQueue({
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
    reserveRate64x64: 0,
    performanceFee64x64: 0.2,
    withdrawalFee64x64: 0.02,
    isCall: false,
    mint: parseUnits("1000000", assets.DAI.decimals),
    deposit: parseUnits("10000", assets.DAI.decimals),
    price: { max: 100, min: 10 },
  });

  behavesLikeQueue({
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
    reserveRate64x64: 0,
    performanceFee64x64: 0.2,
    withdrawalFee64x64: 0.02,
    isCall: true,
    mint: parseUnits("1000", assets.ETH.decimals),
    deposit: parseUnits("10", assets.ETH.decimals),
    price: { max: 0.1, min: 0.01 },
  });
});

interface Params extends types.VaultParams {
  mint: BigNumber;
  deposit: BigNumber;
}

function behavesLikeQueue(params: Params) {
  describe.only(params.name, () => {
    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Utilities
    let knoxUtil: KnoxUtil;

    before(async () => {
      signers = await accounts.getSigners();
      addresses = await accounts.getAddresses(signers);

      knoxUtil = await KnoxUtil.deploy(params, signers, addresses);

      addresses = knoxUtil.addresses;
    });

    describeBehaviorOfQueue(
      {
        getKnoxUtil: async () => knoxUtil,
        getParams: () => params,
        transferERC1155: undefined as any,
        mintERC1155: undefined as any,
        burnERC1155: undefined as any,
        tokenIdERC1155: BigNumber.from(
          formatClaimTokenId({
            address: ethers.constants.AddressZero,
            epoch: BigNumber.from(0),
          })
        ),
      },
      ["::ERC1155Enumerable"]
    );
  });
}
