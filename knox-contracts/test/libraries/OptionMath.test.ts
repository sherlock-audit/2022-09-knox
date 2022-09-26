import { ethers } from "hardhat";

import { fixedFromFloat } from "@premia/utils";
import { parseUnits } from "ethers/lib/utils";
import { BigNumber } from "ethers";

import { TestOptionMath, TestOptionMath__factory } from "../../types";

import { expect } from "chai";
import { assert, time } from "../utils";

let instance: TestOptionMath;

describe.only("OptionMath", () => {
  before(async () => {
    const [signer] = await ethers.getSigners();
    instance = await new TestOptionMath__factory(signer).deploy();
  });

  describe("#ceil64x64", () => {
    it("should revert if x == 0", async () => {
      await expect(instance.ceil64x64(0)).to.be.reverted;
    });
    it("should round 1.0 to 1.0", async () => {
      const x = fixedFromFloat("1.0");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("1.0").toString()
      );
    });
    it("should round 90.0 to 90.0", async () => {
      const x = fixedFromFloat("90.0");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("90.0").toString()
      );
    });
    it("should round 53510034427 to 54000000000", async () => {
      const x = fixedFromFloat("53510034427");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("54000000000").toString()
      );
    });
    it("should round 53410034427 to 54000000000", async () => {
      const x = fixedFromFloat("53410034427");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("54000000000").toString()
      );
    });
    it("should round 24450 to 25000", async () => {
      const x = fixedFromFloat("24450");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("25000").toString()
      );
    });
    it("should round 9999 to 10000", async () => {
      const x = fixedFromFloat("9999");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("10000").toString()
      );
    });
    it("should round 8863 to 8900", async () => {
      const x = fixedFromFloat("8863");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("8900").toString()
      );
    });
    it("should round 521 to 530", async () => {
      const x = fixedFromFloat("521");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("530").toString()
      );
    });
    it("should round 12.211 to 13", async () => {
      const x = fixedFromFloat("12.211");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("13").toString()
      );
    });
    it("should round 24.550 to 25", async () => {
      const x = fixedFromFloat("24.550");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("25").toString()
      );
    });
    it("should round 1.419 to 1.5", async () => {
      const x = fixedFromFloat("1.419");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("1.5").toString()
      );
    });
    it("should round 9.9994 to 10", async () => {
      const x = fixedFromFloat("9.9994");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("10").toString()
      );
    });
    it("should round 0.07745 to 0.078", async () => {
      const x = fixedFromFloat("0.07745");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("0.078").toString()
      );
    });
    it("should round 0.00994 to 0.01", async () => {
      const x = fixedFromFloat("0.00994");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("0.01").toString()
      );
    });
    it("should round 0.0000068841 to 0.0000069", async () => {
      const x = fixedFromFloat("0.0000068841");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("0.0000069").toString()
      );
    });
    it("should round 45 to 45", async () => {
      const x = fixedFromFloat("45");
      assert.equal(
        (await instance.ceil64x64(x)).toString(),
        fixedFromFloat("45").toString()
      );
    });
  });

  describe("#floor64x64", () => {
    it("should revert if x == 0", async () => {
      await expect(instance.ceil64x64(0)).to.be.reverted;
    });
    it("should round 1.0 to 1.0", async () => {
      const x = fixedFromFloat("1.0");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("1.0").toString()
      );
    });
    it("should round 90.0 to 90.0", async () => {
      const x = fixedFromFloat("90.0");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("90.0").toString()
      );
    });
    it("should round 53510034427 to 53000000000", async () => {
      const x = fixedFromFloat("53510034427");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("53000000000").toString()
      );
    });
    it("should round 53410034427 to 53000000000", async () => {
      const x = fixedFromFloat("53410034427");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("53000000000").toString()
      );
    });
    it("should round 24450 to 24000", async () => {
      const x = fixedFromFloat("24450");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("24000").toString()
      );
    });
    it("should round 9999 to 9900", async () => {
      const x = fixedFromFloat("9999");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("9900").toString()
      );
    });
    it("should round 8863 to 8800", async () => {
      const x = fixedFromFloat("8863");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("8800").toString()
      );
    });
    it("should round 521 to 520", async () => {
      const x = fixedFromFloat("521");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("520").toString()
      );
    });
    it("should round 12.211 to 12", async () => {
      const x = fixedFromFloat("12.211");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("12").toString()
      );
    });
    it("should round 24.550 to 25", async () => {
      const x = fixedFromFloat("24.550");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("24").toString()
      );
    });
    it("should round 1.419 to 1.4", async () => {
      const x = fixedFromFloat("1.419");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("1.4").toString()
      );
    });
    it("should round 9.9994 to 9.9", async () => {
      const x = fixedFromFloat("9.9994");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("9.9").toString()
      );
    });
    it("should round 0.07745 to 0.077", async () => {
      const x = fixedFromFloat("0.07745");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("0.077").toString()
      );
    });
    it("should round 0.00994 to 0.0099", async () => {
      const x = fixedFromFloat("0.00994");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("0.0099").toString()
      );
    });
    it("should round 0.0000068841 to 0.0000068", async () => {
      const x = fixedFromFloat("0.0000068841");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("0.0000068").toString()
      );
    });
    it("should round 45 to 45", async () => {
      const x = fixedFromFloat("45");
      assert.equal(
        (await instance.floor64x64(x)).toString(),
        fixedFromFloat("45").toString()
      );
    });
  });

  describe("#toBaseTokenAmount", () => {
    it("should convert 100 to 100", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(2, 2, 100),
        BigNumber.from(100)
      );
    });

    it("should convert 100 to 1000", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(2, 3, 100),
        BigNumber.from(1000)
      );
    });

    it("should convert 100 to 10000", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(2, 4, 100),
        BigNumber.from(10000)
      );
    });

    it("should convert 1 to 100000", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(0, 5, 1),
        BigNumber.from(100000)
      );
    });

    it("should convert 1000 to 100", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(3, 2, 1000),
        BigNumber.from(100)
      );
    });

    it("should convert 100 to 10000", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(4, 2, 10000),
        BigNumber.from(100)
      );
    });

    it("should convert 1 to 100000", async () => {
      assert.bnEqual(
        await instance.toBaseTokenAmount(5, 0, 100000),
        BigNumber.from(1)
      );
    });
  });

  describe("#fromContractsToCollateral(bool,uint8,uint8,int128,uint256)", () => {
    time.revertToSnapshotAfterEach(async () => {});

    it("should return contract size for call option", async () => {
      const size = parseUnits("10", 18);
      const expectedSize = size;

      assert.bnEqual(
        await instance.fromContractsToCollateral(
          size,
          true,
          18,
          18,
          fixedFromFloat(2000)
        ),
        expectedSize
      );
    });

    it("should return contract size for put option", async () => {
      const size = parseUnits("10", 18);
      const expectedSize = parseUnits("2", 22);

      assert.bnEqual(
        await instance.fromContractsToCollateral(
          size,
          false,
          18,
          18,
          fixedFromFloat(2000)
        ),
        expectedSize
      );
    });

    it("should return contract size in base decimals for put option", async () => {
      const size = parseUnits("10", 8);
      const expectedSize = parseUnits("2", 22);

      assert.bnEqual(
        await instance.fromContractsToCollateral(
          size,
          false,
          8,
          18,
          fixedFromFloat(2000)
        ),
        expectedSize
      );
    });
  });

  describe("#fromCollateralToContracts(bool,uint8,uint8,int128,uint256)", () => {
    time.revertToSnapshotAfterEach(async () => {});

    it("should return collateral for call option", async () => {
      const amount = parseUnits("100", 18);
      const expectedCollateral = amount;

      assert.bnEqual(
        await instance.fromCollateralToContracts(
          amount,
          true,
          18,
          fixedFromFloat(2000)
        ),
        expectedCollateral
      );
    });

    it("should return collateral for put option", async () => {
      const amount = parseUnits("100000", 18);
      const expectedCollateral = parseUnits("5", 19);

      assert.bnEqual(
        await instance.fromCollateralToContracts(
          amount,
          false,
          18,
          fixedFromFloat(2000)
        ),
        expectedCollateral
      );
    });

    it("should return collateral in underlying decimals for put option", async () => {
      const amount = parseUnits("100000", 8);
      const expectedCollateral = parseUnits("5", 9);

      const collateral = await instance.fromCollateralToContracts(
        amount,
        false,
        18,
        fixedFromFloat(2000)
      );

      expect(collateral.toNumber()).to.almost(expectedCollateral.toNumber(), 1);
    });
  });
});
