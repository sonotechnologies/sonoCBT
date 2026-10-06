import type { Metadata } from "next";
import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install";
import { Logo } from "@/components/brand/logo";
import { StaffSignInForm } from "./staff-sign-in-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function StaffLoginPage({ searchParams }: PageProps<"/login">) {
  const { reset } = await searchParams;
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-4 py-10 sm:p-10">
      <Logo size={34} />
      <div className="mt-8 flex w-full max-w-[380px] flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:p-8">
        <div>
          <h1 className="text-[22px] font-extrabold">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Admins, exam officers and teachers</p>
        </div>
        {reset && (
          <p role="status" className="rounded-md bg-[#E8F4EC] p-3 text-sm font-semibold text-[#155E34]">
            Password saved. Sign in with your new password.
          </p>
        )}
        <StaffSignInForm />
      </div>
      <InstallAppButton className="mx-auto mt-4" />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Student? Use the sign-in link from your school.
        <br />
        New to SonoCBT?{" "}
        <Link href="/signup" className="font-semibold text-foreground underline">
          Set up your school
        </Link>
      </p>
    </main>
  );
}
