import { ethers } from "hardhat";
const { parseUnits } = ethers.utils;

import { accounts, assets, types, KnoxUtil } from "./utils";

import { describeBehaviorOfVaultAdmin } from "../spec/VaultAdmin.behavior";
import { describeBehaviorOfVaultBase } from "../spec/VaultBase.behavior";
import { describeBehaviorOfVaultMock } from "../spec/VaultMock.behavior";
import { describeBehaviorOfVaultView } from "../spec/VaultView.behavior";

describe("Vault Tests", () => {
  behavesLikeVault({
    name: "Put Options",
    tokenName: `Knox ETH Delta Vault`,
    tokenSymbol: `kETH-DELTA-P`,
    tokenDecimals: 18,
    underlying: assets.ETH,
    base: assets.DAI,
    collateral: assets.DAI,
    pool: assets.PREMIA.WETH_DAI,
    delta: 0.2,
    deltaOffset: 0.1,
    maxTVL: parseUnits("1000000", assets.DAI.decimals),
    minSize: parseUnits("1", assets.ETH.decimals - 1),
    reserveRate64x64: 0.001,
    performanceFee64x64: 0,
    withdrawalFee64x64: 0,
    isCall: false,
    mint: parseUnits("1000000", assets.DAI.decimals),
    deposit: parseUnits("10000", assets.DAI.decimals),
    price: { max: 100, min: 10 },
  });

  behavesLikeVault({
    name: "Call Options",
    tokenName: `Knox ETH Delta Vault`,
    tokenSymbol: `kETH-DELTA-C`,
    tokenDecimals: 18,
    underlying: assets.ETH,
    base: assets.DAI,
    collateral: assets.ETH,
    pool: assets.PREMIA.WETH_DAI,
    delta: 0.2,
    deltaOffset: 0.1,
    maxTVL: parseUnits("100", assets.ETH.decimals),
    minSize: parseUnits("1", assets.ETH.decimals - 1),
    reserveRate64x64: 0.001,
    performanceFee64x64: 0,
    withdrawalFee64x64: 0,
    isCall: true,
    mint: parseUnits("1000", assets.ETH.decimals),
    deposit: parseUnits("10", assets.ETH.decimals),
    price: { max: 0.1, min: 0.01 },
  });
});

function behavesLikeVault(params: types.VaultParams) {
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
    });

    describeBehaviorOfVaultAdmin({
      getKnoxUtil: async () => knoxUtil,
      getParams: () => params,
    });

    describeBehaviorOfVaultBase(
      {
        getKnoxUtil: async () => knoxUtil,
        getParams: () => params,
        mintERC4626: undefined as any,
        burnERC4626: undefined as any,
        mintAsset: undefined as any,
        supply: ethers.constants.Zero,
      },
      ["::ERC4626Base"]
    );

    describeBehaviorOfVaultMock({
      getKnoxUtil: async () => knoxUtil,
      getParams: () => params,
    });

    describeBehaviorOfVaultView({
      getKnoxUtil: async () => knoxUtil,
      getParams: () => params,
    });
  });
}
