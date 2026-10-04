"use client";

import { useActionState } from "react";
import { studentSignIn } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function StudentSignInForm({ schoolSlug }: { schoolSlug: string }) {
  const [state, action, pending] = useActionState(studentSignIn.bind(null, schoolSlug), undefined);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Admission number">
        <Input
          name="admissionNo"
          mono
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          required
          defaultValue={state?.values?.admissionNo}
          aria-invalid={!!state?.error}
          className="text-[17px]"
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state?.error}
          className="text-[17px]"
        />
      </Field>
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-[52px] text-base" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
