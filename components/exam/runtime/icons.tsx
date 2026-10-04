/** Inline icons for the exam runtime (no icon library in this bundle). */
type P = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className,
});

export const Check = ({ size = 16, className }: P) => (
  <svg {...base(size, className)} strokeWidth={2.5}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const WifiOff = ({ size = 16, className }: P) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <path d="M12 20h.01" />
    <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
    <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
    <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
    <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
    <path d="m2 2 20 20" />
  </svg>
);

export const Flag = ({ size = 16, filled, className }: P & { filled?: boolean }) => (
  <svg {...base(size, className)} strokeWidth={2} fill={filled ? "currentColor" : "none"}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" x2="4" y1="22" y2="15" />
  </svg>
);

export const Chevron = ({ size = 20, dir, className }: P & { dir: "left" | "right" | "up" }) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <path d={dir === "left" ? "m15 18-6-6 6-6" : dir === "right" ? "m9 18 6-6-6-6" : "m18 15-6-6-6 6"} />
  </svg>
);

export const CalcIcon = ({ size = 18, className }: P) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M9 6h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h.01M15 18h.01" />
  </svg>
);

export const Contrast = ({ size = 18, className }: P) => (
  <svg {...base(size, className)} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" />
  </svg>
);
