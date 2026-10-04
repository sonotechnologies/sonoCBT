import { describe, expect, it } from "vitest";
import type { RichDoc } from "@/lib/db/schema";
import { renderDoc } from "./render";
import { docToText, isEmptyDoc, textDoc, validateDoc } from "./rich";

const doc = (content: unknown[]): RichDoc => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });

const phQuestion = doc([
  p(
    { type: "text", text: "What is the pH of a solution whose [H" },
    { type: "text", text: "+", marks: [{ type: "superscript" }] },
    { type: "text", text: "] is " },
    { type: "inlineMath", attrs: { latex: "1.0 \\times 10^{-3}" } },
    { type: "text", text: "?" },
  ),
]);

describe("docToText", () => {
  it("keeps maths as LaTeX for search and duplicate checks", () => {
    expect(docToText(phQuestion)).toBe("What is the pH of a solution whose [H+] is $1.0 \\times 10^{-3}$?");
  });
});

describe("isEmptyDoc", () => {
  it("treats whitespace as empty but maths or images as content", () => {
    expect(isEmptyDoc(textDoc("  "))).toBe(true);
    expect(isEmptyDoc(doc([p({ type: "inlineMath", attrs: { latex: "x" } })]))).toBe(false);
    expect(isEmptyDoc(doc([{ type: "image", attrs: { src: "/files/a.png" } }]))).toBe(false);
  });
});

describe("validateDoc", () => {
  it("accepts what the editor produces", () => {
    expect(validateDoc(phQuestion)).toBeNull();
  });
  it("rejects unknown nodes, marks and unsafe images", () => {
    expect(validateDoc(doc([{ type: "iframe" }]))).toMatch(/Unsupported/);
    expect(validateDoc(doc([p({ type: "text", text: "x", marks: [{ type: "link" }] })]))).toMatch(/Unsupported/);
    expect(validateDoc(doc([{ type: "image", attrs: { src: "javascript:alert(1)" } }]))).toMatch(/image/);
    expect(validateDoc(doc([{ type: "image", attrs: { src: "http://evil.test/x.png" } }]))).toMatch(/image/);
  });
});

describe("renderDoc", () => {
  it("renders maths with KaTeX and escapes text", () => {
    const html = renderDoc(doc([p({ type: "text", text: "<script>x</script> and " }, { type: "inlineMath", attrs: { latex: "x^2" } })]));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="katex"');
  });
  it("renders superscripts and tables", () => {
    const html = renderDoc(
      doc([
        p({ type: "text", text: "2", marks: [{ type: "superscript" }] }),
        {
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p({ type: "text", text: "cell" })] }] }],
        },
      ]),
    );
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<table");
    expect(html).toContain("cell");
  });
  it("drops unsafe images even if they got into storage", () => {
    expect(renderDoc(doc([{ type: "image", attrs: { src: "javascript:alert(1)" } }]))).not.toContain("javascript");
  });
});
