"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const TABS = [
  ["/features", "Features"],
  ["/pricing", "Pricing"],
  ["/demo", "Demo"],
] as const;

export function MarketingNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-1 px-4 sm:h-[68px] sm:gap-2 sm:px-5 lg:px-10">
        <Link href="/" aria-label="SonoCBT home" className="mr-1 flex h-11 items-center no-underline sm:mr-3">
          <Logo size={26} />
        </Link>
        <div className="hidden gap-1 md:flex">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={cn("rounded-md px-3.5 py-2 text-[15px] font-semibold text-foreground no-underline", path === href ? "bg-[#EEEBE2]" : "hover:bg-[#EEEBE2]")}>
              {label}
            </Link>
          ))}
        </div>
        <span className="flex-1" />
        <Link href="/login" className="flex h-11 items-center px-2.5 text-[15px] font-semibold whitespace-nowrap text-foreground no-underline sm:px-3">
          Sign in
        </Link>
        <Link href="/demo" className="flex h-11 items-center rounded-md bg-ink px-3.5 text-[15px] font-bold whitespace-nowrap text-white no-underline sm:px-4">
          <span className="sm:hidden">Try demo</span>
          <span className="hidden sm:inline">Try the demo school</span>
        </Link>
      </div>
      <div className="flex gap-1 overflow-x-auto px-3 pb-1.5 md:hidden">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={cn("flex h-10 items-center rounded-md px-3 text-[15px] font-semibold text-foreground no-underline", path === href && "bg-[#EEEBE2]")}>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
