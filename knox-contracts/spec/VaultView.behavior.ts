import moment from "moment-timezone";
moment.tz.setDefault("UTC");

import { Auction, IPremiaPool, IVaultMock, MockERC20 } from "../types";

import { assert, time, types, KnoxUtil, PoolUtil } from "../test/utils";

interface ViewBehaviorArgs {
  getKnoxUtil: () => Promise<KnoxUtil>;
  getParams: () => types.VaultParams;
}

export function describeBehaviorOfVaultView(
  { getKnoxUtil, getParams }: ViewBehaviorArgs,
  skips?: string[]
) {
  describe("::VaultView", () => {
    // Contract Utilities
    let knoxUtil: KnoxUtil;
    let poolUtil: PoolUtil;

    // Signers and Addresses
    let addresses: types.Addresses;
    let signers: types.Signers;

    // Contract Instances and Proxies
    let asset: MockERC20;
    let auction: Auction;
    let vault: IVaultMock;
    let pool: IPremiaPool;

    const params = getParams();

    before(async () => {
      knoxUtil = await getKnoxUtil();
      poolUtil = knoxUtil.poolUtil;

      signers = knoxUtil.signers;
      addresses = knoxUtil.addresses;

      asset = knoxUtil.asset;
      vault = knoxUtil.vaultUtil.vault;
      pool = knoxUtil.poolUtil.pool;
      auction = knoxUtil.auction;
    });

    describe("#constructor()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should deploy with correct state", async () => {
        assert.equal(await vault.ERC20(), asset.address);
        assert.equal(await vault.Pool(), addresses.pool);
      });
    });

    describe.skip("#getEpoch()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should return 0th epoch", async () => {});

      it("should return 1st epoch", async () => {});
    });

    describe.skip("#getOption(uint64)", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should return option from 0th epoch", async () => {});

      it("should return option from 1st epoch", async () => {});
    });

    describe.skip("#totalCollateral()", () => {
      time.revertToSnapshotAfterEach(async () => {});

      it("should return vault total collateral", async () => {});
    });

    describe.skip("#totalPremiums()", () => {
      time.revertToSnapshotAfterEach(async () => {});
    });

    describe.skip("#totalShortAsCollateral()", () => {
      time.revertToSnapshotAfterEach(async () => {});
    });

    describe.skip("#totalShortAsContracts()", () => {
      time.revertToSnapshotAfterEach(async () => {});
    });

    describe.skip("#totalReserves()", () => {
      time.revertToSnapshotAfterEach(async () => {});
    });
  });
}
