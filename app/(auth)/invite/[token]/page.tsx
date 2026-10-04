import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { acceptInviteAction } from "@/lib/auth/actions";
import { getDb } from "@/lib/db";
import { findInvite } from "@/lib/staff/invites";

export const metadata: Metadata = { title: "Join your school", robots: { index: false } };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const found = await findInvite(getDb(), token);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:p-10">
      <Logo size={34} />
      <div className="mt-8 flex w-full max-w-[400px] flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
        {found ? (
          <>
            <div>
              <h1 className="text-[22px] font-extrabold">Join {found.schoolName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Hello {found.invite.name}. Choose a password for <b className="text-foreground">{found.invite.email}</b>.
              </p>
            </div>
            <NewPasswordForm action={acceptInviteAction} token={token} submitLabel="Join and sign in" email={found.invite.email} />
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-extrabold">This invite link has expired</h1>
            <p className="text-sm text-ink-2">
              It may have been used already, or replaced by a newer invite. Ask your school admin to send you a fresh one.
            </p>
            <Link href="/login" className="text-sm font-semibold underline">
              Already joined? Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
