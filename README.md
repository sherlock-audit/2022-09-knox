# Knox Finance contest details

- 50,000 USDC main award pot
- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)
- Starts September 29, 2022 15:00 UTC
- Ends October 13, 2022 15:00 UTC

# Resources

- [Docs](https://docs.knoxvaults.com/)
- [Twitter](https://twitter.com/knox_finance)

# Audit scope

Commit Hash: [b0a872d25caeb833bab17e69ef0de51d7ca862a2](https://github.com/KnoxFinance/knox-contracts/tree/b0a872d25caeb833bab17e69ef0de51d7ca862a2)

```
- contracts/auction/
  - Auction.sol
  - AuctionInternal.sol
  - AuctionProxy.sol
  - AuctionStorage.sol
  - OrderBook.sol

- contracts/libraries/
  - OptionMath.sol

- contracts/pricer/
  - Pricer.sol
  - PricerInternal.sol

- contracts/queue/
  - Queue.sol
  - QueueInternal.sol
  - QueueProxy.sol
  - QueueStorage.sol

- contracts/vault/
  - VaultAdmin.sol
  - VaultBase.sol
  - VaultDiamond.sol
  - VaultInternal.sol
  - VaultStorage.sol
  - VaultView.sol
```

# About Knox Finance

## Knox Finance

Knox Finance provides DeFi options vaults built with risk management in mind. DeFi Option Vaults (DOVs) enable you to earn yield on your crypto assets, like, USDC, BTC and ETH, while minimizing opportunity risk.

Our covered call and cash-secured put vaults focus on:

- Generating low-risk yield by underwriting options.
- Maintaining exposure to an asset.
- Outperforming buy and hold (HODL) strategies.

## What are Knox DeFi Option Vaults (DOVs)?

- DOVs automates the process of selling options to generate sustainable yield.
- Depositors can decide to either sell call or put options depending on their market sentiment.
- The option strike price will be determined once per epoch using the [delta strike formula](https://docs.knoxvaults.com/overview/vault-system#selection-methodology)
- Once pricing is determined, the options are sold via [Dutch auction](https://docs.knoxvaults.com/overview/options-auction). The premium paid by the option buyers represents the weekly yield for depositors.
- At the conclusion of the auction, the vault underwrites the options sold using collateral provided by depositors.
