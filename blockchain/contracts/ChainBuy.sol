// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ChainBuy
/// @notice 공동구매 예치·결제·환불·수수료 규칙을 강제하는 에스크로 컨트랙트.
/// @dev 요구사항 명세서 v0.2의 5장을 구현한다.
///      - 예치금을 임의로 꺼내는 함수는 없다 (INV-1).
///      - 결제 대상은 공구 생성 시점에 등록부에서 복사한 값뿐이다 (INV-2).
///      - 결제 금액 ≤ 최대 가격 × 총 수량, 결제는 1회 (INV-3, INV-4).
///      - 수수료율·부담 주체는 생성 시점 값으로 고정, 상한 10% (INV-5).
///      - 수수료는 참여자별로 수령 확인 또는 이의 기간 경과 후 지급 (INV-6).
///      - 긴급 정지는 생성·예치만 막고 환불·수수료 지급은 막지 않는다 (INV-8).
contract ChainBuy is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─────────────────────────────── 상수 ───────────────────────────────

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000; // 10%
    uint64 public constant APPROVAL_WINDOW = 7 days;
    uint64 public constant DISPUTE_WINDOW = 7 days;

    // ─────────────────────────────── 타입 ───────────────────────────────

    /// @dev LISTED = 입점 상품(경로 A, 판매자가 수수료 부담), EXTERNAL = 외부 상품(경로 B, 구매자가 수수료 부담)
    enum Kind {
        LISTED,
        EXTERNAL
    }

    enum Status {
        OPEN,
        FAILED,
        PENDING_CHECK,
        CANCELLED,
        APPROVED,
        PAID,
        SHIPPED,
        COMPLETED
    }

    enum Receipt {
        NONE,
        CONFIRMED,
        DISPUTED
    }

    struct Seller {
        address wallet;
        bool active;
    }

    struct Merchant {
        address fundingAddress; // 일회용 카드 충전 주소 (카드 발급사)
        bool active;
    }

    /// @notice 공구 생성 시 등록자가 정하는 조건
    struct GroupParams {
        bytes32 productHash; // 상품 링크·조건·스냅샷 해시
        uint256 maxPrice; // 1개당 최대 가격 (토큰 최소 단위)
        uint32 targetQty; // 목표 수량 (= 모집 상한)
        uint32 maxPerUser; // 1인 최대 수량
        uint64 deadline; // 마감 시각 (unix)
    }

    struct Group {
        Kind kind;
        Status status;
        address creator;
        address payee; // 생성 시점에 등록부에서 복사한 결제 대상
        bytes32 partyId; // sellerId 또는 merchantId
        uint16 feeBps; // 생성 시점 수수료율
        bytes32 productHash;
        uint256 maxPrice;
        uint32 targetQty;
        uint32 maxPerUser;
        uint32 totalQty;
        uint32 settledQty; // 수수료 처리가 끝난 수량
        uint64 deadline;
        uint64 pendingSince; // 목표 달성(확인 대기) 시각
        uint64 shippedAt;
        bool checkSubmitted;
        uint256 checkedPrice; // AI가 확인한 1개당 가격
        bytes32 checkHash;
        uint256 cardFunded; // 경로 B: 카드 충전액
        bool remainderReturned; // 경로 B: 잔액 반환 완료
        uint256 actualGross; // 실제 상품 결제 총액 (수수료 제외)
        bytes32 orderHash;
    }

    struct Participant {
        uint32 qty;
        uint256 deposited;
        bytes32 recipientHash;
        bool refunded;
        Receipt receipt;
        bool feeSettled;
    }

    // ─────────────────────────────── 상태 ───────────────────────────────

    IERC20 public immutable token;
    address public feeRecipient;
    uint16 public feeBps;

    mapping(bytes32 => Seller) public sellers;
    mapping(bytes32 => Merchant) public merchants;

    uint256 public groupCount;
    mapping(uint256 => Group) private _groups;
    mapping(uint256 => mapping(address => Participant)) private _participants;
    mapping(bytes32 => bool) public usedOrderHash;

    // ─────────────────────────────── 이벤트 ───────────────────────────────

    event SellerSet(bytes32 indexed sellerId, address wallet, bool active);
    event MerchantSet(bytes32 indexed merchantId, address fundingAddress, bool active);
    event FeeBpsSet(uint16 feeBps);
    event FeeRecipientSet(address feeRecipient);
    event GroupCreated(
        uint256 indexed id,
        Kind kind,
        address indexed creator,
        bytes32 partyId,
        address payee,
        uint16 feeBps,
        uint256 maxPrice,
        uint32 targetQty,
        uint64 deadline
    );
    event Deposited(uint256 indexed id, address indexed user, uint32 qty, uint256 amount);
    event Withdrawn(uint256 indexed id, address indexed user, uint256 amount);
    event Finalized(uint256 indexed id, Status status);
    event CheckSubmitted(uint256 indexed id, uint256 price, bytes32 checkHash);
    event Approved(uint256 indexed id);
    event Cancelled(uint256 indexed id);
    event Paid(uint256 indexed id, address payee, uint256 amount, uint256 feeHeld);
    event CardFunded(uint256 indexed id, address fundingAddress, uint256 amount);
    event RemainderReturned(uint256 indexed id, uint256 amount, uint256 actualGross);
    event OrderProofSubmitted(uint256 indexed id, bytes32 orderHash);
    event Shipped(uint256 indexed id, uint64 shippedAt);
    event Refunded(uint256 indexed id, address indexed user, uint256 amount);
    event ReceiptConfirmed(uint256 indexed id, address indexed user);
    event Disputed(uint256 indexed id, address indexed user, bytes32 reasonHash);
    event DisputeResolved(uint256 indexed id, address indexed user, bool accepted, uint256 fee);
    event FeeReleased(uint256 indexed id, address indexed user, uint256 fee);
    event Completed(uint256 indexed id);

    // ─────────────────────────────── 에러 ───────────────────────────────

    error InvalidParams();
    error InactiveParty();
    error WrongStatus(Status current);
    error DeadlinePassed();
    error NotFinalizable();
    error QtyLimit();
    error NotParticipant();
    error AlreadyRefunded();
    error NothingToRefund();
    error CheckMissing();
    error PriceTooHigh();
    error OverLimit();
    error WrongKind();
    error NotPayee();
    error RemainderPending();
    error OrderHashUsed();
    error OrderProofMissing();
    error ReceiptAlreadySet();
    error DisputeWindowClosed();
    error FeeNotReleasable();
    error Unauthorized();

    // ─────────────────────────────── 생성자 ───────────────────────────────

    constructor(IERC20 token_, address admin, address feeRecipient_, uint16 feeBps_) {
        if (address(token_) == address(0) || admin == address(0) || feeRecipient_ == address(0)) {
            revert InvalidParams();
        }
        if (feeBps_ > MAX_FEE_BPS) revert InvalidParams();
        token = token_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─────────────────────────────── 관리자·등록부 ───────────────────────────────

    /// @notice 판매자 결제 지갑 등록·변경·정지. 기존 공구의 결제 대상에는 영향 없음 (SEL-03, SEL-04).
    function setSeller(bytes32 sellerId, address wallet, bool active) external onlyRole(REVIEWER_ROLE) {
        if (wallet == address(0)) revert InvalidParams();
        sellers[sellerId] = Seller(wallet, active);
        emit SellerSet(sellerId, wallet, active);
    }

    /// @notice 허용 쇼핑몰과 카드 충전 주소 등록·해제 (ADM-05).
    function setMerchant(bytes32 merchantId, address fundingAddress, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (fundingAddress == address(0)) revert InvalidParams();
        merchants[merchantId] = Merchant(fundingAddress, active);
        emit MerchantSet(merchantId, fundingAddress, active);
    }

    /// @notice 수수료율 변경. 상한 10%, 신규 공구에만 적용 (FEE-06).
    function setFeeBps(uint16 feeBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidParams();
        feeBps = feeBps_;
        emit FeeBpsSet(feeBps_);
    }

    function setFeeRecipient(address feeRecipient_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeRecipient_ == address(0)) revert InvalidParams();
        feeRecipient = feeRecipient_;
        emit FeeRecipientSet(feeRecipient_);
    }

    /// @notice 긴급 정지: 새 공구 생성·새 예치만 멈춘다 (ADM-07, INV-8).
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─────────────────────────────── 공구 생성 ───────────────────────────────

    /// @notice 입점 상품 공구. 누구나 열 수 있고, 결제 대상은 판매자 등록부 값으로 고정 (GB-01, GB-04).
    function createListedGroup(bytes32 sellerId, GroupParams calldata p)
        external
        whenNotPaused
        returns (uint256 id)
    {
        Seller memory s = sellers[sellerId];
        if (!s.active) revert InactiveParty();
        id = _create(Kind.LISTED, msg.sender, sellerId, s.wallet, p);
    }

    /// @notice 외부 상품 공구. 담당자가 링크를 확인한 뒤 생성 (GB-02, LNK-05).
    function createExternalGroup(bytes32 merchantId, address creator, GroupParams calldata p)
        external
        whenNotPaused
        onlyRole(REVIEWER_ROLE)
        returns (uint256 id)
    {
        Merchant memory m = merchants[merchantId];
        if (!m.active) revert InactiveParty();
        if (creator == address(0)) revert InvalidParams();
        id = _create(Kind.EXTERNAL, creator, merchantId, m.fundingAddress, p);
    }

    function _create(Kind kind, address creator, bytes32 partyId, address payee, GroupParams calldata p)
        private
        returns (uint256 id)
    {
        if (
            p.maxPrice == 0 || p.targetQty == 0 || p.maxPerUser == 0 || p.maxPerUser > p.targetQty
                || p.deadline <= block.timestamp
        ) revert InvalidParams();

        id = ++groupCount;
        Group storage g = _groups[id];
        g.kind = kind;
        g.status = Status.OPEN;
        g.creator = creator;
        g.payee = payee;
        g.partyId = partyId;
        g.feeBps = feeBps;
        g.productHash = p.productHash;
        g.maxPrice = p.maxPrice;
        g.targetQty = p.targetQty;
        g.maxPerUser = p.maxPerUser;
        g.deadline = p.deadline;

        emit GroupCreated(id, kind, creator, partyId, payee, g.feeBps, p.maxPrice, p.targetQty, p.deadline);
    }

    // ─────────────────────────────── 참여·마감 ───────────────────────────────

    /// @notice 참여: 입점 상품은 최대 가격 × 수량, 외부 상품은 이용료(수수료)까지 포함해 예치 (DEP-01).
    function deposit(uint256 id, uint32 qty, bytes32 recipientHash) external nonReentrant whenNotPaused {
        Group storage g = _groups[id];
        if (g.status != Status.OPEN) revert WrongStatus(g.status);
        if (block.timestamp >= g.deadline) revert DeadlinePassed();
        Participant storage p = _participants[id][msg.sender];
        if (qty == 0 || p.qty + qty > g.maxPerUser || g.totalQty + qty > g.targetQty) revert QtyLimit();

        uint256 amount = depositAmount(id, qty);
        p.qty += qty;
        p.deposited += amount;
        p.recipientHash = recipientHash;
        g.totalQty += qty;

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(id, msg.sender, qty, amount);
    }

    /// @notice 마감 전 참여 취소, 전액 환불 (DEP-05). 긴급 정지 중에도 가능.
    function withdraw(uint256 id) external nonReentrant {
        Group storage g = _groups[id];
        if (g.status != Status.OPEN) revert WrongStatus(g.status);
        if (block.timestamp >= g.deadline) revert DeadlinePassed();
        Participant storage p = _participants[id][msg.sender];
        if (p.qty == 0) revert NotParticipant();

        uint256 amount = p.deposited;
        g.totalQty -= p.qty;
        delete _participants[id][msg.sender];

        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(id, msg.sender, amount);
    }

    /// @notice 마감 판정. 마감 시각 이후 또는 목표 수량이 다 차면 누구나 호출 (RF-01).
    function finalize(uint256 id) external {
        Group storage g = _groups[id];
        if (g.status != Status.OPEN) revert WrongStatus(g.status);
        bool full = g.totalQty == g.targetQty;
        if (!full && block.timestamp < g.deadline) revert NotFinalizable();

        if (full) {
            g.status = Status.PENDING_CHECK;
            g.pendingSince = uint64(block.timestamp);
        } else {
            g.status = Status.FAILED;
        }
        emit Finalized(id, g.status);
    }

    // ─────────────────────────────── AI 확인·승인 ───────────────────────────────

    /// @notice AI 확인 결과 제출 (AI-03). 최대 가격을 넘으면 제출 대신 cancel을 호출해야 한다.
    function submitCheck(uint256 id, uint256 price, bytes32 checkHash) external onlyRole(AGENT_ROLE) {
        Group storage g = _groups[id];
        if (g.status != Status.PENDING_CHECK) revert WrongStatus(g.status);
        if (price == 0) revert InvalidParams();
        if (price > g.maxPrice) revert PriceTooHigh();
        g.checkSubmitted = true;
        g.checkedPrice = price;
        g.checkHash = checkHash;
        emit CheckSubmitted(id, price, checkHash);
    }

    /// @notice 담당자 승인. AI 제출이 있어야만 가능 (AI-05).
    function approve(uint256 id) external onlyRole(REVIEWER_ROLE) {
        Group storage g = _groups[id];
        if (g.status != Status.PENDING_CHECK) revert WrongStatus(g.status);
        if (!g.checkSubmitted) revert CheckMissing();
        g.status = Status.APPROVED;
        emit Approved(id);
    }

    function reject(uint256 id) external onlyRole(REVIEWER_ROLE) {
        Group storage g = _groups[id];
        if (g.status != Status.PENDING_CHECK) revert WrongStatus(g.status);
        g.status = Status.CANCELLED;
        emit Cancelled(id);
    }

    /// @notice 취소. AGENT·REVIEWER는 결제 전 언제든, 승인 기한(7일)이 지나면 누구나 (RF-03, RF-05).
    function cancel(uint256 id) external {
        Group storage g = _groups[id];
        if (g.status != Status.PENDING_CHECK && g.status != Status.APPROVED) revert WrongStatus(g.status);
        bool privileged = hasRole(AGENT_ROLE, msg.sender) || hasRole(REVIEWER_ROLE, msg.sender);
        bool expired = block.timestamp > g.pendingSince + APPROVAL_WINDOW;
        if (!privileged && !expired) revert Unauthorized();
        g.status = Status.CANCELLED;
        emit Cancelled(id);
    }

    // ─────────────────────────────── 결제 ───────────────────────────────

    /// @notice 경로 A: 고정된 판매자 지갑으로 (확인 가격 × 수량 − 수수료) 전송. 수수료는 컨트랙트에 보관 (PA-01, PA-02).
    function payListed(uint256 id) external nonReentrant onlyRole(AGENT_ROLE) {
        Group storage g = _groups[id];
        if (g.kind != Kind.LISTED) revert WrongKind();
        if (g.status != Status.APPROVED) revert WrongStatus(g.status);

        uint256 gross = g.checkedPrice * g.totalQty; // checkedPrice ≤ maxPrice 이므로 한도 이내
        uint256 feeHeld = _listedFeePerUnit(g) * g.totalQty;
        g.actualGross = gross;
        g.status = Status.PAID;

        token.safeTransfer(g.payee, gross - feeHeld);
        emit Paid(id, g.payee, gross - feeHeld, feeHeld);
    }

    /// @notice 경로 B: 고정된 카드 충전 주소로 한도 이내 금액 전송 (PB-02).
    function fundCard(uint256 id, uint256 amount) external nonReentrant onlyRole(AGENT_ROLE) {
        Group storage g = _groups[id];
        if (g.kind != Kind.EXTERNAL) revert WrongKind();
        if (g.status != Status.APPROVED) revert WrongStatus(g.status);
        if (amount == 0 || amount > g.maxPrice * g.totalQty) revert OverLimit();

        g.cardFunded = amount;
        g.status = Status.PAID;

        token.safeTransfer(g.payee, amount);
        emit CardFunded(id, g.payee, amount);
    }

    /// @notice 경로 B: 카드 잔액 반환. 카드 충전 주소만 호출 가능. 반환 후 실제 결제액 확정 (PB-05).
    /// @dev 결제가 전혀 안 됐으면(전액 반환) 공구는 취소되고 참여자는 전액 환불받는다.
    function returnRemainder(uint256 id, uint256 amount) external nonReentrant {
        Group storage g = _groups[id];
        if (g.kind != Kind.EXTERNAL) revert WrongKind();
        if (g.status != Status.PAID) revert WrongStatus(g.status);
        if (msg.sender != g.payee) revert NotPayee();
        if (g.remainderReturned) revert RemainderPending();
        if (amount > g.cardFunded) revert OverLimit();

        g.remainderReturned = true;
        g.actualGross = g.cardFunded - amount;
        if (g.actualGross == 0) {
            g.status = Status.CANCELLED;
            emit Cancelled(id);
        }

        if (amount > 0) token.safeTransferFrom(msg.sender, address(this), amount);
        emit RemainderReturned(id, amount, g.actualGross);
    }

    // ─────────────────────────────── 주문 증거·배송 ───────────────────────────────

    /// @notice 주문번호 해시 기록. 같은 해시는 재사용 불가 (DL-01, DL-02).
    function submitOrderProof(uint256 id, bytes32 orderHash) external onlyRole(AGENT_ROLE) {
        Group storage g = _groups[id];
        if (g.status != Status.PAID) revert WrongStatus(g.status);
        if (orderHash == bytes32(0) || usedOrderHash[orderHash]) revert OrderHashUsed();
        if (g.orderHash != bytes32(0)) revert OrderHashUsed();
        usedOrderHash[orderHash] = true;
        g.orderHash = orderHash;
        emit OrderProofSubmitted(id, orderHash);
    }

    /// @notice 배송 완료 기록 → 이의 기간 시작 (DL-05).
    function markShipped(uint256 id) external onlyRole(AGENT_ROLE) {
        Group storage g = _groups[id];
        if (g.status != Status.PAID) revert WrongStatus(g.status);
        if (g.orderHash == bytes32(0)) revert OrderProofMissing();
        if (g.kind == Kind.EXTERNAL && !g.remainderReturned) revert RemainderPending();
        g.status = Status.SHIPPED;
        g.shippedAt = uint64(block.timestamp);
        emit Shipped(id, g.shippedAt);
    }

    // ─────────────────────────────── 환불 ───────────────────────────────

    /// @notice 환불 (pull 방식). 실패·취소 시 전액, 결제 후에는 차액 (RF-02 ~ RF-04).
    function refund(uint256 id) external nonReentrant {
        Group storage g = _groups[id];
        Participant storage p = _participants[id][msg.sender];
        if (p.qty == 0) revert NotParticipant();
        if (p.refunded) revert AlreadyRefunded();

        uint256 amount;
        if (g.status == Status.FAILED || g.status == Status.CANCELLED) {
            amount = p.deposited;
        } else if (g.status == Status.PAID || g.status == Status.SHIPPED || g.status == Status.COMPLETED) {
            if (g.kind == Kind.EXTERNAL && !g.remainderReturned) revert RemainderPending();
            amount = p.deposited - _userGross(g, p) - _userFeeFromDeposit(g, p);
        } else {
            revert WrongStatus(g.status);
        }
        if (amount == 0) revert NothingToRefund();

        p.refunded = true;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(id, msg.sender, amount);
    }

    // ─────────────────────────────── 수령 확인·이의·수수료 ───────────────────────────────

    /// @notice 수령 확인 → 내 몫 수수료 지급 가능 (FEE-03).
    function confirmReceipt(uint256 id) external {
        Group storage g = _groups[id];
        if (g.status != Status.SHIPPED) revert WrongStatus(g.status);
        Participant storage p = _participants[id][msg.sender];
        if (p.qty == 0) revert NotParticipant();
        if (p.receipt != Receipt.NONE) revert ReceiptAlreadySet();
        p.receipt = Receipt.CONFIRMED;
        emit ReceiptConfirmed(id, msg.sender);
    }

    /// @notice 이의 제기 → 내 몫 수수료 보류 (DSP-01, DSP-02).
    function dispute(uint256 id, bytes32 reasonHash) external {
        Group storage g = _groups[id];
        if (g.status != Status.SHIPPED) revert WrongStatus(g.status);
        if (block.timestamp > g.shippedAt + DISPUTE_WINDOW) revert DisputeWindowClosed();
        Participant storage p = _participants[id][msg.sender];
        if (p.qty == 0) revert NotParticipant();
        if (p.receipt != Receipt.NONE) revert ReceiptAlreadySet();
        p.receipt = Receipt.DISPUTED;
        emit Disputed(id, msg.sender, reasonHash);
    }

    /// @notice 이의 처리. 인정하면 보류된 수수료 몫을 참여자에게, 기각하면 플랫폼에 (DSP-03).
    function resolveDispute(uint256 id, address user, bool accepted)
        external
        nonReentrant
        onlyRole(REVIEWER_ROLE)
    {
        Group storage g = _groups[id];
        if (g.status != Status.SHIPPED) revert WrongStatus(g.status);
        Participant storage p = _participants[id][user];
        if (p.receipt != Receipt.DISPUTED || p.feeSettled) revert FeeNotReleasable();

        uint256 fee = _userFee(g, p);
        _settle(id, g, p);
        if (fee > 0) token.safeTransfer(accepted ? user : feeRecipient, fee);
        emit DisputeResolved(id, user, accepted, fee);
    }

    /// @notice 수수료 지급. 수령 확인했거나, 이의 없이 7일이 지난 몫만. 누구나 호출 (FEE-04, FEE-05).
    function releaseFee(uint256 id, address user) external nonReentrant {
        Group storage g = _groups[id];
        if (g.status != Status.SHIPPED) revert WrongStatus(g.status);
        Participant storage p = _participants[id][user];
        if (p.qty == 0) revert NotParticipant();
        if (p.feeSettled) revert FeeNotReleasable();
        bool confirmed = p.receipt == Receipt.CONFIRMED;
        bool timedOut = p.receipt == Receipt.NONE && block.timestamp > g.shippedAt + DISPUTE_WINDOW;
        if (!confirmed && !timedOut) revert FeeNotReleasable();

        uint256 fee = _userFee(g, p);
        _settle(id, g, p);
        if (fee > 0) token.safeTransfer(feeRecipient, fee);
        emit FeeReleased(id, user, fee);
    }

    function _settle(uint256 id, Group storage g, Participant storage p) private {
        p.feeSettled = true;
        g.settledQty += p.qty;
        if (g.settledQty == g.totalQty) {
            g.status = Status.COMPLETED;
            emit Completed(id);
        }
    }

    // ─────────────────────────────── 계산 ───────────────────────────────

    /// @notice 수량 qty로 참여할 때 예치해야 하는 금액.
    /// @dev 외부 상품은 1개당 수수료를 올림으로 받아, 실제 수수료가 예치금을 넘지 않게 한다.
    function depositAmount(uint256 id, uint32 qty) public view returns (uint256) {
        Group storage g = _groups[id];
        uint256 unit = g.maxPrice;
        if (g.kind == Kind.EXTERNAL) {
            unit += Math.mulDiv(g.maxPrice, g.feeBps, BPS, Math.Rounding.Ceil);
        }
        return unit * qty;
    }

    /// @dev 참여자 몫의 실제 상품 금액. 외부 상품은 올림 처리해 컨트랙트 잔액 부족을 막는다 (INV-7).
    function _userGross(Group storage g, Participant storage p) private view returns (uint256) {
        if (g.kind == Kind.LISTED) return g.checkedPrice * p.qty;
        return Math.mulDiv(g.actualGross, p.qty, g.totalQty, Math.Rounding.Ceil);
    }

    /// @dev 참여자 몫의 수수료 (실제 결제 금액 기준).
    function _userFee(Group storage g, Participant storage p) private view returns (uint256) {
        if (g.kind == Kind.LISTED) return _listedFeePerUnit(g) * p.qty;
        return (_userGross(g, p) * g.feeBps) / BPS;
    }

    /// @dev 참여자 예치금에서 빠지는 수수료. 입점 상품은 판매자가 부담하므로 0.
    function _userFeeFromDeposit(Group storage g, Participant storage p) private view returns (uint256) {
        return g.kind == Kind.EXTERNAL ? _userFee(g, p) : 0;
    }

    function _listedFeePerUnit(Group storage g) private view returns (uint256) {
        return (g.checkedPrice * g.feeBps) / BPS;
    }

    // ─────────────────────────────── 조회 ───────────────────────────────

    function getGroup(uint256 id) external view returns (Group memory) {
        return _groups[id];
    }

    function getParticipant(uint256 id, address user) external view returns (Participant memory) {
        return _participants[id][user];
    }

    /// @notice 지금 refund()를 호출하면 받을 금액 (받을 수 없으면 0).
    function refundableAmount(uint256 id, address user) external view returns (uint256) {
        Group storage g = _groups[id];
        Participant storage p = _participants[id][user];
        if (p.qty == 0 || p.refunded) return 0;
        if (g.status == Status.FAILED || g.status == Status.CANCELLED) return p.deposited;
        if (g.status == Status.PAID || g.status == Status.SHIPPED || g.status == Status.COMPLETED) {
            if (g.kind == Kind.EXTERNAL && !g.remainderReturned) return 0;
            return p.deposited - _userGross(g, p) - _userFeeFromDeposit(g, p);
        }
        return 0;
    }

    /// @notice 참여자 몫의 수수료 (결제 전에는 0).
    function feeOf(uint256 id, address user) external view returns (uint256) {
        Group storage g = _groups[id];
        Participant storage p = _participants[id][user];
        if (p.qty == 0 || g.actualGross == 0) return 0;
        return _userFee(g, p);
    }
}
