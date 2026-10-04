/**
 * Word equations (OMML) → LaTeX. Covers what teachers type in Word's equation
 * editor for secondary-school maths and chemistry; anything else is reported
 * as unsupported so the question gets flagged "Equation needs review".
 */

type El = {
  nodeType: number;
  localName?: string | null;
  nodeName: string;
  childNodes: ArrayLike<El>;
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
};

const SYMBOLS: Record<string, string> = {
  "×": "\\times ",
  "÷": "\\div ",
  "±": "\\pm ",
  "∓": "\\mp ",
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
  "≈": "\\approx ",
  "∞": "\\infty ",
  "π": "\\pi ",
  "θ": "\\theta ",
  "α": "\\alpha ",
  "β": "\\beta ",
  "γ": "\\gamma ",
  "δ": "\\delta ",
  "Δ": "\\Delta ",
  "λ": "\\lambda ",
  "μ": "\\mu ",
  "σ": "\\sigma ",
  "Σ": "\\Sigma ",
  "ω": "\\omega ",
  "Ω": "\\Omega ",
  "°": "^{\\circ}",
  "→": "\\rightarrow ",
  "⇌": "\\rightleftharpoons ",
  "←": "\\leftarrow ",
  "⋅": "\\cdot ",
  "·": "\\cdot ",
  "∠": "\\angle ",
  "√": "\\surd ",
  "∈": "\\in ",
  "∪": "\\cup ",
  "∩": "\\cap ",
  "⊂": "\\subset ",
  "∅": "\\emptyset ",
  "−": "-",
};

const NARY: Record<string, string> = { "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint" };

