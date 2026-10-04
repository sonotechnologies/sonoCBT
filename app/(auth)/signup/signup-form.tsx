"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signupSchool } from "@/lib/school/actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupSchool, undefined);
  const control = "h-[46px] px-3 text-[15px]";
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="School name">
        <Input name="schoolName" required autoComplete="organization" placeholder="e.g. Greenfield Academy, Lekki" defaultValue={state?.values?.schoolName} className={control} />
      </Field>
      <Field label="Your name">
        <Input name="adminName" required autoComplete="name" placeholder="e.g. Mrs. Adunni Ogundipe" defaultValue={state?.values?.adminName} className={control} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" defaultValue={state?.values?.email} className={control} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <Input name="password" type="password" required autoComplete="new-password" minLength={8} className={control} />
      </Field>
      {state?.error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating your school…" : "Start free trial"}
      </Button>
    </form>
  );
}
