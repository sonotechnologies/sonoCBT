"use client";

import { useState, useTransition } from "react";
import { pushScoresAction } from "@/lib/marking/actions";

/** "Send scores to the CA grid" for one exam. */
export function PushScoresButton({ slug, examId, disabledReason }: { slug: string; examId: string; disabledReason: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={pending || !!disabledReason}
        title={disabledReason ?? undefined}
        onClick={() =>
          start(async () => {
            const r = await pushScoresAction(slug, examId);
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.note ?? "Sent." });
          })
        }
        className="h-10 rounded-md border-[1.5px] border-ink bg-card px-4 text-[13px] font-bold disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send scores to the CA grid"}
      </button>
      {disabledReason && !msg && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      {msg && (
        <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "max-w-md text-right text-xs font-semibold text-success" : "max-w-md text-right text-xs font-semibold text-destructive"}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
