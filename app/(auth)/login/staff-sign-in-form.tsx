"use client";

import Link from "next/link";
import { useActionState } from "react";
import { staffSignIn } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function StaffSignInForm() {
  const [state, action, pending] = useActionState(staffSignIn, undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state?.values?.email}
          aria-invalid={!!state?.error}
          className="h-[46px] px-3 text-[15px]"
        />
      </Field>
      <Field
        label={
          <>
            Password
            <Link href="/forgot-password" className="font-semibold underline-offset-2 hover:underline">
              Forgot?
            </Link>
          </>
        }
      >
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state?.error}
          className="h-[46px] px-3 text-[15px]"
        />
      </Field>
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
