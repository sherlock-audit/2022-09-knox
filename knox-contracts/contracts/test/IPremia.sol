// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPremiaProxyManager {
    event DeployPool(
        address indexed base,
        address indexed underlying,
        int128 indexed initialCLevel64x64,
        address baseOracle,
        address underlyingOracle,
        address pool
    );

    function deployPool(
        address base,
        address underlying,
        address baseOracle,
        address underlyingOracle,
        int128 baseMinimum64x64,
        int128 underlyingMinimum64x64,
        uint256 miningAllocPoints
    ) external returns (address);
}
