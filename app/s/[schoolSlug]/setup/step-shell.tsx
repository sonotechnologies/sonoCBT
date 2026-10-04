"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/actions";
import { nextStep, prevStep, WIZARD_STEPS, type WizardStep } from "@/lib/school/wizard";
import { cn } from "@/lib/utils";

function Heading({ step }: { step: WizardStep }) {
  const meta = WIZARD_STEPS.find((s) => s.slug === step)!;
  return (
    <>
      <h1 className="text-[26px] font-extrabold lg:text-[30px]">{meta.heading}</h1>
      <p className="mt-2 mb-8 text-base leading-normal text-ink-2">{meta.lead}</p>
    </>
  );
}

function Footer({
  base,
  step,
  primary,
  error,
}: {
  base: string;
  step: WizardStep;
  primary: React.ReactNode;
  error?: string;
}) {
  const back = prevStep(step);
  const next = nextStep(step);
  return (
    <div className="mt-8 flex w-full max-w-[720px] flex-col gap-3 border-t border-border pt-8">
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {back ? (
          <Link href={`${base}/${back}`} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-[15px]")}>
            Back
          </Link>
        ) : (
          <span aria-hidden className={cn(buttonVariants({ variant: "outline", size: "lg" }), "pointer-events-none text-[15px] opacity-40")}>
            Back
          </span>
        )}
        <span className="flex-1" />
        {next && (
          <Link href={`${base}/${next}`} className="h-12 px-3.5 text-sm leading-[48px] font-semibold text-ink-2 underline">
            Do this later
          </Link>
        )}
        {primary}
      </div>
    </div>
  );
}

/** A wizard step whose Continue button submits a form (saves, then moves on). */
export function StepForm({
  base,
  step,
  action,
  children,
  submitLabel = "Continue",
}: {
  base: string;
  step: WizardStep;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-1 flex-col" noValidate>
      <div className="w-full max-w-[720px] flex-1">
        <Heading step={step} />
        {children}
      </div>
      <Footer
        base={base}
        step={step}
        error={state?.error}
        primary={
          <button type="submit" disabled={pending} className={cn(buttonVariants({ size: "lg" }), "px-[22px] text-[15px]")}>
            {pending ? "Saving…" : submitLabel}
          </button>
        }
      />
    </form>
  );
}

/** A wizard step that works in place (invites, imports); Continue just moves on. */
export function StepPage({
  base,
  step,
  children,
  primary,
}: {
  base: string;
  step: WizardStep;
  children: React.ReactNode;
  primary?: React.ReactNode;
}) {
  const next = nextStep(step);
  return (
    <div className="flex flex-1 flex-col">
      <div className="w-full max-w-[720px] flex-1">
        <Heading step={step} />
        {children}
      </div>
      <Footer
        base={base}
        step={step}
        primary={
          primary ??
          (next && (
            <Link href={`${base}/${next}`} className={cn(buttonVariants({ size: "lg" }), "px-[22px] text-[15px]")}>
              Continue
            </Link>
          ))
        }
      />
    </div>
  );
}
