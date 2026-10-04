"use client";

import type { JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useMemo, useRef, useState } from "react";
import type { RichDoc } from "@/lib/db/schema";
import { richExtensions, type MathClick } from "@/lib/questions/rich";
import { cn } from "@/lib/utils";
import { MathDialog } from "./math-dialog";

type MathEdit = { kind: "inline" | "block"; latex: string; pos?: number } | null;

function ToolButton({
  label,
  title,
  active,
  onClick,
  className,
}: {
  label: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-[34px] items-center justify-center rounded-md px-2 text-[13px] font-bold text-foreground hover:bg-secondary",
        active && "bg-chip",
        className,
      )}
    >
      {label}
    </button>
  );
}

function Toolbar({
  editor,
  compact,
  images,
  tables,
  onMath,
  onImage,
  uploading,
}: {
  editor: Editor;
  compact: boolean;
  images: boolean;
  tables: boolean;
  onMath: () => void;
  onImage: () => void;
  uploading: boolean;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      sup: e.isActive("superscript"),
      sub: e.isActive("subscript"),
      table: e.isActive("table"),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1.5" role="toolbar" aria-label="Formatting">
      {!compact && (
        <>
          <ToolButton label="B" title="Bold" active={s.bold} onClick={() => c().toggleBold().run()} />
          <ToolButton label={<i>I</i>} title="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} />
          <ToolButton label={<u>U</u>} title="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()} />
        </>
      )}
      <ToolButton label="x²" title="Superscript" active={s.sup} onClick={() => c().toggleSuperscript().run()} />
      <ToolButton label="x₂" title="Subscript" active={s.sub} onClick={() => c().toggleSubscript().run()} />
      <ToolButton label="∑ Maths" title="Insert maths or chemistry" onClick={onMath} className="bg-chip" />
      {images && <ToolButton label={uploading ? "Uploading…" : "Image"} title="Insert image" onClick={onImage} />}
      {tables && !compact && (
        <>
          <ToolButton
            label="Table"
            title="Insert table"
            onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          />
          {s.table && (
            <>
              <ToolButton label="+Row" title="Add row" onClick={() => c().addRowAfter().run()} />
              <ToolButton label="+Col" title="Add column" onClick={() => c().addColumnAfter().run()} />
              <ToolButton label="−Row" title="Delete row" onClick={() => c().deleteRow().run()} />
              <ToolButton label="−Col" title="Delete column" onClick={() => c().deleteColumn().run()} />
              <ToolButton label="✕Table" title="Delete table" onClick={() => c().deleteTable().run()} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Tiptap editor for question stems, options, passages and marking guides.
 * `compact` is the one-line style used for options.
 */
export function RichEditor({
  value,
  onChange,
  placeholder,
  label,
  compact = false,
  images = true,
  tables = !compact,
  uploadImage,
  className,
  invalid,
}: {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  placeholder?: string;
  label: string;
  compact?: boolean;
  images?: boolean;
  tables?: boolean;
  uploadImage?: (file: File) => Promise<{ url?: string; error?: string }>;
  className?: string;
  invalid?: boolean;
}) {
  const [math, setMath] = useState<MathEdit>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const onMathClick: MathClick = (kind, node, pos) => setMath({ kind, latex: String(node.attrs.latex ?? ""), pos });

  const extensions = useMemo(
    () => [
      ...richExtensions({ images: images && !!uploadImage, tables, onMathClick }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    // Extensions must be stable for the editor's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions,
    content: value as JSONContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn("rich focus:outline-none", compact ? "min-h-[24px] text-[15px]" : "min-h-[88px] text-base"),
        "aria-label": label,
        role: "textbox",
        "aria-multiline": compact ? "false" : "true",
      },
    },
    // Plain JSON copy: Tiptap can hand back null-prototype attribute objects, which
    // React can't serialise into a server action argument.
    onUpdate: ({ editor: e }) => onChange(JSON.parse(JSON.stringify(e.getJSON())) as RichDoc),
  });

  const pickImage = async (f: File) => {
    if (!uploadImage || !editor) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", f);
    const res = await uploadImage(f);
    setUploading(false);
    if (res.url) editor.chain().focus().setImage({ src: res.url, alt: "" }).run();
    else setError(res.error ?? "Upload failed.");
  };

  return (
    <div className={className}>
      <div
        className={cn(
          "rounded-lg border-[1.5px] bg-card focus-within:border-2 focus-within:border-primary",
          invalid ? "border-destructive" : "border-input",
        )}
      >
        {editor && (
          <Toolbar
            editor={editor}
            compact={compact}
            images={images && !!uploadImage}
            tables={tables}
            uploading={uploading}
            onMath={() => setMath({ kind: "inline", latex: "" })}
            onImage={() => file.current?.click()}
          />
        )}
        <EditorContent editor={editor} className={compact ? "px-3.5 py-2.5" : "p-4"} />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickImage(f);
          e.target.value = "";
        }}
      />
      <MathDialog
        open={!!math}
        initial={math?.latex ?? ""}
        onClose={() => setMath(null)}
        onRemove={
          math?.pos !== undefined
            ? () =>
                math.kind === "inline"
                  ? editor?.chain().focus().deleteInlineMath({ pos: math.pos }).run()
                  : editor?.chain().focus().deleteBlockMath({ pos: math.pos }).run()
            : undefined
        }
        onSave={(latex) => {
          if (!editor || !math) return;
          if (math.pos !== undefined) {
            if (math.kind === "inline") editor.chain().focus().updateInlineMath({ latex, pos: math.pos }).run();
            else editor.chain().focus().updateBlockMath({ latex, pos: math.pos }).run();
          } else editor.chain().focus().insertInlineMath({ latex }).run();
        }}
      />
    </div>
  );
}
