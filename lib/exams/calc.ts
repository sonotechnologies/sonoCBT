/**
 * The on-screen calculator's arithmetic: a small parser (no eval). Supports
 * + − × ÷ ^, brackets, %, √, sin/cos/tan in degrees, log, ln, π and e.
 */

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "fn"; v: string } | { t: "(" } | { t: ")" };

const WORDS = ["sqrt", "sin", "cos", "tan", "log", "ln", "pi", "e"];

function tokenize(src: string): Tok[] | null {
  const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/√/g, "sqrt").replace(/π/g, "pi").replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if (/[a-z]/.test(c)) {
      // Spaces are gone, so "ln e" arrives as "lne": match known names from the front.
      const w = WORDS.find((x) => s.startsWith(x, i));
      if (!w) return null;
      if (w === "pi") out.push({ t: "num", v: Math.PI });
      else if (w === "e") out.push({ t: "num", v: Math.E });
      else out.push({ t: "fn", v: w });
      i += w.length;
      continue;
    }
    if ("+-*/^%".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else return null;
    i++;
  }
  return out;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Recursive descent: expr → term (± term)*, term → factor (×÷ factor)*, factor → unary (^ factor)?. */
export function evaluate(src: string): number | null {
  const parsed = tokenize(src);
  if (!parsed || !parsed.length) return null;
  const toks: Tok[] = parsed;
  let p = 0;
  const peek = () => toks[p];

  function expr(): number {
    let v = term();
    while (peek()?.t === "op" && ((peek() as { v: string }).v === "+" || (peek() as { v: string }).v === "-")) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = factor();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        p++;
        const r = factor();
        v = t.v === "*" ? v * r : v / r;
      } else if (t && (t.t === "num" || t.t === "(" || t.t === "fn")) {
        v = v * factor(); // implicit multiplication: 2π, 3(4+1)
      } else return v;
    }
  }
  function factor(): number {
    const base = unary();
    if (peek()?.t === "op" && (peek() as { v: string }).v === "^") {
      p++;
      return Math.pow(base, factor());
    }
    return base;
  }
  function unary(): number {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      p++;
      const v = unary();
      return t.v === "-" ? -v : v;
    }
    return postfix(primary());
  }
  function postfix(v: number): number {
    while (peek()?.t === "op" && (peek() as { v: string }).v === "%") {
      p++;
      v = v / 100;
    }
    return v;
  }
  function primary(): number {
    const t = toks[p++];
    if (!t) throw new Error("end");
    if (t.t === "num") return t.v;
    if (t.t === "(") {
      const v = expr();
      if (toks[p++]?.t !== ")") throw new Error("bracket");
      return v;
    }
    if (t.t === "fn") {
      const arg = unary();
      switch (t.v) {
        case "sqrt":
          return Math.sqrt(arg);
        case "sin":
          return Math.sin(rad(arg));
        case "cos":
          return Math.cos(rad(arg));
        case "tan":
          return Math.tan(rad(arg));
        case "log":
          return Math.log10(arg);
        case "ln":
          return Math.log(arg);
      }
    }
    throw new Error("unexpected");
  }

  try {
    const v = expr();
    if (p !== toks.length || !Number.isFinite(v)) return null;
    // Tidy float noise: sin 30 → 0.5, 0.1 + 0.2 → 0.3
    return Number(v.toPrecision(12));
  } catch {
    return null;
  }
}

/** For the display: up to 10 significant figures, no trailing zeros. */
export function formatResult(v: number): string {
  if (Math.abs(v) >= 1e12 || (v !== 0 && Math.abs(v) < 1e-9)) return v.toExponential(6).replace(/\.?0+e/, "e");
  return String(Number(v.toPrecision(10)));
}
