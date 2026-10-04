"use client";

import { useActionState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { checkResultAction } from "@/lib/results/actions";

export function CheckResultForm({
  schoolSlug,
  terms,
  defaultTermId,
}: {
  schoolSlug: string;
  terms: { id: string; label: string }[];
  defaultTermId?: string;
}) {
  const [state, action, pending] = useActionState(checkResultAction, undefined);
  return (
    <form action={action} className="flex flex-1 flex-col gap-4" noValidate>
      <input type="hidden" name="school" value={schoolSlug} />
      <Field label="Admission number">
        <Input
          name="admissionNo"
          mono
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. GFA/2021/0147"
          required
          defaultValue={state?.values?.admissionNo}
        />
      </Field>
      <Field label="Result PIN" hint="On the scratch card or SMS from the school">
        <Input
          name="pin"
          mono
          inputMode="numeric"
          autoComplete="off"
          placeholder="0000 0000 0000"
          required
          defaultValue={state?.values?.pin}
          className="text-lg tracking-[.1em]"
        />
      </Field>
      <Field label="Term">
        {/* Keyed so the choice survives React's post-action form reset (select ignores new defaultValues). */}
        <Select
          key={state?.values?.termId ?? "initial"}
          name="termId"
          required
          defaultValue={state?.values?.termId ?? defaultTermId}
          className="text-[15px]"
        >
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {state?.error && (
        <p role="alert" className="rounded-md border border-border bg-card p-3 text-sm leading-normal font-semibold text-ink-2">
          {state.error}
        </p>
      )}
      <div className="flex-1" />
      <Button type="submit" size="xl" disabled={pending} className="w-full">
        {pending ? "Checking…" : "View result"}
      </Button>
      <div className="flex justify-center">
        <Logo size={14} />
      </div>
    </form>
  );
}
