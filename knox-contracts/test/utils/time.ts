import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

// Increases ganache time by the passed duration in seconds
export async function increase(duration: number | BigNumber) {
  if (!BigNumber.isBigNumber(duration)) {
    duration = BigNumber.from(duration);
  }

  if (duration.lt(BigNumber.from("0")))
    throw Error(`Cannot increase time by a negative amount (${duration})`);

  await ethers.provider.send("evm_increaseTime", [duration.toNumber()]);

  await ethers.provider.send("evm_mine", []);
}

// returns the current timestamp
export async function now() {
  return BigNumber.from(
    (await ethers.provider.getBlock("latest")).timestamp
  ).toNumber();
}

// returns the next Thursday 8AM timestamp
// e.g. Monday Week 0 -> Friday Week 0
// e.g. Thursday 7:59AM Week 0 -> Thursday 8:00AM Week 0
// e.g. Thursday 8:01AM Week 0 -> Thursday 8:00AM Week 1
export async function getThursday8AM(timestamp: number) {
  const currentTime = moment.unix(timestamp);

  // The block we're hardcoded to is a Monday so we add 3 days to get to Thursday
  const thursday = currentTime.add(3, "days");
  return moment(thursday).startOf("isoWeek").day("thursday").hour(8).unix();
}

// returns the next Friday 8AM timestamp
// e.g. Monday Week 0 -> Friday Week 0
// e.g. Friday 7:59AM Week 0 -> Friday 8:00AM Week 0
// e.g. Friday 8:01AM Week 0 -> Friday 8:00AM Week 1
export async function getFriday8AM(timestamp: number) {
  const currentTime = moment.unix(timestamp);

  // The block we're hardcoded to is a Monday so we add 3 days to get to Thursday
  const friday = currentTime.add(3, "days");
  return moment(friday).startOf("isoWeek").day("friday").hour(8).unix();
}

// fast-forward to thursday
export async function fastForwardToThursday8AM() {
  await increaseTo(await getThursday8AM(await now()));
}

// fast-forward to friday
export async function fastForwardToFriday8AM() {
  await increaseTo(await getFriday8AM(await now()));
}

/**
 * Beware that due to the need of calling two separate ganache methods and rpc calls overhead
 * it's hard to increase time precisely to a target point so design your test to tolerate
 * small fluctuations from time to time.
 *
 * @param target time in seconds
 */
export async function increaseTo(target: number | BigNumber) {
  if (!BigNumber.isBigNumber(target)) {
    target = BigNumber.from(target);
  }

  const now = BigNumber.from(
    (await ethers.provider.getBlock("latest")).timestamp
  );

  if (target.lt(now))
    throw Error(
      `Cannot increase current time (${now}) to a moment in the past (${target})`
    );

  const diff = target.sub(now);
  return increase(diff);
}

export async function takeSnapshot() {
  const snapshotId: string = await ethers.provider.send("evm_snapshot", []);
  return snapshotId;
}

export async function revertToSnapShot(id: string) {
  await ethers.provider.send("evm_revert", [id]);
}

export function revertToSnapshotAfterTest() {
  let snapshotId: string;

  before(async () => {
    snapshotId = await takeSnapshot();
  });
  after(async () => {
    await revertToSnapShot(snapshotId);
  });
}

export function revertToSnapshotAfterEach(
  beforeEachCallback = async () => {},
  afterEachCallback = async () => {}
) {
  let snapshotId: string;

  beforeEach(async function () {
    snapshotId = await takeSnapshot();
    await beforeEachCallback.bind(this)(); // eslint-disable-line no-invalid-this
  });
  afterEach(async () => {
    await afterEachCallback.bind(this)(); // eslint-disable-line no-invalid-this
    await revertToSnapShot(snapshotId);
  });
}
