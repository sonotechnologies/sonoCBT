"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type SidebarProps = {
  schoolName: string;
  termLabel: string;
  userName: string;
  userRole: string;
  items: NavItem[];
};

export function StaffSidebar({ schoolName, termLabel, userName, userRole, items, onClose, className }: SidebarProps & { onClose?: () => void; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("flex h-full w-[232px] flex-col bg-ink text-paper", className)}>
      <div className="flex flex-none items-center justify-between px-5 pt-[22px] pb-[18px]">
        <Logo variant="reversed" size={24} />
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close menu" className="-mr-2 flex size-11 items-center justify-center rounded-md text-2xl leading-none text-on-ink-muted hover:bg-ink-raised hover:text-white">
            ×
          </button>
        )}
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
          const base = "flex h-11 items-center lg:h-10 gap-2.5 rounded-md px-3 text-sm no-underline";
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

/** Below the lg breakpoint the sidebar is hidden; a menu button opens it as a drawer. */
export function MobileNav(props: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(pathname);
  const button = useRef<HTMLButtonElement>(null);
  // Close after navigating.
  if (at !== pathname) {
    setAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const btn = button.current;
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      btn?.focus();
    };
  }, [open]);
  const badge = props.items.some((i) => i.badge);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label="Open menu" className="relative -ml-2 flex size-11 items-center justify-center rounded-md hover:bg-secondary lg:hidden">
        <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h16M3 11h16M3 16h16" />
        </svg>
        {badge && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-pencil ring-2 ring-card" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/50 [animation:fade-in_.18s_ease-out]" />
          <div className="absolute inset-y-0 left-0 w-[min(300px,85vw)] shadow-[0_0_40px_rgba(0,0,0,.3)] [animation:slide-in_.18s_ease-out]">
            <StaffSidebar {...props} onClose={() => setOpen(false)} className="w-full" />
          </div>
        </div>
      )}
    </>
  );
}
