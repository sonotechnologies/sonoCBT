"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** A labelled dropdown that changes one search parameter (exam, term, subject) straight away. */
export function Picker({ name, label, value, options, reset = [] }: { name: string; label: string; value: string; options: { id: string; label: string }[]; reset?: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex w-full min-w-0 items-center gap-2 text-[13px] font-semibold text-ink-2 sm:w-auto">
      {label}
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set(name, e.target.value);
          for (const r of reset) next.delete(r);
          router.push(`${path}?${next}`);
        }}
        className="h-11 min-w-0 flex-1 rounded-md border-[1.5px] border-input bg-card px-2.5 text-sm font-semibold text-foreground sm:h-10 sm:max-w-[320px] sm:flex-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Download CSV" for one table. */
export function CsvLink({ href, label = "CSV" }: { href: string; label?: string }) {
  return (
    <a href={href} className="inline-flex h-10 items-center rounded-md border-[1.5px] sm:h-8 border-input bg-card px-2.5 text-xs font-bold text-foreground no-underline hover:border-ink" download>
      ↓ {label}
    </a>
  );
}
