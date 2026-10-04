import Link from "next/link";

/** The slim strip shown everywhere inside the demo school. */
export function DemoBanner() {
  return (
    <div role="note" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-pencil px-4 py-1.5 text-center text-[13px] font-semibold text-ink print:hidden">
      <span>Demo school — data resets daily.</span>
      <Link href="/demo" className="text-ink underline">
        Try another role
      </Link>
    </div>
  );
}
