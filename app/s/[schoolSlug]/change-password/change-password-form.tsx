"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function ChangePasswordForm({ schoolSlug }: { schoolSlug: string }) {
  const [state, action, pending] = useActionState(changePassword.bind(null, schoolSlug), undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Current password">
        <Input name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Type the new password again">
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-[52px] text-base" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
