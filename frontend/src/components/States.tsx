import { CHAINBUY_ADDRESS } from "@/lib/config";

/** 컨트랙트 주소가 없거나 체인에 연결할 수 없을 때 보여주는 안내 */
export function ChainNotice({ error }: { error?: unknown }) {
  if (CHAINBUY_ADDRESS && !error) return null;
  return (
    <div className="rounded-lg border border-accent-line bg-accent-tint p-4 text-sm leading-6 text-accent-dark">
      <strong>블록체인에 연결되지 않았어요.</strong>
      <br />
      {CHAINBUY_ADDRESS
        ? "로컬 체인(127.0.0.1:8545)이 실행 중인지 확인해 주세요."
        : "컨트랙트 주소가 없어요. blockchain에서 배포 후 npm run sync:contracts 를 실행해 주세요."}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line py-16 text-center text-sm text-muted">{children}</div>;
}

export function GridSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square rounded-lg bg-line" />
          <div className="mt-3 h-4 w-3/4 rounded bg-line" />
          <div className="mt-2 h-5 w-1/2 rounded bg-line" />
        </div>
      ))}
    </div>
  );
}
