"use client";

import { useEffect, useState, useTransition } from "react";
import { buttonVariants } from "@/components/ui/button";
import { startExamAction } from "@/lib/exams/actions";
import { examPhase } from "@/lib/exams/present";
import { cn } from "@/lib/utils";
import { formatCountdown, useServerNow } from "./use-server-clock";

type Window = { start: number; end: number; serverNow: number };

export function LobbyCountdown({
  start,
  end,
  serverNow,
  labelClassName,
  digitsClassName,
}: Window & { labelClassName?: string; digitsClassName?: string }) {
  const now = useServerNow(serverNow);
  const phase = examPhase({ windowStart: new Date(start), windowEnd: new Date(end) }, new Date(now));
  const label = phase === "upcoming" ? "Starts in" : phase === "open" ? "Open now · closes in" : "Closed";
  const left = phase === "upcoming" ? (start - now) / 1000 : phase === "open" ? (end - now) / 1000 : 0;
  return (
    <>
      <div className={labelClassName}>{label}</div>
      <div
        className={cn("font-mono font-semibold tabular-nums", digitsClassName)}
        role="timer"
        aria-live="off"
        aria-label={phase === "closed" ? label : `${label} ${formatCountdown(left)}`}
      >
        {phase === "closed" ? "—" : formatCountdown(left)}
      </div>
    </>
  );
}

function deviceId(): string {
  try {
    let id = localStorage.getItem("sonocbt-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("sonocbt-device", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/**
 * Disabled until the window opens (the invigilator still says when to begin).
 * Asks for the slip's PIN when the exam uses one. Opens the exam with a full
 * page load so it can be reopened offline.
 */
export function StartExamButton({
  start,
  end,
  serverNow,
  slug,
  examId,
  pinRequired,
  waitingLabel,
  label = "Start exam",
  className,
}: Window & { slug: string; examId: string; pinRequired: boolean; waitingLabel: string; label?: string; className?: string }) {
  const now = useServerNow(serverNow);
  const phase = examPhase({ windowStart: new Date(start), windowEnd: new Date(end) }, new Date(now));
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (phase !== "open") {
    return (
      <button type="button" disabled className={cn(buttonVariants({ variant: "waiting", size: "xl" }), className)}>
        {phase === "closed" ? "This exam has closed" : waitingLabel}
      </button>
    );
  }

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await startExamAction(slug, examId, pin, deviceId());
      if ("error" in r) setError(r.error);
      else window.location.assign(r.href);
    });
  };

  return (
    <form onSubmit={go} className={cn("flex flex-col gap-2", className)}>
      {pinRequired && (
        <label className="flex flex-col gap-1.5 text-left text-[13px] font-semibold">
          Exam PIN from your slip
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.toUpperCase())}
            placeholder="e.g. 7K4Q-29XM"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            required
            aria-invalid={!!error}
            aria-describedby={error ? "start-error" : undefined}
            className="h-12 rounded-md border-[1.5px] border-input bg-card px-4 font-mono text-lg tracking-[.08em]"
          />
        </label>
      )}
      <button type="submit" disabled={pending} className={cn(buttonVariants({ variant: "pencil", size: "xl" }), "w-full")}>
        {pending ? "Opening…" : label}
      </button>
      {error && (
        <p id="start-error" role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** Once an exam is submitted, clear this student's answers and page from the (possibly shared) device. */
export function ForgetExamOnDevice({ attemptId, takeUrl }: { attemptId: string; takeUrl: string }) {
  useEffect(() => {
    try {
      const req = indexedDB.open("sonocbt-exam", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("attempts", { keyPath: "attemptId" });
      req.onsuccess = () => {
        try {
          req.result.transaction("attempts", "readwrite").objectStore("attempts").delete(attemptId);
        } catch {
          /* nothing stored */
        }
      };
    } catch {
      /* storage unavailable */
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "forget", url: new URL(takeUrl, location.href).href });
  }, [attemptId, takeUrl]);
  return null;
}
