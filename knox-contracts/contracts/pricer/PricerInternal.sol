// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../libraries/OptionMath.sol";

import "../vendor/IPremiaPool.sol";
import "../vendor/IVolatilitySurfaceOracle.sol";
import "../vendor/CumulativeNormalDistribution.sol";

import "./IPricer.sol";

/**
 * @title Knox Pricer Internal Contract
 */

contract PricerInternal {
    using ABDKMath64x64 for uint256;

    address public immutable Base;
    address public immutable Underlying;
    IVolatilitySurfaceOracle public immutable IVolOracle;
    AggregatorV3Interface public immutable BaseSpotOracle;
    AggregatorV3Interface public immutable UnderlyingSpotOracle;

    constructor(address pool, address volatilityOracle) {
        IVolOracle = IVolatilitySurfaceOracle(volatilityOracle);

        IPremiaPool.PoolSettings memory settings =
            IPremiaPool(pool).getPoolSettings();

        Base = settings.base;
        Underlying = settings.underlying;

        BaseSpotOracle = AggregatorV3Interface(settings.baseOracle);
        UnderlyingSpotOracle = AggregatorV3Interface(settings.underlyingOracle);

        uint8 decimals = UnderlyingSpotOracle.decimals();

        require(
            BaseSpotOracle.decimals() == decimals,
            "oracle decimals must match"
        );
    }

    /**
     * @notice gets the latest price of the underlying denominated in the base
     * @return price of underlying asset as 64x64 fixed point number
     */
    function _latestAnswer64x64() internal view returns (int128) {
        (, int256 basePrice, , , ) = BaseSpotOracle.latestRoundData();
        (, int256 underlyingPrice, , , ) =
            UnderlyingSpotOracle.latestRoundData();

        return ABDKMath64x64.divi(underlyingPrice, basePrice);
    }

    /**
     * @notice calculates the time remaining until maturity
     * @param expiry the expiry date as UNIX timestamp
     * @return time remaining until maturity
     */
    function _getTimeToMaturity64x64(uint64 expiry)
        internal
        view
        returns (int128)
    {
        return ABDKMath64x64.divu(expiry - block.timestamp, 365 days);
    }

    /**
     * @notice gets the annualized volatility of the pool pair
     * @param spot64x64 spot price of the underlying as 64x64 fixed point number
     * @param strike64x64 strike price of the option as 64x64 fixed point number
     * @param timeToMaturity64x64 time remaining until maturity as a 64x64 fixed point number
     * @return annualized volatility as 64x64 fixed point number
     */
    function _getAnnualizedVolatility64x64(
        int128 spot64x64,
        int128 strike64x64,
        int128 timeToMaturity64x64
    ) internal view returns (int128) {
        return
            IVolOracle.getAnnualizedVolatility64x64(
                Base,
                Underlying,
                spot64x64,
                strike64x64,
                timeToMaturity64x64
            );
    }
}
