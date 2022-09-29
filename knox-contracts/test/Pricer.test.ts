import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import { fixedFromFloat, fixedToNumber } from "@premia/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployMockContract, MockContract } from "ethereum-waffle";

import chai, { expect } from "chai";
import chaiAlmost from "chai-almost";

chai.use(chaiAlmost());

import {
  MockERC20,
  Pricer,
  MockERC20__factory,
  Pricer__factory,
} from "../types";

import { assert, time } from "./utils";

import moment from "moment-timezone";
moment.tz.setDefault("UTC");

describe("Pricer Tests", () => {
  behavesLikePricer({
    name: "Pricer (Put Options)",
    isCall: false,
    delta64x64: fixedFromFloat(0.25),
  });

  behavesLikePricer({
    name: "Pricer (Call Options)",
    isCall: true,
    delta64x64: fixedFromFloat(0.4),
  });
});

type Params = {
  name: string;
  isCall: boolean;
  delta64x64: BigNumber;
};

function behavesLikePricer(params: Params) {
  describe.only(params.name, () => {
    let underlyingSpotPriceOracle: MockContract;
    let baseSpotPriceOracle: MockContract;
    let underlyingAsset: MockERC20;
    let baseAsset: MockERC20;
    let mockPool: MockContract;
    let mockVolatilityOracle: MockContract;
    let pricer: Pricer;
    let deployer: SignerWithAddress;

    before(async () => {
      [deployer] = await ethers.getSigners();

      underlyingSpotPriceOracle = await deployMockContract(deployer as any, [
        "function decimals() external view returns (uint8)",
        "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
      ]);

      await underlyingSpotPriceOracle.mock.decimals.returns(8);
      await underlyingSpotPriceOracle.mock.latestRoundData.returns(
        0,
        2000,
        0,
        0,
        0
      );

      baseSpotPriceOracle = await deployMockContract(deployer as any, [
        "function decimals() external view returns (uint8)",
        "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
      ]);

      await baseSpotPriceOracle.mock.decimals.returns(8);
      await baseSpotPriceOracle.mock.latestRoundData.returns(0, 1, 0, 0, 0);

      underlyingAsset = await new MockERC20__factory(deployer).deploy("", 18);

      baseAsset = await new MockERC20__factory(deployer).deploy("", 18);

      mockPool = await deployMockContract(deployer as any, [
        "function getPoolSettings() external view returns (address,address,address,address)",
      ]);

      await mockPool.mock.getPoolSettings.returns(
        underlyingAsset.address,
        baseAsset.address,
        underlyingSpotPriceOracle.address,
        baseSpotPriceOracle.address
      );

      mockVolatilityOracle = await deployMockContract(deployer as any, [
        "function getAnnualizedVolatility64x64(address,address,int128,int128,int128) external view returns (int128)",
      ]);

      await mockVolatilityOracle.mock.getAnnualizedVolatility64x64.returns(
        fixedFromFloat("0.9")
      );

      pricer = await new Pricer__factory(deployer).deploy(
        mockPool.address,
        mockVolatilityOracle.address
      );
    });

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should initialize Pricer with correct values", async () => {
        // Check Addresses
        assert.equal(await pricer.IVolOracle(), mockVolatilityOracle.address);

        assert.equal(
          await pricer.BaseSpotOracle(),
          baseSpotPriceOracle.address
        );

        assert.equal(
          await pricer.UnderlyingSpotOracle(),
          underlyingSpotPriceOracle.address
        );

        // Check Asset Properties
        const base = await pricer.Base();
        const underlying = await pricer.Underlying();

        assert.equal(base, baseAsset.address);
        assert.equal(underlying, underlyingAsset.address);
      });

      it("should revert if base and underlying decimals do not match", async () => {
        const baseSpotPriceOracle = await deployMockContract(deployer as any, [
          "function decimals() external view returns (uint8)",
          "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
        ]);

        await baseSpotPriceOracle.mock.decimals.returns(7);
        await baseSpotPriceOracle.mock.latestRoundData.returns(0, 1, 0, 0, 0);

        const mockPool = await deployMockContract(deployer as any, [
          "function getPoolSettings() external view returns (address,address,address,address)",
        ]);

        await mockPool.mock.getPoolSettings.returns(
          underlyingAsset.address,
          baseAsset.address,
          underlyingSpotPriceOracle.address,
          baseSpotPriceOracle.address
        );

        await expect(
          new Pricer__factory(deployer).deploy(
            mockPool.address,
            mockVolatilityOracle.address
          )
        ).to.be.revertedWith("oracle decimals must match");
      });
    });

    describe("#latestAnswer64x64()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should convert price correctly", async () => {
        assert.equal(fixedToNumber(await pricer.latestAnswer64x64()), 2000);
      });
    });

    describe("#getTimeToMaturity64x64(uint64)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if block timestamp >= expiry", async () => {
        assert.bnEqual(
          await pricer.getTimeToMaturity64x64(await time.now()),
          BigNumber.from("0")
        );
      });

      it("should convert time to maurity correctly", async () => {
        const timestamp = await time.now();
        let expiry = await time.getFriday8AM(timestamp);

        const expected = (expiry - timestamp) / 31536000;
        const actual = fixedToNumber(
          await pricer.getTimeToMaturity64x64(expiry)
        );

        expect(actual).to.almost(expected, 0.001);
      });
    });

    describe("#getDeltaStrikePrice64x64(bool,uint64,int128)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should revert if iv_atm <= 0", async () => {
        const mockVolatilityOracle = await deployMockContract(deployer as any, [
          "function getAnnualizedVolatility64x64(address,address,int128,int128,int128) external view returns (int128)",
        ]);

        await mockVolatilityOracle.mock.getAnnualizedVolatility64x64.returns(0);

        const testPricer = await new Pricer__factory(deployer).deploy(
          mockPool.address,
          mockVolatilityOracle.address
        );

        let expiry = await time.getFriday8AM(await time.now());

        await expect(
          testPricer.getDeltaStrikePrice64x64(
            params.isCall,
            expiry,
            params.delta64x64
          )
        ).to.be.revertedWith("iv_atm <= 0");
      });

      it("should revert if tau <= 0", async () => {
        await expect(
          pricer.getDeltaStrikePrice64x64(
            params.isCall,
            await time.now(),
            params.delta64x64
          )
        ).to.be.revertedWith("tau <= 0");
      });

      it("should calculate delta strike price for call option", async () => {
        let expiry = await time.getFriday8AM(await time.now());

        const strike = await pricer.getDeltaStrikePrice64x64(
          params.isCall,
          expiry,
          params.delta64x64
        );

        assert.isFalse(strike.isZero());
      });

      it("should calculate delta strike price for put option", async () => {
        let expiry = await time.getFriday8AM(await time.now());

        const strike = await pricer.getDeltaStrikePrice64x64(
          !params.isCall,
          expiry,
          fixedFromFloat(0.25)
        );

        assert.isFalse(strike.isZero());
      });
    });

    describe("#snapToGrid64x64(bool,int128)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should not round if already round", async () => {
        const n = fixedFromFloat(4500);
        const answer = 4500;
        assert.equal(
          fixedToNumber(await pricer.snapToGrid64x64(true, n)),
          answer
        );
      });

      it("should round up if call option", async () => {
        const n = fixedFromFloat(4401);
        const answer = 4500;
        assert.equal(
          fixedToNumber(await pricer.snapToGrid64x64(true, n)),
          answer
        );
      });

      it("should round down if put option", async () => {
        const n = fixedFromFloat(4599);
        const answer = 4500;
        assert.equal(
          fixedToNumber(await pricer.snapToGrid64x64(false, n)),
          answer
        );
      });
    });
  });
}
