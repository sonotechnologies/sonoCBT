"use client";

import katex from "katex";
import "katex/contrib/mhchem";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const SNIPPETS: { label: string; tex: string; title: string }[] = [
  { label: "a/b", tex: "\\frac{a}{b}", title: "Fraction" },
  { label: "x²", tex: "x^{2}", title: "Power" },
  { label: "x₁", tex: "x_{1}", title: "Subscript" },
  { label: "√", tex: "\\sqrt{x}", title: "Square root" },
  { label: "×", tex: "\\times", title: "Times" },
  { label: "÷", tex: "\\div", title: "Divide" },
  { label: "±", tex: "\\pm", title: "Plus or minus" },
  { label: "≤", tex: "\\le", title: "Less than or equal" },
  { label: "≥", tex: "\\ge", title: "Greater than or equal" },
  { label: "π", tex: "\\pi", title: "Pi" },
  { label: "θ", tex: "\\theta", title: "Theta" },
  { label: "°", tex: "^{\\circ}", title: "Degrees" },
  { label: "→", tex: "\\rightarrow", title: "Arrow" },
  { label: "H₂O", tex: "\\ce{H2O}", title: "Chemical formula" },
  { label: "⇌", tex: "\\ce{A <=> B}", title: "Equilibrium" },
];

/** Enter or edit a LaTeX expression, with a live preview and quick-insert symbols. */
export function MathDialog({
  open,
  initial,
  onSave,
  onRemove,
  onClose,
}: {
  open: boolean;
  initial: string;
  onSave: (latex: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState(initial);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setLatex(initial);
      d.showModal();
      setTimeout(() => input.current?.focus(), 0);
    } else if (!open && d.open) d.close();
  }, [open, initial]);

  const preview = useMemo(() => {
    if (!latex.trim()) return "";
    return katex.renderToString(latex, { throwOnError: false, displayMode: true, output: "html" });
  }, [latex]);

  const insert = (tex: string) => {
    const el = input.current;
    if (!el) return setLatex((l) => l + tex);
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const next = latex.slice(0, a) + tex + latex.slice(b);
    setLatex(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(a + tex.length, a + tex.length);
    }, 0);
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-ink/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (latex.trim()) onSave(latex.trim());
          onClose();
        }}
      >
        <h2 className="text-lg font-extrabold">Maths or chemistry</h2>
        <div className="flex flex-wrap gap-1.5">
          {SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              title={s.title}
              onClick={() => insert(s.tex)}
              className="h-9 min-w-9 rounded-md border border-input bg-card px-2 text-sm font-semibold hover:bg-secondary"
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          LaTeX
          <textarea
            ref={input}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            spellCheck={false}
            className="rounded-md border-[1.5px] border-input bg-card p-2.5 font-mono text-sm focus:border-2 focus:border-primary focus:outline-none"
            placeholder="e.g. 1.0 \times 10^{-3}   or   \ce{CaCO3}"
          />
        </label>
        <div className="min-h-14 overflow-x-auto rounded-md bg-background p-3 text-center" aria-live="polite">
          {preview ? <span dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="text-sm text-muted-foreground">Preview</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: you can also type <span className="font-mono">$x^2$</span> straight into the question.
        </p>
        <div className="flex gap-2">
          {onRemove && (
            <Button type="button" variant="outline" size="md" onClick={() => (onRemove(), onClose())}>
              Remove
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!latex.trim()}>
            Insert
          </Button>
        </div>
      </form>
    </dialog>
  );
}
