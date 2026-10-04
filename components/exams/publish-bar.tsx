"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { deleteDraftAction, publishAction, unpublishAction } from "@/lib/exams/builder-actions";
import { cn } from "@/lib/utils";

export function PublishBar({ slug, examId, status, issues, pinRequired }: { slug: string; examId: string; status: string; issues: string[]; pinRequired: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (status !== "draft") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {done && (
          <p role="status" className="mr-auto rounded-md bg-[#E8F4EC] px-3 py-2.5 text-sm font-semibold text-[#155E34]">
            {done}
          </p>
        )}
        {error && (
          <span role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            confirm("Unpublish this exam? Students won't see it until you publish again. Any PINs will change.") &&
            start(async () => {
              const r = await unpublishAction(slug, examId);
              if (r.error) setError(r.error);
              router.refresh();
            })
          }
        >
          Unpublish to edit
        </Button>
        <Link href={`/s/${slug}/exams/${examId}/slips`} className={cn(buttonVariants({ variant: "pencil" }))}>
          Exam slips{pinRequired ? " & PINs" : ""}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {issues.length > 0 && (
        <ul className="rounded-[10px] border border-[#F3D3B5] bg-[#FDF1E6] px-5 py-3.5 text-sm text-[#7A3B0A]">
          {issues.map((i) => (
            <li key={i} className="list-disc pl-1 marker:text-warning">
              {i}
            </li>
          ))}
        </ul>
      )}
      {done && (
        <p role="status" className="rounded-md bg-[#E8F4EC] p-3 text-sm font-semibold text-[#155E34]">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            confirm("Delete this draft? This can't be undone. The questions stay in the bank.") &&
            start(async () => {
              const r = await deleteDraftAction(slug, examId);
              if (r.error) setError(r.error);
              else router.push(`/s/${slug}/exams`);
            })
          }
        >
          Delete draft
        </Button>
        <Button
          type="button"
          variant="pencil"
          disabled={pending || issues.length > 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await publishAction(slug, examId);
              if (r.error) setError(r.error);
              else setDone(`Published: ${r.questions} questions, ${r.candidates} students seated.`);
              router.refresh();
            })
          }
        >
          {pending ? "Publishing…" : pinRequired ? "Publish & generate PINs" : "Publish"}
        </Button>
      </div>
    </div>
  );
}
