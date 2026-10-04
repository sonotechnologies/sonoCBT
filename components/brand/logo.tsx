import { cn } from "@/lib/utils";

type Variant = "ink" | "reversed" | "mono" | "monoReversed";

const PALETTE: Record<Variant, { ink: string; fill: string; tileBg: string; tileBorder: string }> = {
  ink: { ink: "#14213D", fill: "#F2B705", tileBg: "#14213D", tileBorder: "none" },
  reversed: { ink: "#FAF8F3", fill: "#F2B705", tileBg: "#F2B705", tileBorder: "none" },
  mono: { ink: "#14213D", fill: "#14213D", tileBg: "#FFFFFF", tileBorder: "2px solid #14213D" },
  monoReversed: { ink: "#FFFFFF", fill: "#FFFFFF", tileBg: "#FFFFFF", tileBorder: "none" },
};

/**
 * The "shaded bubble" wordmark: the two o's in "sono" are answer-sheet bubbles,
 * the first empty, the second filled. `mark` renders the app icon instead.
 */
export function Logo({
  variant = "ink",
  size = 32,
  mark = false,
  className,
}: {
  variant?: Variant;
  size?: number;
  mark?: boolean;
  className?: string;
}) {
  const p = PALETTE[variant];

  if (mark) {
    const fill = variant === "ink" ? p.fill : "#14213D";
    return (
      <span
        role="img"
        aria-label="SonoCBT"
        className={cn("inline-flex items-center justify-center", className)}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.24),
          background: p.tileBg,
          border: p.tileBorder,
        }}
      >
        <span className="rounded-full" style={{ width: "46%", height: "46%", background: fill }} />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label="SonoCBT"
      className={cn("inline-flex items-baseline whitespace-nowrap font-sans", className)}
      style={{ fontSize: size, lineHeight: 1, letterSpacing: "-0.035em", color: p.ink }}
    >
      <span aria-hidden className="font-semibold">
        s
      </span>
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{ width: "0.5em", height: "0.5em", margin: "0 0.035em", border: `0.075em solid ${p.ink}` }}
      />
      <span aria-hidden className="font-semibold">
        n
      </span>
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{
          width: "0.5em",
          height: "0.5em",
          margin: "0 0.05em 0 0.035em",
          background: p.fill,
          border: `0.075em solid ${p.fill}`,
        }}
      />
      <span aria-hidden className="font-extrabold">
        cbt
      </span>
    </span>
  );
}
