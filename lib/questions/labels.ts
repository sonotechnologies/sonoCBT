/** Display labels shared by server and client components (kept out of "use client" files). */
export type QuestionStatus = "draft" | "pending" | "returned" | "approved" | "archived";

export const STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "Draft",
  pending: "Awaiting approval",
  returned: "Returned",
  approved: "Approved",
  archived: "Archived",
};

export const STATUS_STYLE: Record<QuestionStatus, string> = {
  draft: "bg-chip text-ink-2",
  pending: "bg-[#EAF1F9] text-[#1D4B80]",
  returned: "bg-[#FBEFE3] text-[#8A430B]",
  approved: "bg-[#E8F4EC] text-[#155E34]",
  archived: "bg-chip text-muted-foreground",
};

const SYMBOLS: Record<string, string> = {
  times: "×",
  div: "÷",
  pm: "±",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  pi: "π",
  theta: "θ",
  alpha: "α",
  beta: "β",
  circ: "°",
  rightarrow: "→",
  to: "→",
  cdot: "·",
  infty: "∞",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

/** Readable one-line text for lists: "$\frac{3}{4} + x^{2}$" → "3/4 + x²". */
export function plainText(text: string): string {
  return text.replace(/\$\$?([^$]+)\$\$?/g, (_, tex: string) => {
    let s = tex;
    s = s.replace(/\\ce\{([^}]*)\}/g, (_m, f: string) => f.replace(/(?<=[A-Za-z)])(\d+)/g, (d: string) => [...d].map((c) => SUB[c] ?? c).join("")));
    s = s.replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, "$1");
    s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2");
    s = s.replace(/\\sqrt\{([^}]*)\}/g, "√$1");
    s = s.replace(/\^\{?\\circ\}?/g, "°");
    s = s.replace(/\^\{([^}]*)\}|\^(\w)/g, (_m, a?: string, b?: string) => {
      const v = a ?? b ?? "";
      return [...v].every((c) => SUP[c]) ? [...v].map((c) => SUP[c]).join("") : `^${v}`;
    });
    s = s.replace(/_\{([^}]*)\}|_(\w)/g, (_m, a?: string, b?: string) => {
      const v = a ?? b ?? "";
      return [...v].every((c) => SUB[c]) ? [...v].map((c) => SUB[c]).join("") : `_${v}`;
    });
    s = s.replace(/\\([a-zA-Z]+)/g, (m, name: string) => SYMBOLS[name] ?? "");
    s = s.replace(/\\[,;: ]/g, " ").replace(/[{}]/g, "");
    return s.replace(/\s+/g, " ").trim();
  });
}
