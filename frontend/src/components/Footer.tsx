export function Footer() {
  return (
    <footer className="mt-20 border-t border-line bg-paper">
      <div className="mx-auto grid max-w-page gap-6 px-4 py-10 text-[13px] leading-6 text-muted md:grid-cols-[1fr_auto] md:px-6">
        <div>
          <p className="text-base font-extrabold text-ink">
            Chain<span className="text-accent">Buy</span>
          </p>
          <p>참여금은 스마트컨트랙트에 보관되고, 결제는 플랫폼에 등록된 판매자·쇼핑몰로만 이루어집니다.</p>
          <p>구매자 수수료 0원(입점 상품) · 외부 상품은 이용료 5%를 화면에 표시합니다.</p>
        </div>
        <p className="md:text-right">
          블록체인 수업 프로젝트 · Sepolia 테스트넷 데모
          <br />
          실제 결제·배송은 이루어지지 않습니다.
        </p>
      </div>
    </footer>
  );
}