const escapeText = (s: string) =>
  [...s].map((c) => SYMBOLS[c] ?? (/[#$%&_{}]/.test(c) ? `\\${c}` : c === "\\" ? "\\backslash " : c)).join("");

const name = (e: El) => e.localName ?? e.nodeName.replace(/^.*:/, "");
const kids = (e: El) => Array.from(e.childNodes).filter((c) => c.nodeType === 1);
const child = (e: El, n: string) => kids(e).find((c) => name(c) === n);
const attr = (e: El | undefined, n: string) => e?.getAttribute?.(`m:${n}`) ?? e?.getAttribute?.(n) ?? null;

export type OmmlResult = { latex: string; ok: boolean; unsupported: string[] };

export function ommlToLatex(root: El): OmmlResult {
  const unsupported = new Set<string>();

  const group = (e: El | undefined): string => (e ? kids(e).map(node).join("") : "");
  const braced = (e: El | undefined) => `{${group(e)}}`;

  function node(e: El): string {
    switch (name(e)) {
      case "r": {
        const t = kids(e)
          .filter((c) => name(c) === "t")
          .map((c) => c.textContent ?? "")
          .join("");
        const sty = attr(child(child(e, "rPr") ?? e, "sty"), "val");
        const text = escapeText(t);
        return sty === "p" && /^[A-Za-z]{2,}$/.test(t) ? `\\mathrm{${t}}` : text;
      }
      case "f": {
        const type = attr(child(child(e, "fPr") ?? e, "type"), "val");
        const num = group(child(e, "num"));
        const den = group(child(e, "den"));
        return type === "lin" ? `${num}/${den}` : `\\frac{${num}}{${den}}`;
      }
      case "sSup":
        return `{${group(child(e, "e"))}}^{${group(child(e, "sup"))}}`;
      case "sSub":
        return `{${group(child(e, "e"))}}_{${group(child(e, "sub"))}}`;
      case "sSubSup":
        return `{${group(child(e, "e"))}}_{${group(child(e, "sub"))}}^{${group(child(e, "sup"))}}`;
      case "sPre":
        return `{}_{${group(child(e, "sub"))}}^{${group(child(e, "sup"))}}${braced(child(e, "e"))}`;
      case "rad": {
        const deg = group(child(e, "deg"));
        const hide = attr(child(child(e, "radPr") ?? e, "degHide"), "val");
        return deg && hide !== "1" && hide !== "on" ? `\\sqrt[${deg}]{${group(child(e, "e"))}}` : `\\sqrt{${group(child(e, "e"))}}`;
      }
      case "d": {
        const pr = child(e, "dPr");
        const beg = attr(child(pr ?? e, "begChr"), "val") ?? "(";
        const end = attr(child(pr ?? e, "endChr"), "val") ?? ")";
        const sep = attr(child(pr ?? e, "sepChr"), "val") ?? ",";
        const parts = kids(e).filter((c) => name(c) === "e").map(group);
        const map = (c: string) => (c === "{" ? "\\{" : c === "}" ? "\\}" : c === "|" ? "|" : c === "" ? "." : c);
        return `\\left${map(beg)}${parts.join(sep)}\\right${map(end)}`;
      }
      case "nary": {
        const pr = child(e, "naryPr");
        const chr = attr(child(pr ?? e, "chr"), "val") ?? "∫";
        const op = NARY[chr] ?? escapeText(chr);
        const sub = group(child(e, "sub"));
        const sup = group(child(e, "sup"));
        return `${op}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""}${braced(child(e, "e"))}`;
      }
      case "func": {
        const fn = group(child(e, "fName")).replace(/\\mathrm\{(\w+)\}/, "$1");
        const known = ["sin", "cos", "tan", "log", "ln", "exp", "lim", "max", "min"];
        return `${known.includes(fn) ? `\\${fn}` : `\\operatorname{${fn}}`}{${group(child(e, "e"))}}`;
      }
      case "bar": {
        const pos = attr(child(child(e, "barPr") ?? e, "pos"), "val");
        return pos === "bot" ? `\\underline{${group(child(e, "e"))}}` : `\\overline{${group(child(e, "e"))}}`;
      }
      case "acc": {
        const chr = attr(child(child(e, "accPr") ?? e, "chr"), "val") ?? "̂";
        const cmd = chr === "̅" || chr === "¯" ? "\\bar" : chr === "⃗" || chr === "→" ? "\\vec" : chr === "̇" ? "\\dot" : "\\hat";
        return `${cmd}{${group(child(e, "e"))}}`;
      }
      case "limLow":
        return `${group(child(e, "e"))}_{${group(child(e, "lim"))}}`;
      case "limUpp":
        return `${group(child(e, "e"))}^{${group(child(e, "lim"))}}`;
      case "groupChr":
      case "box":
      case "borderBox":
      case "phant":
        return group(child(e, "e"));
      case "eqArr":
        return `\\begin{aligned}${kids(e)
          .filter((c) => name(c) === "e")
          .map(group)
          .join("\\\\")}\\end{aligned}`;
      case "m": {
        const rows = kids(e)
          .filter((c) => name(c) === "mr")
          .map((mr) =>
            kids(mr)
              .filter((c) => name(c) === "e")
              .map(group)
              .join(" & "),
          );
        return `\\begin{matrix}${rows.join("\\\\")}\\end{matrix}`;
      }
      case "oMath":
      case "e":
      case "num":
      case "den":
      case "sub":
      case "sup":
      case "deg":
      case "lim":
      case "fName":
        return group(e);
      // Property elements carry no content.
      case "rPr":
      case "ctrlPr":
      case "fPr":
      case "radPr":
      case "dPr":
      case "naryPr":
      case "funcPr":
      case "sSupPr":
      case "sSubPr":
      case "sSubSupPr":
      case "sPrePr":
      case "barPr":
      case "accPr":
      case "limLowPr":
      case "limUppPr":
      case "groupChrPr":
      case "boxPr":
      case "borderBoxPr":
      case "eqArrPr":
      case "mPr":
      case "oMathParaPr":
      case "argPr":
      case "phantPr":
        return "";
      default:
        // Word runs (w:r) can appear inside equations; keep their text.
        if (name(e) === "t") return escapeText(e.textContent ?? "");
        unsupported.add(name(e));
        return escapeText(e.textContent ?? "");
    }
  }

  const latex = (name(root) === "oMathPara" ? kids(root).filter((c) => name(c) === "oMath").map(group).join("\\\\") : group(root))
    .replace(/\s+/g, " ")
    .replace(/\{\}\^/g, "^")
    .trim();
  return { latex, ok: unsupported.size === 0 && latex.length > 0, unsupported: [...unsupported] };
}
