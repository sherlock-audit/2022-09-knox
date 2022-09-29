// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "abdk-libraries-solidity/ABDKMath64x64.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../vendor/IPremiaPool.sol";

contract PricerMock {
    using ABDKMath64x64 for int128;

    int128 public delta64x64;
    int128 public offSetDelta64x64;

    int128 public strike64x64;
    int128 public offsetStrike64x64;

    int128 public maxPrice64x64;
    int128 public minPrice64x64;

    constructor() {}

    function setDelta64x64(int128 _delta64x64, int128 _offSetDelta64x64)
        external
    {
        delta64x64 = _delta64x64;
        offSetDelta64x64 = _offSetDelta64x64;
    }

    function setStrikePrices64x64(
        int128 _strike64x64,
        int128 _offsetStrike64x64
    ) external {
        strike64x64 = _strike64x64;
        offsetStrike64x64 = _offsetStrike64x64;
    }

    function setPrices64x64(int128 _maxPrice64x64, int128 _minPrice64x64)
        external
    {
        maxPrice64x64 = _maxPrice64x64;
        minPrice64x64 = _minPrice64x64;
    }

    function latestAnswer64x64() external pure returns (int128) {
        return 0x10000000000000000;
    }

    function getTimeToMaturity64x64(uint64) external pure returns (int128) {
        return 0;
    }

    function getBlackScholesPrice64x64(
        int128,
        int128 _strike64x64,
        int128,
        bool
    ) external view returns (int128) {
        if (_strike64x64 == strike64x64) {
            return maxPrice64x64;
        } else if (_strike64x64 == offsetStrike64x64) {
            return minPrice64x64;
        }

        revert("PricerMock: bs price, error");
    }

    function getDeltaStrikePrice64x64(
        bool,
        uint64,
        int128 _delta64x64
    ) external view returns (int128) {
        if (_delta64x64 == delta64x64) {
            return strike64x64;
        } else if (_delta64x64 == offSetDelta64x64) {
            return offsetStrike64x64;
        }

        revert("PricerMock: delta strike price, error");
    }

    function snapToGrid64x64(bool, int128 n) external pure returns (int128) {
        return n;
    }
}
