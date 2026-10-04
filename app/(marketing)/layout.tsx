import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { MarketingNav } from "@/components/marketing/nav";
import { SITE } from "@/lib/site";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background text-foreground">
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-sm text-ink-2 lg:px-10">
          <Logo size={20} />
          <span>
            A {SITE.company} product · {SITE.city}
          </span>
          <span className="flex-1" />
          <Link href="/results">Check a result</Link>
          <Link href="/verify">Verify a report card</Link>
          <Link href="/contact">Contact</Link>
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
        </div>
      </footer>
    </div>
  );
}
