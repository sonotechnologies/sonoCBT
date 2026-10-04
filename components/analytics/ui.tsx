import { cn } from "@/lib/utils";

export function Stat({ k, v, d, tone }: { k: string; v: string; d?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="text-[13px] text-muted-foreground">{k}</div>
      <div className="mt-1 font-mono text-[28px] font-semibold">{v}</div>
      {d && <div className={cn("mt-0.5 text-xs", tone === "good" ? "font-semibold text-[#155E34]" : tone === "bad" ? "font-semibold text-[#A1271F]" : "text-muted-foreground")}>{d}</div>}
    </div>
  );
}

export function Card({ title, sub, action, flush, children }: { title: string; sub?: string; action?: React.ReactNode; flush?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-card", !flush && "p-[22px]")} aria-label={title}>
      <div className={cn("flex items-start gap-3", flush ? "px-[22px] py-[18px]" : "mb-4")}>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold">{title}</h2>
          {sub && <div className="mt-0.5 text-[13px] text-muted-foreground">{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Heatmap colours from the design: dark = mastered, orange = weak. Each cell also shows its number. */
export function heat(v: number | null): { bg: string; fg: string } {
  if (v === null) return { bg: "#F3F0E8", fg: "#5B6478" };
  if (v >= 80) return { bg: "#14213D", fg: "#FFFFFF" };
  if (v >= 65) return { bg: "#3E5A8A", fg: "#FFFFFF" };
  if (v >= 50) return { bg: "#9DB0CF", fg: "#14213D" };
  if (v >= 35) return { bg: "#F6D9BC", fg: "#14213D" };
  return { bg: "#D9731A", fg: "#14213D" };
}
