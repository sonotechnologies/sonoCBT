"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export type NavItem = { label: string; href: string | null; badge?: string };

function initialsOf(name: string) {
  return name
    .replace(/^(Mrs?\.|Mr\.|Dr\.|Miss)\s*/, "")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
}

export function StaffSidebar({
  schoolName,
  termLabel,
  userName,
  userRole,
  items,
}: {
  schoolName: string;
  termLabel: string;
  userName: string;
  userRole: string;
  items: NavItem[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full w-[232px] flex-col bg-ink text-paper">
      <div className="flex-none px-5 pt-[22px] pb-[18px]">
        <Logo variant="reversed" size={24} />
      </div>
      <div className="mx-3 mb-3 flex flex-none flex-col gap-0.5 rounded-md bg-ink-raised px-3 py-2.5">
        <div className="text-[13px] font-bold">{schoolName}</div>
        <div className="text-xs text-on-ink-soft">{termLabel}</div>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1 [scrollbar-color:var(--color-ink-line)_transparent] [scrollbar-width:thin]">
        {items.map((it) => {
          // "School setup" links to its first step but stays lit on every step.
          const section = it.href?.replace(/\/setup\/.*$/, "/setup");
          const on = !!section && pathname.startsWith(section);
          const inner = (
            <>
              <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-pencil" : "bg-transparent")} />
              {it.label}
              {it.badge && (
                <span className="ml-auto rounded-full bg-pencil px-[7px] py-px font-mono text-[11px] font-semibold text-ink">
                  {it.badge}
                </span>
              )}
              {!it.href && <span className="ml-auto text-[11px] font-medium text-on-ink-soft/70">Soon</span>}
            </>
          );
          const base = "flex h-10 items-center gap-2.5 rounded-md px-3 text-sm no-underline";
          return (
            <li key={it.label}>
              {it.href ? (
                <Link
                  href={it.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    base,
                    on
                      ? "bg-ink-active font-bold text-white"
                      : "font-medium text-on-ink-muted hover:bg-ink-raised hover:text-white",
                  )}
                >
                  {inner}
                </Link>
              ) : (
                <span aria-disabled className={cn(base, "font-medium text-on-ink-muted/60")}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-none items-center gap-2.5 border-t border-ink-line px-5 py-4">
        <div className="flex size-8 flex-none items-center justify-center rounded-full bg-pencil text-xs font-extrabold text-ink">
          {initialsOf(userName)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{userName}</div>
          <div className="text-xs text-on-ink-soft">{userRole}</div>
        </div>
      </div>
    </nav>
  );
}

/** Below the lg breakpoint the sidebar is hidden; this menu carries the same links. */
export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const live = items.filter((i) => i.href);
  return (
    <details className="relative lg:hidden">
      <summary className="flex h-10 cursor-pointer list-none items-center rounded-md border-[1.5px] border-input px-3 text-sm font-semibold">
        Menu
      </summary>
      <ul className="absolute left-0 z-20 mt-1 flex w-56 flex-col rounded-lg border border-border bg-card p-1 shadow-[0_4px_12px_rgba(20,33,61,.08)]">
        {live.map((it) => (
          <li key={it.label}>
            <Link
              href={it.href!}
              aria-current={pathname.startsWith(it.href!.replace(/\/setup\/.*$/, "/setup")) ? "page" : undefined}
              className="flex h-11 items-center rounded-md px-3 text-sm font-semibold no-underline hover:bg-secondary aria-[current=page]:bg-secondary"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
