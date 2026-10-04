"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { FormState } from "@/lib/auth/actions";

/** Choose-a-password form shared by invite acceptance and password reset. */
export function NewPasswordForm({
  action,
  token,
  submitLabel,
  email,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  token: string;
  submitLabel: string;
  email?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the right username. */}
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <Field label="New password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} className="h-[46px] text-[15px]" />
      </Field>
      <Field label="Type it again">
        <Input name="confirm" type="password" autoComplete="new-password" required className="h-[46px] text-[15px]" />
      </Field>
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
