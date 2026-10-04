import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Start a free trial",
  description: "Set up SonoCBT for your school: 30 days free, no card needed.",
};

export default function SignupPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:p-10">
      <Logo size={34} />
      <div className="mt-8 flex w-full max-w-[420px] flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
        <div>
          <h1 className="text-[22px] font-extrabold">Set up your school</h1>
          <p className="mt-1 text-sm text-muted-foreground">30 days free. No card needed. You&apos;ll be the school admin.</p>
        </div>
        <SignupForm />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Already using SonoCBT?{" "}
        <Link href="/login" className="font-semibold text-foreground underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
