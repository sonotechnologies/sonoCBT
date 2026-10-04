import type { JSONContent } from "@tiptap/core";
import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import katex from "katex";
import type { RichDoc } from "@/lib/db/schema";
import { isSafeImageSrc, richExtensions } from "./rich";

const extensions = richExtensions();

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Server-side HTML for a stored document, maths rendered by KaTeX. Text is
 * escaped by the renderer; images are re-checked here as well as on save.
 */
export function renderDoc(doc: RichDoc | null | undefined): string {
  if (!doc) return "";
  return renderToHTMLString({
    content: doc as JSONContent,
    extensions,
    options: {
      nodeMapping: {
        inlineMath: ({ node }) =>
          katex.renderToString(String(node.attrs.latex ?? ""), { throwOnError: false, displayMode: false, output: "html" }),
        blockMath: ({ node }) =>
          `<div class="math-block">${katex.renderToString(String(node.attrs.latex ?? ""), { throwOnError: false, displayMode: true, output: "html" })}</div>`,
        image: ({ node }) =>
          isSafeImageSrc(node.attrs.src)
            ? `<img src="${escapeAttr(String(node.attrs.src))}" alt="${escapeAttr(String(node.attrs.alt ?? ""))}" loading="lazy">`
            : "",
      },
    },
  });
}
