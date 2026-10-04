"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordResetAction } from "@/lib/auth/actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:p-10">
      <title>Reset your password · SonoCBT</title>
      <Logo size={34} />
      <div className="mt-8 flex w-full max-w-[380px] flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
        <div>
          <h1 className="text-[22px] font-extrabold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">For staff. Students: ask your form teacher.</p>
        </div>
        {state?.sent ? (
          <p role="status" className="text-sm leading-normal text-ink-2">
            If <b className="text-foreground">{state.values?.email}</b> has a SonoCBT account, a reset link is on its way. It works
            for one hour. Check your spam folder too.
          </p>
        ) : (
          <form action={action} className="flex flex-col gap-4" noValidate>
            <Field label="Email">
              <Input name="email" type="email" autoComplete="username" required defaultValue={state?.values?.email} className="h-[46px] text-[15px]" />
            </Field>
            {state?.error && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Email me a reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="text-sm font-semibold underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
