import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { expect } from "chai";

import { Registry, Registry__factory } from "../types";
import { assert, time } from "./utils";

function bnToAddress(bn: BigNumber) {
  return ethers.utils.getAddress(
    ethers.utils.hexZeroPad(ethers.utils.hexlify(bn), 20)
  );
}

let registry: Registry;
let deployer: SignerWithAddress;
let user: SignerWithAddress;

let vault = bnToAddress(BigNumber.from(1));
let queue = bnToAddress(BigNumber.from(2));
let auction = bnToAddress(BigNumber.from(3));
let pricer = bnToAddress(BigNumber.from(4));

describe("Registry Tests", () => {
  before(async () => {
    [deployer, user] = await ethers.getSigners();
    registry = await new Registry__factory(deployer).deploy();
  });

  describe("#count()", () => {
    time.revertToSnapshotAfterEach(async () => {});

    it("should increment count", async () => {
      let count = await registry.count();
      expect(count).to.equal(BigNumber.from(0));

      await registry.connect(deployer).addVault({
        vault,
        queue,
        auction,
        pricer,
      });

      count = await registry.count();
      expect(count).to.equal(BigNumber.from(1));
    });
  });

  describe("#addVault((address,address,address,address))", () => {
    time.revertToSnapshotAfterEach(async () => {});

    it("should revert if !owner", async () => {
      await expect(
        registry.connect(user).addVault({
          vault,
          queue,
          auction,
          pricer,
        })
      ).to.be.revertedWith("Ownable: sender must be owner");
    });

    it("should add vault to vaults array", async () => {
      await expect(
        registry.connect(deployer).addVault({
          vault,
          queue,
          auction,
          pricer,
        })
      )
        .to.emit(registry, "VaultDeployed")
        .withArgs([vault, queue, auction, pricer]);

      let count = await registry.count();
      expect(count).to.equal(BigNumber.from(1));

      count = count.sub(1);

      assert.deepEqual(await registry.vaults(count), [
        vault,
        queue,
        auction,
        pricer,
      ]);
    });
  });
});
