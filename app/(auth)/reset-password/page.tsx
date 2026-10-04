import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { resetPasswordAction } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token && !error;
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:p-10">
      <Logo size={34} />
      <div className="mt-8 flex w-full max-w-[380px] flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
        {valid ? (
          <>
            <h1 className="text-[22px] font-extrabold">Choose a new password</h1>
            <NewPasswordForm action={resetPasswordAction} token={token} submitLabel="Save password" />
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-extrabold">This reset link has expired</h1>
            <p className="text-sm text-ink-2">Reset links work once, for one hour.</p>
            <Link href="/forgot-password" className="text-sm font-semibold underline">
              Get a new link
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
