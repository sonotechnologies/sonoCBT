"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generatePinsAction } from "@/lib/results/report-card-actions";

type Made = { batch: string; termLabel: string; maxUses: number; pins: { serial: string; pin: string }[] };

export function PinGenerator({ slug, termId, termLabel }: { slug: string; termId: string; termLabel: string }) {
  const [count, setCount] = useState("40");
  const [uses, setUses] = useState("5");
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="gen-title">
      <h2 id="gen-title" className="text-lg font-extrabold">
        Make PINs for {termLabel}
      </h2>
      <p className="mt-1 text-sm text-ink-2">Each PIN opens one student&apos;s released result for this term. Print them as scratch cards or send them by SMS.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          How many
          <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="h-11 w-24 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          Views per PIN
          <input value={uses} onChange={(e) => setUses(e.target.value)} inputMode="numeric" className="h-11 w-24 rounded-md border-[1.5px] border-input bg-card px-3 text-right font-mono" />
        </label>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await generatePinsAction(slug, termId, Number(count), Number(uses));
              if (r.error || !r.data) return setError(r.error ?? "Something went wrong.");
              setMade(r.data);
            })
          }
        >
          {pending ? "Making…" : "Make PINs"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      {made && (
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-[#F3D3B5] bg-[#FDF1E6] p-4">
          <p role="status" className="text-sm font-semibold text-[#7A3B0A]">
            {made.pins.length} PINs made ({made.batch}). Download the sheet now: for safety the PINs are only shown this once and can&apos;t be printed again later.
          </p>
          <form method="post" action={`/s/${slug}/results/pins/sheet`} target="_blank" className="flex flex-wrap gap-2.5">
            <input type="hidden" name="batch" value={made.batch} />
            <input type="hidden" name="pins" value={JSON.stringify(made.pins)} />
            <Button type="submit">Download PIN sheet (PDF)</Button>
            <Button type="button" variant="outline" onClick={() => setMade(null)}>
              I&apos;ve saved it
            </Button>
          </form>
          <details>
            <summary className="cursor-pointer text-[13px] font-semibold">Show the PINs</summary>
            <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-4 gap-y-1 font-mono text-[13px]">
              {made.pins.map((p) => (
                <li key={p.serial}>
                  {p.pin} <span className="text-muted-foreground">{p.serial}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
