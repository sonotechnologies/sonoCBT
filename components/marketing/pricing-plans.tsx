"use client";

import Link from "next/link";
import { useState } from "react";
import { PLANS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/** Plan cards with a "students in your school" slider (the design's pricing page). */
export function PricingPlans() {
  const [students, setStudents] = useState(450);
  return (
    <>
      <div className="mx-auto max-w-[1200px] px-5 lg:px-10">
        <label className="flex max-w-[520px] flex-col gap-2 rounded-xl border border-border bg-card p-5 text-[15px] font-semibold">
          <span className="flex justify-between">
            Students in your school <span className="font-mono">{students.toLocaleString("en-NG")}</span>
          </span>
          <input type="range" min={100} max={2000} step={50} value={students} onChange={(e) => setStudents(Number(e.target.value))} className="accent-[#14213D]" />
        </label>
      </div>
      <div className="mx-auto mt-6 grid max-w-[1200px] gap-4 px-5 lg:grid-cols-3 lg:px-10">
        {PLANS.map((p) => {
          const hi = p.code === "standard";
          return (
            <section key={p.code} aria-label={`${p.name} plan`} className={cn("flex flex-col gap-4 rounded-2xl border p-7", hi ? "border-ink bg-ink text-[#FAF8F3]" : "border-border bg-card")}>
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-2xl font-extrabold">{p.name}</h2>
                {hi && <span className="rounded-full bg-pencil px-2.5 py-1 text-xs font-bold text-ink">Most schools pick this</span>}
              </div>
              <p className={cn("text-[15px]", hi ? "text-white/80" : "text-ink-2")}>{p.blurb}</p>
              <div>
                <span className="font-mono text-4xl font-semibold">₦{p.naira.toLocaleString("en-NG")}</span>
                <span className="text-sm opacity-80"> / student / term</span>
              </div>
              <div className={cn("rounded-lg px-3 py-2.5 text-sm", hi ? "bg-[#1D2C4D]" : "bg-[#F4F1E8]")}>
                For {students.toLocaleString("en-NG")} students: <strong className="font-mono">₦{(p.naira * students).toLocaleString("en-NG")}</strong> per term
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-[15px]">
                {p.includes.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span aria-hidden className="font-bold text-[#1F8A4C]">
                      ✓
                    </span>
                    {it}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={cn("rounded-lg px-4 py-3 text-center font-bold no-underline", hi ? "bg-pencil text-ink" : "border-[1.5px] border-ink text-foreground")}>
                Start a free 30-day trial
              </Link>
            </section>
          );
        })}
      </div>
    </>
  );
}
