import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import { TestOrderBook, TestOrderBook__factory } from "../../types";

import { assert } from "../utils/assertions";
import * as time from "../utils/time";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe.only("OrderBook", () => {
  let instance: TestOrderBook;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
  let bNZero: BigNumber;

  before(async () => {
    bNZero = BigNumber.from("0");
    [signer1, signer2, signer3] = await ethers.getSigners();

    instance = await new TestOrderBook__factory(signer1).deploy();
  });

  describe("#head", () => {
    describe("if empty", () => {
      it("should return 0", async () => {
        assert.bnEqual(await instance.head(), BigNumber.from("0"));
      });
    });

    describe("else", () => {
      time.revertToSnapshotAfterEach(async () => {
        await instance.insert(999, 10000, signer1.address);
        await instance.insert(1000, 10001, signer2.address);
        await instance.insert(1001, 9999, signer3.address);
      });

      it("should return the highest bid in the order book", async () => {
        assert.bnEqual(await instance.head(), BigNumber.from("3"));
      });

      it("should return the next highest bid when previous highest bid was removed", async () => {
        await instance.remove(3);
        assert.bnEqual(await instance.head(), BigNumber.from("2"));
      });

      it("should return the last highest bid in the order book when bid is removed", async () => {
        await instance.remove(1);
        assert.bnEqual(await instance.head(), BigNumber.from("3"));
      });

      it("should return the last highest bid in the order book when bid is inserted", async () => {
        await instance.insert(1000, 9999, signer1.address);

        assert.bnEqual(await instance.head(), BigNumber.from("3"));
      });

      it("should return the last highest bid when price is the same", async () => {
        await instance.insert(1001, 9999, signer1.address);

        assert.bnEqual(await instance.head(), BigNumber.from("3"));
      });
    });
  });

  describe("#length", () => {
    describe("if empty", () => {
      it("should return 0", async () => {
        assert.bnEqual(await instance.length(), BigNumber.from("0"));
      });
    });

    describe("else", () => {
      time.revertToSnapshotAfterEach(async () => {
        await instance.insert(999, 10000, signer1.address);
      });

      it("should increment when bid is inserted", async () => {
        assert.bnEqual(await instance.length(), BigNumber.from("1"));

        await instance.insert(1005, 10410, signer2.address);

        assert.bnEqual(await instance.length(), BigNumber.from("2"));

        await instance.insert(997, 10001, signer3.address);

        assert.bnEqual(await instance.length(), BigNumber.from("3"));
      });

      it("should decrement when bid is inserted", async () => {
        await instance.insert(1005, 10410, signer2.address);

        await instance.insert(997, 10001, signer3.address);

        await instance.remove(1);
        assert.bnEqual(await instance.length(), BigNumber.from("2"));
        await instance.remove(2);
        assert.bnEqual(await instance.length(), BigNumber.from("1"));
        await instance.remove(3);
        assert.bnEqual(await instance.length(), BigNumber.from("0"));
      });
    });
  });

  describe("#getOrder", () => {
    describe("if empty", () => {
      it("should return 0", async () => {
        assert.deepEqual(await instance.getOrder("0"), [
          bNZero,
          bNZero,
          bNZero,
          ethers.constants.AddressZero,
        ]);
      });
    });

    describe("else", () => {
      time.revertToSnapshotAfterEach(async () => {
        await instance.insert(999, 10000, signer1.address);
        await instance.insert(1000, 10001, signer2.address);
        await instance.insert(1001, 9999, signer3.address);
      });

      it("should return order ID 1", async () => {
        assert.deepEqual(await instance.getOrder("1"), [
          BigNumber.from("1"),
          BigNumber.from("999"),
          BigNumber.from("10000"),
          signer1.address,
        ]);
      });

      it("should return order ID 2", async () => {
        assert.deepEqual(await instance.getOrder("2"), [
          BigNumber.from("2"),
          BigNumber.from("1000"),
          BigNumber.from("10001"),
          signer2.address,
        ]);
      });

      it("should return order ID 3", async () => {
        assert.deepEqual(await instance.getOrder("3"), [
          BigNumber.from("3"),
          BigNumber.from("1001"),
          BigNumber.from("9999"),
          signer3.address,
        ]);
      });
    });
  });

  describe("#getPreviousOrder", () => {
    describe("if empty", () => {
      it("should return 0", async () => {
        assert.bnEqual(
          await instance.getPreviousOrder("1"),
          BigNumber.from("0")
        );
      });
    });

    describe("else", () => {
      time.revertToSnapshotAfterEach(async () => {
        await instance.insert(999, 10000, signer1.address);
        await instance.insert(1000, 10001, signer2.address);
        await instance.insert(1001, 9999, signer3.address);
      });

      // Highest <- 3 <- 2 <- 1 <- Lowest

      it("should return the order ID preceding order 0", async () => {
        assert.bnEqual(
          await instance.getPreviousOrder("0"),
          BigNumber.from("0")
        );
      });

      it("should return the order ID preceding order 1", async () => {
        assert.bnEqual(
          await instance.getPreviousOrder("1"),
          BigNumber.from("2")
        );
      });

      it("should return the order ID preceding order 2", async () => {
        assert.bnEqual(
          await instance.getPreviousOrder("2"),
          BigNumber.from("3")
        );
      });

      it("should return the order ID preceding order 3", async () => {
        assert.bnEqual(
          await instance.getPreviousOrder("3"),
          BigNumber.from("0")
        );
      });
    });
  });

  describe("#getNextOrder", () => {
    describe("if empty", () => {
      it("should return 0", async () => {
        assert.bnEqual(await instance.getNextOrder("1"), BigNumber.from("0"));
      });
    });

    describe("else", () => {
      time.revertToSnapshotAfterEach(async () => {
        await instance.insert(999, 10000, signer1.address);
        await instance.insert(1000, 10001, signer2.address);
        await instance.insert(1001, 9999, signer3.address);
      });

      // Highest -> 3 -> 2 -> 1 -> Lowest

      it("should return the order ID preceding order 0", async () => {
        assert.bnEqual(await instance.getNextOrder("0"), BigNumber.from("0"));
      });

      it("should return the order ID preceding order 1", async () => {
        assert.bnEqual(await instance.getNextOrder("1"), BigNumber.from("0"));
      });

      it("should return the order ID preceding order 2", async () => {
        assert.bnEqual(await instance.getNextOrder("2"), BigNumber.from("1"));
      });

      it("should return the order ID preceding order 3", async () => {
        assert.bnEqual(await instance.getNextOrder("3"), BigNumber.from("2"));
      });
    });
  });

  describe("#insert", () => {
    time.revertToSnapshotAfterEach(async () => {
      await instance.insert(999, 10000, signer1.address);
      await instance.insert(1000, 10001, signer2.address);
      await instance.insert(1001, 9999, signer3.address);
    });

    it("should insert new order in front of ID 3", async () => {
      await instance.insert(1005, 10000, signer1.address);
      assert.bnEqual(await instance.getPreviousOrder("3"), BigNumber.from("4"));
    });

    it("should insert new order with same price after order with existing price", async () => {
      await instance.insert(1000, 10001, signer2.address);
      assert.bnEqual(await instance.getNextOrder("2"), BigNumber.from("4"));
    });

    it("should insert order based on price only", async () => {
      await instance.insert(1000, 10001, signer2.address);
      await instance.insert(1000, 10000, signer1.address);
      await instance.insert(1000, 10, signer2.address);
      await instance.insert(1000, 10002, signer3.address);

      assert.bnEqual(await instance.getNextOrder("3"), BigNumber.from("2"));
      assert.bnEqual(await instance.getNextOrder("2"), BigNumber.from("4"));
      assert.bnEqual(await instance.getNextOrder("4"), BigNumber.from("5"));
      assert.bnEqual(await instance.getNextOrder("5"), BigNumber.from("6"));
      assert.bnEqual(await instance.getNextOrder("6"), BigNumber.from("7"));
      assert.bnEqual(await instance.getNextOrder("7"), BigNumber.from("1"));
    });

    it("should insert orders in correct sequence", async () => {
      await instance.insert(1, 0, ethers.constants.AddressZero);
      await instance.insert(1005, 0, ethers.constants.AddressZero);
      await instance.insert(1005, 0, ethers.constants.AddressZero);
      await instance.insert(1004, 0, ethers.constants.AddressZero);
      await instance.insert(0, 0, ethers.constants.AddressZero);
      await instance.insert(1003, 0, ethers.constants.AddressZero);
      await instance.insert(1011, 0, ethers.constants.AddressZero);
      await instance.insert(1000, 0, ethers.constants.AddressZero);
      await instance.insert(0, 0, ethers.constants.AddressZero);
      await instance.insert(1005, 0, ethers.constants.AddressZero);
      await instance.insert(1003, 0, ethers.constants.AddressZero);
      await instance.insert(1000, 0, ethers.constants.AddressZero);
      await instance.insert(1005, 0, ethers.constants.AddressZero);
      await instance.insert(1000, 0, ethers.constants.AddressZero);
      await instance.insert(1012, 0, ethers.constants.AddressZero);
      await instance.insert(1004, 0, ethers.constants.AddressZero);
      await instance.insert(1004, 0, ethers.constants.AddressZero);

      const head = await instance.head();

      assert.bnEqual(head, BigNumber.from("18"));
      assert.bnEqual(await instance.getNextOrder(head), BigNumber.from("10"));
      assert.bnEqual(await instance.getNextOrder("10"), BigNumber.from("5"));
      assert.bnEqual(await instance.getNextOrder("5"), BigNumber.from("6"));
      assert.bnEqual(await instance.getNextOrder("6"), BigNumber.from("13"));
      assert.bnEqual(await instance.getNextOrder("13"), BigNumber.from("16"));
      assert.bnEqual(await instance.getNextOrder("16"), BigNumber.from("7"));
      assert.bnEqual(await instance.getNextOrder("7"), BigNumber.from("19"));
      assert.bnEqual(await instance.getNextOrder("19"), BigNumber.from("20"));
      assert.bnEqual(await instance.getNextOrder("20"), BigNumber.from("9"));
      assert.bnEqual(await instance.getNextOrder("9"), BigNumber.from("14"));
      assert.bnEqual(await instance.getNextOrder("14"), BigNumber.from("3"));
      assert.bnEqual(await instance.getNextOrder("3"), BigNumber.from("2"));
      assert.bnEqual(await instance.getNextOrder("2"), BigNumber.from("11"));
      assert.bnEqual(await instance.getNextOrder("11"), BigNumber.from("15"));
      assert.bnEqual(await instance.getNextOrder("15"), BigNumber.from("17"));
      assert.bnEqual(await instance.getNextOrder("17"), BigNumber.from("1"));
      assert.bnEqual(await instance.getNextOrder("1"), BigNumber.from("4"));
      assert.bnEqual(await instance.getNextOrder("4"), BigNumber.from("8"));
      assert.bnEqual(await instance.getNextOrder("8"), BigNumber.from("12"));
      assert.bnEqual(await instance.getNextOrder("12"), BigNumber.from("0"));
    });
  });

  describe("#remove", () => {
    time.revertToSnapshotAfterEach(async () => {
      await instance.insert(999, 10000, signer1.address);
      await instance.insert(1000, 10001, signer2.address);
      await instance.insert(1001, 9999, signer3.address);
    });

    it("should remove order from order book", async () => {
      await instance.remove(2);
      assert.deepEqual(await instance.getOrder("2"), [
        bNZero,
        bNZero,
        bNZero,
        ethers.constants.AddressZero,
      ]);
    });

    it("should return order preceeding and succeeding removed order", async () => {
      await instance.remove(2);
      assert.bnEqual(await instance.getPreviousOrder("1"), BigNumber.from("3"));
      assert.bnEqual(await instance.getNextOrder("3"), BigNumber.from("1"));
    });
  });
});
