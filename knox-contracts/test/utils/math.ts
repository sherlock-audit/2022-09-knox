import { BigNumber, ethers } from "ethers";
const { formatUnits, parseUnits } = ethers.utils;

let DECIMALS;

export function setDecimals(n: number) {
  DECIMALS = n;
}

export function bnToNumber(bn: BigNumber, decimals = DECIMALS) {
  return Number(formatUnits(bn, decimals));
}

export function toUnits(n: number, decimals = DECIMALS) {
  return parseUnits(n.toString(), decimals);
}
