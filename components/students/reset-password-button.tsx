"use client";

import { useState, useTransition } from "react";
import { resetStudentPasswordAction } from "@/lib/students/actions";

/** Resets a student's password and shows the new starting password once. */
export function ResetPasswordButton({ slug, studentId, name }: { slug: string; studentId: string; name: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ password?: string; error?: string } | null>(null);

  if (result?.password) {
    return (
      <span className="flex items-center justify-end gap-2 text-[13px]">
        New password <b className="rounded-md bg-chip px-2 py-0.5 font-mono text-sm tracking-wider">{result.password}</b>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-end gap-2">
      {result?.error && <span className="text-xs font-semibold text-destructive">{result.error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Give ${name} a new starting password? Their old password stops working and they'll be signed out.`)) {
            start(async () => setResult(await resetStudentPasswordAction(slug, studentId)));
          }
        }}
        className="h-9 rounded-md px-2 text-[13px] font-semibold text-ink-2 underline disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Reset password"}
      </button>
    </span>
  );
}
