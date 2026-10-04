import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { signOut } from "@/lib/auth/actions";
import { requirePlatformOwner } from "@/lib/platform/context";

export const metadata: Metadata = { title: { template: "%s · SonoCBT platform", default: "Platform" }, robots: { index: false } };

export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const owner = await requirePlatformOwner();
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-14 flex-none items-center gap-4 bg-ink px-4 text-white lg:px-8">
        <Link href="/platform" className="text-white no-underline">
          <Logo size={20} variant="reversed" />
        </Link>
        <span className="rounded bg-white/15 px-2 py-0.5 text-xs font-bold tracking-wide">PLATFORM</span>
        <span className="flex-1" />
        <span className="hidden text-sm sm:inline">{owner.name}</span>
        <form action={signOut.bind(null, "/login")}>
          <button type="submit" className="h-9 rounded-md px-3 text-sm font-semibold text-white hover:bg-white/10">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
