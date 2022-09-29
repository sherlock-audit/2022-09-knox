// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@solidstate/contracts/token/ERC20/base/ERC20Base.sol";
import "@solidstate/contracts/token/ERC20/metadata/ERC20Metadata.sol";
import "@solidstate/contracts/token/ERC20/metadata/ERC20MetadataStorage.sol";

contract MockERC20 is ERC20Base, ERC20Metadata {
    constructor(string memory symbol, uint8 decimals) {
        ERC20MetadataStorage.layout().symbol = symbol;
        ERC20MetadataStorage.layout().name = symbol;
        ERC20MetadataStorage.layout().decimals = decimals;

        _mint(msg.sender, 10**(decimals + 7));
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function mint(address _account, uint256 _amount) public {
        _mint(_account, _amount);
    }
}
