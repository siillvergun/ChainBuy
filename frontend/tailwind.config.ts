import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        muted: "#767676",
        line: "#ECECEC",
        paper: "#FAFAF9",
        accent: { DEFAULT: "#D9411E", dark: "#A4300F", tint: "#FFF1EC", line: "#F8C9B8" },
        safe: { DEFAULT: "#0E7A4F", tint: "#EAF6EF" },
      },
      fontFamily: { sans: ["\"Noto Sans KR\"", "Apple SD Gothic Neo", "sans-serif"] },
      maxWidth: { page: "1200px" },
    },
  },
  plugins: [],
} satisfies Config;
