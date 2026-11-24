/** 카테고리 목록과 아이콘(24×24 SVG path). 메인 카테고리 줄, 목록 필터, 상품 썸네일이 함께 쓴다. */
export const CATEGORIES: { name: string; d: string }[] = [
  { name: "디지털", d: "M7 3h10v18H7zM10 18h4" },
  { name: "가전", d: "M4 5h16v11H4zM8 20h8M12 16v4" },
  { name: "식품", d: "M5 11h14l-1.5 9h-11zM8 11V7a4 4 0 0 1 8 0v4" },
  { name: "음료", d: "M7 3h10l-1.5 18h-7zM7.5 8h9" },
  { name: "캠핑", d: "M3 20L12 4l9 16zM12 4v16" },
  { name: "생활", d: "M4 20V8l8-5 8 5v12zM9 20v-6h6v6" },
  { name: "주방", d: "M6 3v8a3 3 0 0 0 6 0V3M9 11v10M16 3c-2 2-2 6 0 8v10" },
  { name: "육아", d: "M12 21c4 0 7-3 7-7 0-3-2-5-4-6l-1-4h-4l-1 4c-2 1-4 3-4 6 0 4 3 7 7 7z" },
  { name: "뷰티", d: "M9 3h6v5H9zM8 8h8v13H8zM8 13h8" },
  { name: "반려동물", d: "M7 10a2 2 0 1 0 0-.01M17 10a2 2 0 1 0 0-.01M10 6a2 2 0 1 0 0-.01M14 6a2 2 0 1 0 0-.01M8 17c0-3 2-4 4-4s4 1 4 4-2 3-4 3-4 0-4-3z" },
  { name: "스포츠", d: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" },
  { name: "패션", d: "M8 3l4 3 4-3 5 4-3 3v11H6V10L3 7z" },
  { name: "건강", d: "M12 20s-8-5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11zM9 11h6M12 8v6" },
  { name: "문구", d: "M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" },
];

const FALLBACK = "M4 7h16v13H4zM9 7V4h6v3";

export function categoryIcon(name?: string): string {
  return CATEGORIES.find((c) => c.name === name)?.d ?? FALLBACK;
}
