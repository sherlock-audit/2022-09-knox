import { ContractFactory, ethers } from "ethers";
import { VaultDiamond } from "../types";

export async function diamondCut(
  diamond: VaultDiamond,
  contractAddress: string,
  factory: ContractFactory,
  excludeList: string[] = [],
  action: number = 0
) {
  const registeredSelectors: string[] = [];
  const facetCuts = [
    {
      target: contractAddress,
      action: action,
      selectors: Object.keys(factory.interface.functions)
        .filter((fn) => !excludeList.includes(factory.interface.getSighash(fn)))
        .map((fn) => {
          const sl = factory.interface.getSighash(fn);
          registeredSelectors.push(sl);
          return sl;
        }),
    },
  ];

  const tx = await diamond.diamondCut(
    facetCuts,
    ethers.constants.AddressZero,
    "0x"
  );
  await tx.wait(1);

  return registeredSelectors;
}

export async function printFacets(implAddress: string, factory: any) {
  const facetCuts = [
    {
      target: implAddress,
      action: 1,
      selectors: Object.keys(factory.interface.functions).map((fn) => {
        const selector = factory.interface.getSighash(fn);
        // console.log(selector, fn);

        return selector;
      }),
    },
  ];

  console.log(facetCuts);
}
