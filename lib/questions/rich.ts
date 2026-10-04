/**
 * Rich content (question stems, options, passages, marking guides) is stored as
 * Tiptap JSON. The same extension list drives the editor (client) and the
 * static renderer (server), so what teachers type is exactly what students see.
 */
import { InputRule, type Extensions } from "@tiptap/core";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
// Chemistry notation: \ce{H2SO4 -> 2H+ + SO4^2-}
import "katex/contrib/mhchem";
import type { RichDoc } from "@/lib/db/schema";

export type { RichDoc };

/** `$x^2$` typed inline becomes maths (the design's convention); `$100` alone does not. */
const SINGLE_DOLLAR = /(?<![\d$\\])\$([^$\n]+?)\$(?![\d$])$/;

const InlineMathDollar = InlineMath.extend({
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      new InputRule({
        find: SINGLE_DOLLAR,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim();
          if (!latex) return null;
          const node = this.type.create({ latex });
          // Characters of the match already in the document (the rest is being typed now).
          const inDoc = range.to - range.from;
          if (inDoc >= 0) {
            state.tr.replaceWith(range.from, range.to, node);
            return;
          }
          // Fast or keyboard-committed input can deliver text before the match in the same
          // event (e.g. a whole word): insert that part, then the maths.
          const typed = match[0].length - inDoc;
          const input = match.input ?? "";
          const prefix = input.slice(input.length - typed, input.length - match[0].length);
          state.tr.insertText(prefix, range.to).insert(range.to + prefix.length, node);
        },
      }),
    ];
  },
});

export type MathClick = (kind: "inline" | "block", node: PMNode, pos: number) => void;

export function richExtensions(opts: { images?: boolean; tables?: boolean; onMathClick?: MathClick } = {}): Extensions {
  const { images = true, tables = true, onMathClick } = opts;
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      strike: false,
      link: false,
    }),
    Subscript,
    Superscript,
    InlineMathDollar.configure({
      katexOptions: { throwOnError: false },
      onClick: onMathClick ? (node, pos) => onMathClick("inline", node, pos) : undefined,
    }),
    BlockMath.configure({
      katexOptions: { throwOnError: false, displayMode: true },
      onClick: onMathClick ? (node, pos) => onMathClick("block", node, pos) : undefined,
    }),
    ...(images ? [Image.configure({ inline: false, allowBase64: false })] : []),
    ...(tables ? [TableKit.configure({ table: { resizable: false } })] : []),
  ];
}

// ─── Plain text & validation (isomorphic, pure) ─────────────────────────────

type Node = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string }[]; content?: Node[] };

export const EMPTY_DOC: RichDoc = { type: "doc", content: [{ type: "paragraph" }] };

export function textDoc(text: string): RichDoc {
  return { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }] };
}

/** Plain text: maths as `$latex$`, images as "[image]", blocks separated by newlines. */
export function docToText(doc: RichDoc | null | undefined): string {
  const out: string[] = [];
  const walk = (n: Node, block: string[]) => {
    if (n.type === "text") block.push(n.text ?? "");
    else if (n.type === "inlineMath") block.push(`$${String(n.attrs?.latex ?? "")}$`);
    else if (n.type === "blockMath") block.push(`$$${String(n.attrs?.latex ?? "")}$$`);
    else if (n.type === "image") block.push("[image]");
    else if (n.type === "hardBreak") block.push(" ");
    for (const c of n.content ?? []) walk(c, block);
  };
  for (const b of (doc?.content ?? []) as Node[]) {
    const block: string[] = [];
    walk(b, block);
    out.push(block.join(""));
  }
  return out.join("\n").replace(/[ \t]+/g, " ").trim();
}

export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  if (!doc?.content?.length) return true;
  const hasContent = (n: Node): boolean =>
    (n.type === "text" && !!n.text?.trim()) ||
    n.type === "inlineMath" ||
    n.type === "blockMath" ||
    n.type === "image" ||
    (n.content ?? []).some(hasContent);
  return !(doc.content as Node[]).some(hasContent);
}

const NODES = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "bulletList",
  "orderedList",
  "listItem",
  "inlineMath",
  "blockMath",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);
const MARKS = new Set(["bold", "italic", "underline", "subscript", "superscript"]);

/** Image URLs we accept: our own uploads (R2 public URL or dev /files/…) or https. */
export function isSafeImageSrc(src: unknown): boolean {
  if (typeof src !== "string") return false;
  return src.startsWith("/files/") || /^https:\/\/[^\s"'<>]+$/.test(src);
}

/** Rejects anything the editor can't produce (defence against hand-crafted payloads). */
export function validateDoc(doc: unknown, maxChars = 20_000): string | null {
  if (!doc || typeof doc !== "object" || (doc as Node).type !== "doc") return "Content is not a document.";
  let chars = 0;
  const check = (n: Node): string | null => {
    if (!NODES.has(n.type)) return `Unsupported content (${n.type}).`;
    for (const m of n.marks ?? []) if (!MARKS.has(m.type)) return `Unsupported formatting (${m.type}).`;
    if (n.type === "image" && !isSafeImageSrc(n.attrs?.src)) return "An image link isn't allowed. Upload the image instead.";
    if (n.type === "text") chars += n.text?.length ?? 0;
    if (n.type === "inlineMath" || n.type === "blockMath") chars += String(n.attrs?.latex ?? "").length;
    for (const c of n.content ?? []) {
      const err = check(c);
      if (err) return err;
    }
    return null;
  };
  const err = check(doc as Node);
  if (err) return err;
  if (chars > maxChars) return "This is too long.";
  return null;
}
