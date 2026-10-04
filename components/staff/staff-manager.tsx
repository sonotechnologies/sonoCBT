"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { inviteAction, resendInviteAction, revokeInviteAction, type InviteState } from "@/lib/staff/actions";
import type { StaffRow } from "@/lib/staff/list";
import { cn } from "@/lib/utils";

const STATUS: Record<StaffRow["status"], { label: string; className: string }> = {
  joined: { label: "Joined", className: "bg-[#E8F4EC] text-[#155E34]" },
  invited: { label: "Invited", className: "bg-[#EAF1F9] text-[#1D4B80]" },
  not_sent: { label: "Not sent", className: "bg-chip text-ink-2" },
  expired: { label: "Expired", className: "bg-[#FBEFE3] text-[#8A430B]" },
};

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="h-9 rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-semibold"
    >
      {copied ? "Copied" : "Copy invite link"}
    </button>
  );
}

function InviteRowActions({ slug, row }: { slug: string; row: StaffRow }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ link?: string; sent?: boolean; error?: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {result?.link && <CopyLink link={result.link} />}
      {result?.error && <span className="text-xs font-semibold text-destructive">{result.error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await resendInviteAction(slug, row.id)))}
        className="h-9 rounded-md px-2 text-[13px] font-semibold text-ink-2 underline disabled:opacity-50"
      >
        {pending ? "Sending…" : result?.link ? (result.sent ? "Sent again" : "Email failed") : "Resend"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(`Cancel the invite for ${row.name}? Their link will stop working.`)) start(() => revokeInviteAction(slug, row.id));
        }}
        className="h-9 rounded-md px-2 text-[13px] font-semibold text-ink-2 underline disabled:opacity-50"
      >
        Cancel invite
      </button>
    </div>
  );
}

export function StaffList({ slug, rows }: { slug: string; rows: StaffRow[] }) {
  if (!rows.length) {
    return <p className="rounded-lg border border-border bg-card p-4 text-sm text-ink-2">No staff yet. Invite your first teacher below.</p>;
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-card">
      {rows.map((r) => (
        <li
          key={`${r.kind}-${r.id}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-divider px-[18px] py-3 text-sm first:border-t-0 md:grid-cols-[1.3fr_1.4fr_1fr_110px]"
        >
          <span className="font-semibold">{r.name}</span>
          <span className="col-start-1 truncate font-mono text-[13px] text-ink-2 md:col-start-auto">{r.email}</span>
          <span className="col-start-1 md:col-start-auto">{r.role}</span>
          <span
            className={cn(
              "col-start-2 row-start-1 justify-self-end rounded-full px-[9px] py-[3px] text-xs font-semibold md:col-start-auto md:row-start-auto",
              STATUS[r.status].className,
            )}
          >
            {STATUS[r.status].label}
          </span>
          {r.kind === "invite" && (
            <div className="col-span-full">
              <InviteRowActions slug={slug} row={r} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function InviteForm({
  slug,
  subjects,
  arms,
}: {
  slug: string;
  subjects: { id: string; name: string }[];
  arms: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction.bind(null, slug), undefined);
  const [role, setRole] = useState("teacher");
  const values = state && !state.ok ? state.values : undefined;

  return (
    <div className="mt-3.5 flex flex-col gap-3">
      {state?.ok && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-[#C3E2CF] bg-[#E8F4EC] p-3.5 text-sm text-[#155E34]">
          <span className="flex-1">
            {state.sent ? (
              <>
                Invite sent to <b>{state.email}</b>. You can also share the link directly.
              </>
            ) : (
              <>
                The email to <b>{state.email}</b> didn&apos;t send. Copy the link and share it (e.g. on WhatsApp).
              </>
            )}
          </span>
          <CopyLink link={state.link} />
        </div>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 self-start rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold"
        >
          + Invite {state?.ok ? "another" : "a"} member of staff
        </button>
      ) : (
        <form
          key={state?.ok ? state.link : "form"}
          action={action}
          className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" required placeholder="e.g. Mr. Emeka Nwosu" defaultValue={values?.name} className="h-[46px] text-[15px]" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required defaultValue={values?.email} className="h-[46px] text-[15px]" />
            </Field>
            <Field label="Role">
              <Select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="h-[46px] text-[15px]">
                <option value="teacher">Teacher</option>
                <option value="form_teacher">Form teacher (also teaches)</option>
                <option value="exam_officer">Exam officer</option>
                <option value="school_admin">School admin</option>
              </Select>
            </Field>
            {role === "form_teacher" && (
              <Field label="Class they look after">
                <Select name="classArmId" required defaultValue={values?.classArmId} className="h-[46px] text-[15px]">
                  <option value="">Choose a class</option>
                  {arms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {(role === "teacher" || role === "form_teacher") && subjects.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">
                Subjects they teach <span className="font-normal text-muted-foreground">(optional · you can fine-tune classes later)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <label key={s.id} className="cursor-pointer">
                    <input type="checkbox" name="subjectIds" value={s.id} className="peer sr-only" />
                    <span className="flex h-[34px] items-center rounded-full border border-input bg-card px-3 text-[13px] font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-ring">
                      {s.name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {state && !state.ok && state.error && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="md" disabled={pending}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
            <Button type="button" variant="outline" size="md" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
