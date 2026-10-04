/**
 * Reads a .docx into blocks of formatted runs for the question parser, plus the
 * original as HTML for the review screen.
 *
 * Before mammoth sees the file we rewrite the XML:
 *  - Word's automatic list numbering ("1.", "(a)") is turned into real text, so
 *    auto-numbered and typed-numbered papers parse the same way;
 *  - equations (OMML), which mammoth drops, become placeholder text carrying LaTeX.
 */
import { DOMParser, XMLSerializer, type Document as XDoc, type Element as XElement } from "@xmldom/xmldom";
import JSZip from "jszip";
import katex from "katex";
import mammoth from "mammoth";
import type { Run } from "./items";
import { ommlToLatex } from "./omml";

/** `origin`: index of the top-level element (paragraph/table) in the original, for highlighting. */
export type Block = ({ kind: "para"; runs: Run[] } | { kind: "table"; rows: Run[][][] }) & { origin?: number };

export type DocxResult = { blocks: Block[]; html: string; equations: { latex: string; ok: boolean }[] };

export class DocxError extends Error {}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

// ─── Numbering ───────────────────────────────────────────────────────────────

type Level = { fmt: string; text: string; start: number };

function roman(n: number): string {
  const map: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function letters(n: number): string {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(97 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return letters(n);
    case "upperLetter":
      return letters(n).toUpperCase();
    case "lowerRoman":
      return roman(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "decimalZero":
      return String(n).padStart(2, "0");
    case "bullet":
    case "none":
      return "";
    default:
      return String(n);
  }
}

type XEl = XElement;
const els = (parent: XDoc | XEl, ns: string, local: string) => Array.from(parent.getElementsByTagNameNS(ns, local));
const first = (parent: XEl, ns: string, local: string) => parent.getElementsByTagNameNS(ns, local)[0] as XEl | undefined;
const wval = (e: XEl | undefined) => e?.getAttributeNS(W, "val") ?? e?.getAttribute("w:val") ?? null;

function readNumbering(xml: string | null) {
  const nums = new Map<string, { levels: Map<number, Level>; overrides: Map<number, number> }>();
  if (!xml) return nums;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const abstracts = new Map<string, Map<number, Level>>();
  for (const a of els(doc, W, "abstractNum")) {
    const levels = new Map<number, Level>();
    for (const l of Array.from(a.getElementsByTagNameNS(W, "lvl"))) {
      levels.set(Number(l.getAttributeNS(W, "ilvl") ?? l.getAttribute("w:ilvl") ?? 0), {
        fmt: wval(first(l, W, "numFmt")) ?? "decimal",
        text: wval(first(l, W, "lvlText")) ?? "%1.",
        start: Number(wval(first(l, W, "start")) ?? 1),
      });
    }
    abstracts.set(a.getAttributeNS(W, "abstractNumId") ?? a.getAttribute("w:abstractNumId") ?? "", levels);
  }
  for (const n of els(doc, W, "num")) {
    const id = n.getAttributeNS(W, "numId") ?? n.getAttribute("w:numId") ?? "";
    const abs = wval(first(n, W, "abstractNumId")) ?? "";
    const overrides = new Map<number, number>();
    for (const o of Array.from(n.getElementsByTagNameNS(W, "lvlOverride"))) {
      const so = wval(first(o, W, "startOverride"));
      if (so) overrides.set(Number(o.getAttributeNS(W, "ilvl") ?? o.getAttribute("w:ilvl") ?? 0), Number(so));
    }
    nums.set(id, { levels: abstracts.get(abs) ?? new Map(), overrides });
  }
  return nums;
}

function readStyleNumbering(xml: string | null) {
  const map = new Map<string, { numId: string; ilvl: number }>();
  if (!xml) return map;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const s of els(doc, W, "style")) {
    const numPr = first(s, W, "numPr");
    if (!numPr) continue;
    const numId = wval(first(numPr, W, "numId"));
    if (numId) map.set(s.getAttributeNS(W, "styleId") ?? s.getAttribute("w:styleId") ?? "", { numId, ilvl: Number(wval(first(numPr, W, "ilvl")) ?? 0) });
  }
  return map;
}

/** Writes each numbered paragraph's label ("12.", "(b)") into its text and removes the list. */
function materialiseNumbering(doc: XDoc, numberingXml: string | null, stylesXml: string | null) {
  const nums = readNumbering(numberingXml);
  const styleNums = readStyleNumbering(stylesXml);
  const counters = new Map<string, number[]>();
  for (const p of els(doc, W, "p")) {
    const pPr = Array.from(p.childNodes).find((c) => (c as XEl).localName === "pPr") as XEl | undefined;
    const numPr = pPr ? (Array.from(pPr.childNodes).find((c) => (c as XEl).localName === "numPr") as XEl | undefined) : undefined;
    let numId = numPr ? wval(first(numPr, W, "numId")) : null;
    let ilvl = numPr ? Number(wval(first(numPr, W, "ilvl")) ?? 0) : 0;
    if (!numPr) {
      const style = pPr ? wval(first(pPr, W, "pStyle")) : null;
      const sn = style ? styleNums.get(style) : undefined;
      if (!sn) continue;
      numId = sn.numId;
      ilvl = sn.ilvl;
    }
    if (!numId || numId === "0") continue;
    const def = nums.get(numId);
    const level = def?.levels.get(ilvl);
    if (!def || !level) continue;

    const c = counters.get(numId) ?? [];
    const start = (l: number) => def.overrides.get(l) ?? def.levels.get(l)?.start ?? 1;
    c[ilvl] = c[ilvl] === undefined ? start(ilvl) : c[ilvl] + 1;
    for (let l = ilvl + 1; l < c.length; l++) c[l] = undefined as unknown as number;
    counters.set(numId, c);

    const label = level.text.replace(/%(\d)/g, (_, k: string) => {
      const l = Number(k) - 1;
      return formatNumber(c[l] ?? start(l), def.levels.get(l)?.fmt ?? "decimal");
    });
    if (numPr) numPr.parentNode?.removeChild(numPr);
    if (!label.trim() || level.fmt === "bullet") continue;
    const r = doc.createElementNS(W, "w:r");
    const t = doc.createElementNS(W, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(doc.createTextNode(`${label} `));
    r.appendChild(t);
    p.insertBefore(r, pPr ? pPr.nextSibling : p.firstChild);
  }
}

// ─── Equations ───────────────────────────────────────────────────────────────

const MATH_TOKEN = /⟦M(X?):(\d+)⟧/g;

function replaceEquations(doc: XDoc): { latex: string; ok: boolean }[] {
  const found: { latex: string; ok: boolean }[] = [];
  const tops = [...els(doc, M, "oMathPara"), ...els(doc, M, "oMath").filter((e) => (e.parentNode as XEl | null)?.localName !== "oMathPara")];
  for (const eq of tops) {
    if (!eq.parentNode) continue;
    const res = ommlToLatex(eq as never);
    const i = found.push({ latex: res.latex, ok: res.ok }) - 1;
    const r = doc.createElementNS(W, "w:r");
    const t = doc.createElementNS(W, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.appendChild(doc.createTextNode(`⟦M${res.ok ? "" : "X"}:${i}⟧`));
    r.appendChild(t);
    eq.parentNode.replaceChild(r, eq);
  }
  return found;
}

// ─── mammoth document → blocks ───────────────────────────────────────────────

type MNode = {
  type: string;
  children?: MNode[];
  value?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  highlight?: string | null;
  verticalAlignment?: string;
  altText?: string;
  readAsBuffer?: () => Promise<Buffer>;
  contentType?: string;
};

export type ImageUploader = (bytes: Uint8Array, contentType: string) => Promise<string>;

export async function readDocx(buffer: Buffer | Uint8Array, upload: ImageUploader): Promise<DocxResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new DocxError("That doesn't look like a Word (.docx) file. If it's an old .doc file, open it in Word and choose Save As → Word Document (.docx).");
  }
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new DocxError("That Word file seems to be damaged. Try saving it again as .docx.");

  const doc = new DOMParser().parseFromString(await docFile.async("string"), "text/xml");
  materialiseNumbering(doc, (await zip.file("word/numbering.xml")?.async("string")) ?? null, (await zip.file("word/styles.xml")?.async("string")) ?? null);
  const equations = replaceEquations(doc);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  const rewritten = await zip.generateAsync({ type: "nodebuffer" });

  // One upload per image, shared by the blocks and the HTML.
  const uploads = new Map<unknown, Promise<string>>();
  const urlFor = (img: MNode) => {
    let p = uploads.get(img);
    if (!p) {
      p = img.readAsBuffer!().then((b) => upload(new Uint8Array(b), img.contentType ?? "image/png"));
      uploads.set(img, p);
    }
    return p;
  };

  let captured: MNode | null = null;
  const { value: rawHtml } = await mammoth.convertToHtml(
    { buffer: rewritten },
    {
      transformDocument: (d: unknown) => {
        captured = d as MNode;
        return d;
      },
      convertImage: mammoth.images.imgElement(async (img: unknown) => ({ src: await urlFor(img as MNode) })),
      styleMap: ["u => u"],
      // Keep empty paragraphs so the HTML's top-level elements line up with `origin`.
      ignoreEmptyParagraphs: false,
    },
  );

  const blocks: Block[] = [];
  const paraRuns = async (p: MNode): Promise<Run[]> => {
    const runs: Run[] = [];
    const walk = async (n: MNode, fmt: Omit<Run, "text">) => {
      if (n.type === "run") {
        const f: Omit<Run, "text"> = {
          bold: !!n.isBold,
          italic: !!n.isItalic,
          underline: !!n.isUnderline,
          highlight: !!n.highlight && n.highlight !== "none",
          sup: n.verticalAlignment === "superscript",
          sub: n.verticalAlignment === "subscript",
        };
        for (const c of n.children ?? []) await walk(c, f);
      } else if (n.type === "text") {
        pushText(runs, n.value ?? "", fmt, equations);
      } else if (n.type === "tab") runs.push({ text: " ", ...fmt });
      else if (n.type === "break") runs.push({ text: "\n", ...fmt });
      else if (n.type === "image") runs.push({ text: "", image: { src: await urlFor(n), alt: n.altText ?? "" } });
      else for (const c of n.children ?? []) await walk(c, fmt);
    };
    for (const c of p.children ?? []) await walk(c, {});
    return runs;
  };

  let origin = -1;
  const walkBody = async (nodes: MNode[], top = true) => {
    for (const n of nodes) {
      if (top && (n.type === "paragraph" || n.type === "table")) origin++;
      if (n.type === "paragraph") {
        // Soft line breaks inside a paragraph start new lines (common in pasted papers).
        const runs = await paraRuns(n);
        let line: Run[] = [];
        for (const r of runs) {
          if (r.text.includes("\n") && !r.math && !r.image) {
            const parts = r.text.split("\n");
            parts.forEach((part, i) => {
              if (part) line.push({ ...r, text: part });
              if (i < parts.length - 1) {
                blocks.push({ kind: "para", runs: line, origin });
                line = [];
              }
            });
          } else line.push(r);
        }
        blocks.push({ kind: "para", runs: line, origin });
      } else if (n.type === "table") {
        const rows: Run[][][] = [];
        for (const row of n.children ?? []) {
          const cells: Run[][] = [];
          for (const cell of row.children ?? []) {
            const cellRuns: Run[] = [];
            for (const p of cell.children ?? []) {
              if (p.type !== "paragraph") continue;
              if (cellRuns.length) cellRuns.push({ text: "\n" });
              cellRuns.push(...(await paraRuns(p)));
            }
            cells.push(cellRuns);
          }
          rows.push(cells);
        }
        blocks.push({ kind: "table", rows, origin });
      } else if (n.children) await walkBody(n.children, false);
    }
  };
  await walkBody((captured as MNode | null)?.children ?? []);

  // Show equations in the original view.
  const html = rawHtml.replace(MATH_TOKEN, (_, bad: string, i: string) => {
    const eq = equations[Number(i)];
    if (!eq) return "";
    const rendered = katex.renderToString(eq.latex, { throwOnError: false, output: "html" });
    return bad ? `<span class="eq-review" title="Equation needs review">${rendered}</span>` : rendered;
  });

  return { blocks, html, equations };
}

function pushText(runs: Run[], text: string, fmt: Omit<Run, "text">, equations: { latex: string; ok: boolean }[]) {
  let last = 0;
  for (const m of text.matchAll(MATH_TOKEN)) {
    if (m.index! > last) runs.push({ text: text.slice(last, m.index), ...fmt });
    const eq = equations[Number(m[2])];
    if (eq) runs.push({ text: "", math: { latex: eq.latex, ok: eq.ok && !m[1] } });
    last = m.index! + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), ...fmt });
}
