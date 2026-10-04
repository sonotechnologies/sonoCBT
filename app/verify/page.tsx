import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { normaliseCode } from "@/lib/results/verify";

export const metadata: Metadata = {
  title: "Verify a report card",
  description: "Check that a printed report card matches the school's records.",
};

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const { code } = await searchParams;
  const typed = typeof code === "string" ? code : "";
  const clean = typed ? normaliseCode(typed) : null;
  if (clean) redirect(`/verify/${clean}`);
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-background">
      <header className="flex h-14 flex-none items-center border-b border-border bg-card px-5">
        <Logo size={20} />
      </header>
      <form method="get" className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-3.5 px-5 py-6">
        <div>
          <h1 className="text-2xl font-extrabold">Verify a report card</h1>
          <p className="mt-1 text-[15px] leading-normal text-ink-2">Type the code printed beside the QR code, or scan the QR code with your phone.</p>
        </div>
        <Field label="Verification code" error={typed && !clean ? "That code doesn't look right. It looks like GFA-7Q2M-K9XD." : undefined}>
          <Input name="code" mono autoCapitalize="characters" spellCheck={false} autoComplete="off" placeholder="GFA-7Q2M-K9XD" defaultValue={typed} required />
        </Field>
        <Button type="submit" className="mt-1 h-[52px] text-base">
          Verify
        </Button>
      </form>
    </main>
  );
}
