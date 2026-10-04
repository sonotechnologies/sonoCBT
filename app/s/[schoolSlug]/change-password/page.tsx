import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SchoolBrandHeader } from "@/components/school-header";
import { getTenantContext } from "@/lib/tenant/context";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ChangePasswordPage({ params }: PageProps<"/s/[schoolSlug]/change-password">) {
  const { schoolSlug } = await params;
  const ctx = await getTenantContext(schoolSlug);
  if (!ctx) redirect(`/s/${schoolSlug}/login`);

  return (
    <main className="flex flex-1 flex-col bg-background">
      <SchoolBrandHeader school={ctx.school} />
      <div className="flex flex-1 justify-center">
        <div className="flex w-full max-w-[520px] flex-col justify-center gap-4 px-5 py-8 sm:px-16">
          <div>
            <h1 className="text-2xl font-extrabold">Choose a new password</h1>
            <p className="mt-1 text-[15px] text-ink-2">
              {ctx.user.mustChangePassword
                ? "Your school gave you a starting password. Pick one only you know."
                : "Pick a password only you know."}
            </p>
          </div>
          <ChangePasswordForm schoolSlug={schoolSlug} />
        </div>
      </div>
    </main>
  );
}
