import Link from "next/link";
import type { SponsorTag } from "@/lib/api";

/** 협찬 표시 (표시광고법상 광고임을 밝힘). 누르면 인플루언서 페이지로 간다 */
export function SponsorBadge({ tags, size = "sm", link = true }: { tags?: SponsorTag[]; size?: "sm" | "md"; link?: boolean }) {
  if (!tags?.length) return null;
  const t = tags[0];
  const more = tags.length > 1 ? ` 외 ${tags.length - 1}명` : "";
  const cls = size === "md" ? "px-2.5 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]";
  const body = (
    <>
      <span className="rounded-sm bg-[#3B3FB6] px-1 text-[10px] text-white">광고</span>@{t.handle} 협찬{more}
    </>
  );
  // 카드처럼 이미 링크 안에 있을 때는 링크를 겹치지 않는다
  if (!link)
    return <span className={`inline-flex w-fit items-center gap-1 rounded bg-[#EEF0FF] font-bold text-[#3B3FB6] ${cls}`}>{body}</span>;
  return (
    <Link
      href={`/i/${t.handle}`}
      className={`inline-flex w-fit items-center gap-1 rounded bg-[#EEF0FF] font-bold text-[#3B3FB6] hover:underline ${cls}`}
      title={`인증 계정: ${t.platforms.join(", ")}`}
    >
      {body}
    </Link>
  );
}
