import { Photo } from "@/components/ui/photo";
import type { School } from "@/lib/tenant/context";

export const DEFAULT_SCHOOL_COLOR = "#1F5C3A";

/** School-branded login header: the one place a school's own colour appears in the app. */
export function SchoolBrandHeader({ school }: { school: School }) {
  const color = school.brandColor ?? DEFAULT_SCHOOL_COLOR;
  return (
    <header
      className="flex h-[92px] flex-none items-center gap-3.5 px-5 text-white sm:px-7"
      style={{ background: color }}
    >
      <Photo
        src={school.logoUrl}
        alt={`${school.name} crest`}
        className="size-[52px] rounded-full border-2 border-white"
        // Placeholder stripes in a lighter shade of the school colour.
        style={{ "--hatch": `color-mix(in srgb, ${color} 80%, white)`, "--background": color } as React.CSSProperties}
      />
      <div className="min-w-0">
        <div className="truncate text-lg font-extrabold">{school.name}</div>
        {school.motto && <div className="truncate text-[13px] opacity-90">{school.motto}</div>}
      </div>
    </header>
  );
}
