// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ChainBuyUSD
/// @notice ChainBuy 테스트 결제 토큰. 소수점 6자리, 누구나 발행 가능 (테스트넷 전용, 실제 가치 없음).
contract ChainBuyUSD is ERC20 {
    constructor() ERC20("ChainBuy USD", "CBUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
