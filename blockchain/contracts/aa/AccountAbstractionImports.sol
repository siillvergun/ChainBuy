// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ERC-4337 표준 구현(eth-infinitism v0.7)을 컴파일해 두기 위한 파일.
// - EntryPoint: 로컬 체인에 배포 (Sepolia에는 표준 주소 0x0000000071727De22E5E9d8BAf0edAc6f37da032 에 이미 있음)
// - SimpleAccountFactory: 참여자 MetaMask 주소를 주인으로 하는 스마트 지갑을 만든다
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {SimpleAccountFactory} from "@account-abstraction/contracts/samples/SimpleAccountFactory.sol";
