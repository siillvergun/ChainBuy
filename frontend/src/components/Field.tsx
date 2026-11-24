export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "ok" ? "bg-safe-tint text-safe" : tone === "error" ? "bg-accent-tint text-accent-dark" : "bg-paper text-[#4A4A4A]";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg p-4 text-[15px] leading-6 ${cls}`}>
      {children}
    </div>
  );
}
