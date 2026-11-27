// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BasePaymaster} from "@account-abstraction/contracts/core/BasePaymaster.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import {SimpleAccount} from "@account-abstraction/contracts/samples/SimpleAccount.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainBuy} from "../ChainBuy.sol";
import {ChainBuyUSD} from "../ChainBuyUSD.sol";

/// @title ChainBuyPaymaster
/// @notice 참여자 스마트 지갑의 가스비를 플랫폼이 대신 낸다 (ERC-4337 Paymaster).
/// 두 겹으로 남용을 막는다.
///  1) 체인 위 규칙: 스마트 지갑이 하려는 호출이 ChainBuy 참여자 기능 · 테스트 토큰 받기/승인일 때만 대납
///  2) 백엔드 서명: 서버가 횟수 제한 등을 확인하고 서명한 요청만 대납 (유효 시간 포함)
contract ChainBuyPaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;

    /// paymasterAndData 구성: [paymaster 20][검증 가스 16][postOp 가스 16][validUntil·validAfter 64][서명 65]
    uint256 private constant VALID_TIMESTAMP_OFFSET = PAYMASTER_DATA_OFFSET;
    uint256 private constant SIGNATURE_OFFSET = VALID_TIMESTAMP_OFFSET + 64;

    address public immutable verifyingSigner;
    address public immutable chainBuy;
    address public immutable token;

    error CallNotSponsored(address target, bytes4 selector);
    error UnsupportedAccountCall(bytes4 selector);
    error InvalidSignatureLength();

    constructor(IEntryPoint entryPoint_, address verifyingSigner_, address chainBuy_, address token_) BasePaymaster(entryPoint_) {
        verifyingSigner = verifyingSigner_;
        chainBuy = chainBuy_;
        token = token_;
    }

    /// 백엔드가 서명할 해시. paymasterAndData의 서명 부분만 빼고 요청 전체를 덮는다 (eth-infinitism VerifyingPaymaster와 같은 방식)
    function getHash(PackedUserOperation calldata userOp, uint48 validUntil, uint48 validAfter) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.getSender(),
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                uint256(bytes32(userOp.paymasterAndData[PAYMASTER_VALIDATION_GAS_OFFSET:PAYMASTER_DATA_OFFSET])),
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    function parsePaymasterAndData(bytes calldata paymasterAndData)
        public
        pure
        returns (uint48 validUntil, uint48 validAfter, bytes calldata signature)
    {
        (validUntil, validAfter) = abi.decode(paymasterAndData[VALID_TIMESTAMP_OFFSET:SIGNATURE_OFFSET], (uint48, uint48));
        signature = paymasterAndData[SIGNATURE_OFFSET:];
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        _requireSponsoredCalls(userOp.getSender(), userOp.callData);

        (uint48 validUntil, uint48 validAfter, bytes calldata signature) = parsePaymasterAndData(userOp.paymasterAndData);
        if (signature.length != 64 && signature.length != 65) revert InvalidSignatureLength();
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));
        bool signatureFailed = ECDSA.recover(hash, signature) != verifyingSigner;
        // 서명이 틀려도 되돌리지 않고 '실패'로 표시한다 (ERC-4337 규칙: EntryPoint가 거절)
        return ("", _packValidationData(signatureFailed, validUntil, validAfter));
    }

    /// 스마트 지갑(SimpleAccount)의 execute / executeBatch 안에 든 호출을 하나씩 검사한다
    function _requireSponsoredCalls(address account, bytes calldata accountCall) private view {
        bytes4 selector = bytes4(accountCall[:4]);
        if (selector == SimpleAccount.execute.selector) {
            (address target, uint256 value, bytes memory data) = abi.decode(accountCall[4:], (address, uint256, bytes));
            _requireSponsored(account, target, value, data);
        } else if (selector == SimpleAccount.executeBatch.selector) {
            (address[] memory targets, uint256[] memory values, bytes[] memory datas) =
                abi.decode(accountCall[4:], (address[], uint256[], bytes[]));
            for (uint256 i = 0; i < targets.length; i++) {
                uint256 value = values.length == 0 ? 0 : values[i];
                _requireSponsored(account, targets[i], value, datas[i]);
            }
        } else {
            revert UnsupportedAccountCall(selector);
        }
    }

    function _requireSponsored(address account, address target, uint256 value, bytes memory data) private view {
        bytes4 selector = data.length >= 4 ? bytes4(data) : bytes4(0);
        if (value == 0 && _isAllowed(account, target, selector, data)) return;
        revert CallNotSponsored(target, selector);
    }

    /// 대납하는 호출 목록
    ///  - ChainBuy: 참여(deposit) · 참여 취소(withdraw) · 환불(refund) · 수령 확인(confirmReceipt) · 이의 제기(dispute)
    ///  - ChainBuyUSD: 자기 지갑으로 테스트 토큰 받기(mint) · ChainBuy에 사용 승인(approve)
    function _isAllowed(address account, address target, bytes4 selector, bytes memory data) private view returns (bool) {
        if (target == chainBuy) {
            return selector == ChainBuy.deposit.selector || selector == ChainBuy.withdraw.selector
                || selector == ChainBuy.refund.selector || selector == ChainBuy.confirmReceipt.selector
                || selector == ChainBuy.dispute.selector;
        }
        if (target == token) {
            if (selector == ChainBuyUSD.mint.selector) return _firstAddressArgument(data) == account;
            if (selector == IERC20.approve.selector) return _firstAddressArgument(data) == chainBuy;
        }
        return false;
    }

    /// 함수 호출 데이터에서 첫 번째 인자(주소)를 꺼낸다: [선택자 4바이트][인자1 32바이트]...
    function _firstAddressArgument(bytes memory data) private pure returns (address) {
        if (data.length < 36) return address(0);
        uint256 word;
        assembly {
            word := mload(add(data, 36)) // bytes 길이(32) + 선택자(4) 뒤의 32바이트
        }
        // 주소는 하위 20바이트. 상위에 값이 섞여 있으면 정상적인 인코딩이 아니므로 거절
        if (word >> 160 != 0) return address(0);
        return address(uint160(word));
    }
}
