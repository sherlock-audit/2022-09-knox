import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
const { getContractAt } = ethers;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import * as types from "./types";

import { SLOTS } from "../../constants";
import { MockERC20 } from "../../types";

export async function getSigners(): Promise<types.Signers> {
  const [
    deployerSigner,
    lp1Signer,
    lp2Signer,
    lp3Signer,
    keeperSigner,
    feeRecipientSigner,
    buyer1Signer,
    buyer2Signer,
    buyer3Signer,
  ] = await ethers.getSigners();

  const signers = {
    deployer: deployerSigner,
    lp1: lp1Signer,
    lp2: lp2Signer,
    lp3: lp3Signer,
    keeper: keeperSigner,
    feeRecipient: feeRecipientSigner,
    buyer1: buyer1Signer,
    buyer2: buyer2Signer,
    buyer3: buyer3Signer,
  };

  return signers as types.Signers;
}

export async function getAddresses(
  signers: types.Signers
): Promise<types.Addresses> {
  const addresses = {
    deployer: signers.deployer.address,
    lp1: signers.lp1.address,
    lp2: signers.lp2.address,
    lp3: signers.lp3.address,
    keeper: signers.keeper.address,
    feeRecipient: signers.feeRecipient.address,
    buyer1: signers.buyer1.address,
    buyer2: signers.buyer2.address,
    buyer3: signers.buyer3.address,
    vault: ethers.constants.AddressZero,
    exchange: ethers.constants.AddressZero,
    queue: ethers.constants.AddressZero,
    auction: ethers.constants.AddressZero,
  };

  return addresses;
}

export async function impersonateVault(
  signers: types.Signers,
  addresses: types.Addresses
): Promise<SignerWithAddress> {
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [addresses.vault],
  });

  // send enough ETH to contract to cover tx cost.
  await signers.deployer.sendTransaction({
    to: addresses.vault,
    value: ethers.utils.parseEther("5"),
  });

  return await ethers.getSigner(addresses.vault);
}

export async function setERC20Balances(
  asset: string,
  deposit: BigNumber,
  signers: types.Signers,
  addresses: types.Addresses
): Promise<[types.Signers, types.Addresses, MockERC20]> {
  for (let s in signers) {
    let address = signers[s].address;

    await _setERC20Balance(
      asset,
      address,
      deposit.mul(10).toHexString(),
      SLOTS[asset]
    );
  }

  return [signers, addresses, await getContractAt("MockERC20", asset)];
}

async function _setERC20Balance(
  asset: string,
  account: string,
  balance: string,
  slot: number
) {
  const index = ethers.utils.solidityKeccak256(
    ["uint256", "uint256"],
    [account, slot]
  );
  const amount = ethers.utils.hexZeroPad(balance, 32);

  await ethers.provider.send("hardhat_setStorageAt", [asset, index, amount]);
}
