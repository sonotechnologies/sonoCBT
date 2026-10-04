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
      <div className="mx-auto flex h-[68px] max-w-[1200px] items-center gap-2 px-5 lg:px-10">
        <Link href="/" aria-label="SonoCBT home" className="mr-3 no-underline">
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
        <Link href="/login" className="px-3 py-2 text-[15px] font-semibold text-foreground no-underline">
          Sign in
        </Link>
        <Link href="/demo" className="rounded-md bg-ink px-4 py-2.5 text-[15px] font-bold whitespace-nowrap text-white no-underline">
          Try the demo school
        </Link>
      </div>
      <div className="flex gap-1 overflow-x-auto px-5 pb-2 md:hidden">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm font-semibold text-foreground no-underline", path === href && "bg-[#EEEBE2]")}>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
