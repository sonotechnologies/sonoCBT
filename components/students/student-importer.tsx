"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  checkStudents,
  isImportable,
  type Arm,
  type CheckedStudent,
  type RawStudent,
} from "@/lib/import/students";
import type { StartingLogin } from "@/lib/students/accounts";
import { importStudentsAction, readImportFileAction } from "@/lib/students/actions";
import { cn } from "@/lib/utils";

const BATCH = 100;

function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function StudentImporter({
  slug,
  arms,
  existingAdmissionNos,
  loginUrl,
}: {
  slug: string;
  arms: Arm[];
  existingAdmissionNos: string[];
  loginUrl: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawStudent[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [created, setCreated] = useState<StartingLogin[] | null>(null);
  const [skippedOnImport, setSkippedOnImport] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => new Set(existingAdmissionNos), [existingAdmissionNos]);
  const rows = useMemo(() => checkStudents(raw, { arms, existingAdmissionNos: existing }), [raw, arms, existing]);

  const attention = rows.filter((r) => !excluded.has(r.line) && r.issues.some((i) => i.level !== "skip") && !isImportable(r));
  const warnings = rows.filter((r) => isImportable(r) && r.issues.length > 0);
  const alreadyIn = rows.filter((r) => r.issues.some((i) => i.level === "skip"));
  const ready = rows.filter((r) => isImportable(r) && !excluded.has(r.line));
  const suggestions = rows.filter((r) => !r.classArmId && r.issues.some((i) => i.suggestion));
  const classesMatched = new Set(rows.map((r) => r.classArmId).filter(Boolean)).size;

  const edit = (line: number, patch: Partial<RawStudent>) =>
    setRaw((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)));

  const onFile = (file: File) => {
    setError(null);
    setCreated(null);
    const fd = new FormData();
    fd.set("file", file);
    startReading(async () => {
      const res = await readImportFileAction(slug, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFileName(res.fileName);
      setRaw(res.rows);
      setExcluded(new Set());
    });
  };

  const runImport = async () => {
    const toSend = ready.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      otherNames: r.otherNames,
      admissionNo: r.admissionNo,
      classArmId: r.classArmId!,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      guardianName: r.guardianName,
      guardianPhone: r.guardianPhone,
    }));
    setProgress({ done: 0, total: toSend.length });
    setError(null);
    const logins: StartingLogin[] = [];
    let skipped = 0;
    for (let i = 0; i < toSend.length; i += BATCH) {
      const res = await importStudentsAction(slug, toSend.slice(i, i + BATCH));
      if ("error" in res) {
        setError(`${res.error} ${logins.length} students were imported before this.`);
        break;
      }
      logins.push(...res.created);
      skipped += res.skipped.length;
      setProgress({ done: Math.min(i + BATCH, toSend.length), total: toSend.length });
    }
    setCreated(logins);
    setSkippedOnImport(skipped);
    setProgress(null);
  };

  const downloadLogins = () =>
    download(
      `starting-passwords-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        ["Name", "Admission number", "Class", "Starting password", "Sign in at"],
        ...(created ?? []).map((l) => [l.name, l.admissionNo, l.className, l.password, loginUrl]),
      ]),
    );

  // ── Done ──
  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 rounded-xl border border-[#C3E2CF] bg-[#E8F4EC] p-5">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-success">
            <CheckIcon />
          </span>
          <div className="flex-1 text-[#155E34]">
            <div className="text-[15px] font-bold">
              {created.length} {created.length === 1 ? "student" : "students"} imported
            </div>
            <div className="text-[13px]">
              Each has a starting password and will choose their own at first sign-in.
              {skippedOnImport > 0 && ` ${skippedOnImport} were already in SonoCBT and were skipped.`}
            </div>
          </div>
        </div>
        {created.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <p className="text-sm">
              <b>Download the starting passwords now.</b> For security they can&apos;t be shown again (you can reset any
              student&apos;s password later). Print the list or share each student&apos;s line with their form teacher.
            </p>
            <Button type="button" size="md" onClick={downloadLogins} className="self-start">
              Download starting passwords (CSV)
            </Button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setRaw([]);
            setFileName(null);
          }}
          className="self-start text-sm font-semibold text-ink-2 underline"
        >
          Import another file
        </button>
      </div>
    );
  }

  // ── Pick a file ──
  if (!fileName) {
    return (
      <div className="flex flex-col gap-4">
        <label
          className={cn(
            "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-input bg-card p-6 text-center focus-within:outline-3 focus-within:outline-ring",
            reading && "opacity-60",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) onFile(f);
          }}
        >
          <span className="text-[15px] font-bold">{reading ? "Reading your list…" : "Choose your class list"}</span>
          <span className="text-[13px] text-muted-foreground">Excel (.xlsx) or CSV · drag it here or tap to choose</span>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={reading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <p className="text-[13px] leading-normal text-muted-foreground">
          We need a name, admission number and class for each student. Gender, date of birth and a guardian&apos;s phone
          are optional. Start from our template:{" "}
          <a href={`/s/${slug}/students/template?format=xlsx`} className="font-semibold text-foreground underline">
            Excel
          </a>{" "}
          ·{" "}
          <a href={`/s/${slug}/students/template?format=csv`} className="font-semibold text-foreground underline">
            CSV
          </a>
        </p>
      </div>
    );
  }

  // ── Review ──
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex items-center gap-4 rounded-xl border p-5",
          attention.length ? "border-border bg-card" : "border-[#C3E2CF] bg-[#E8F4EC]",
        )}
      >
        <span className={cn("flex size-10 flex-none items-center justify-center rounded-full", attention.length ? "bg-warning" : "bg-success")}>
          <CheckIcon />
        </span>
        <div className={cn("flex-1", !attention.length && "text-[#155E34]")}>
          <div className="text-[15px] font-bold">
            {fileName} — {rows.length} {rows.length === 1 ? "student" : "students"} read
          </div>
          <div className="text-[13px]">
            {classesMatched} {classesMatched === 1 ? "class" : "classes"} matched
            {attention.length > 0 && ` · ${attention.length} ${attention.length === 1 ? "row needs" : "rows need"} a look`}
            {alreadyIn.length > 0 && ` · ${alreadyIn.length} already in SonoCBT`}
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setRaw((rs) =>
                  rs.map((r) => {
                    const s = rows.find((x) => x.line === r.line)?.issues.find((i) => i.suggestion)?.suggestion;
                    return s && !r.classArmId ? { ...r, classArmId: s.id } : r;
                  }),
                )
              }
              className="h-10 self-start rounded-md border-[1.5px] border-input bg-card px-3 text-[13px] font-semibold"
            >
              {suggestions.length === 1 ? "Use the class suggestion" : `Use all ${suggestions.length} class suggestions`}
            </button>
          )}
          <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="h-10 bg-secondary text-left text-xs font-bold text-ink-2">
                  <th className="px-[18px]">Name</th>
                  <th className="px-2">Admission no.</th>
                  <th className="px-2">Class</th>
                  <th className="px-2">Issue</th>
                  <th className="px-[18px] text-right">
                    <span className="sr-only">Leave out</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {attention.map((r) => (
                  <IssueRow key={r.line} row={r} arms={arms} onEdit={edit} onExclude={() => setExcluded((s) => new Set(s).add(r.line))} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            {warnings.length} {warnings.length === 1 ? "row has" : "rows have"} a note (still imported)
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-2">
            {warnings.map((r) => (
              <li key={r.line}>
                Row {r.line}, {r.firstName} {r.lastName}: {r.issues.map((i) => i.message).join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {excluded.size > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {excluded.size} {excluded.size === 1 ? "row" : "rows"} left out.{" "}
          <button type="button" className="font-semibold text-foreground underline" onClick={() => setExcluded(new Set())}>
            Put back
          </button>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="md" disabled={!ready.length || !!progress} onClick={runImport}>
          {progress ? `Importing ${progress.done} of ${progress.total}…` : `Import ${ready.length} ${ready.length === 1 ? "student" : "students"}`}
        </Button>
        {attention.length > 0 && !progress && (
          <span className="text-[13px] text-muted-foreground">Rows that still need a look won&apos;t be imported.</span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={!!progress}
          onClick={() => {
            setFileName(null);
            setRaw([]);
          }}
          className="text-[13px] font-semibold text-ink-2 underline"
        >
          Choose a different file
        </button>
      </div>
      {progress && (
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-border" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
          <div className="h-full bg-ink transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function IssueRow({
  row,
  arms,
  onEdit,
  onExclude,
}: {
  row: CheckedStudent;
  arms: Arm[];
  onEdit: (line: number, patch: Partial<RawStudent>) => void;
  onExclude: () => void;
}) {
  const issue = row.issues.find((i) => i.level === "error") ?? row.issues.find((i) => i.suggestion) ?? row.issues[0];
  const classIssue = row.issues.find((i) => i.field === "className");
  const admIssue = row.issues.find((i) => i.field === "admissionNo");
  const nameIssue = row.issues.find((i) => i.field === "row");
  const input = "h-9 w-full rounded-md border-[1.5px] border-input bg-card px-2 text-[13px] focus:border-2 focus:border-primary focus:outline-none";
  return (
    <tr className="border-t border-divider align-middle">
      <td className="px-[18px] py-2 font-semibold">
        {nameIssue ? (
          <div className="flex gap-1">
            <input className={input} placeholder="First name" defaultValue={row.firstName} onBlur={(e) => onEdit(row.line, { firstName: e.target.value })} aria-label={`First name, row ${row.line}`} />
            <input className={input} placeholder="Surname" defaultValue={row.lastName} onBlur={(e) => onEdit(row.line, { lastName: e.target.value })} aria-label={`Surname, row ${row.line}`} />
          </div>
        ) : (
          <>
            {row.firstName} {row.lastName}
          </>
        )}
        <div className="text-[11px] font-normal text-muted-foreground">Row {row.line}</div>
      </td>
      <td className="px-2 py-2 font-mono text-[13px]">
        {admIssue ? (
          <input
            className={cn(input, "font-mono")}
            defaultValue={row.admissionNo}
            placeholder="Add number"
            onBlur={(e) => onEdit(row.line, { admissionNo: e.target.value })}
            aria-label={`Admission number, row ${row.line}`}
          />
        ) : (
          row.admissionNo || "—"
        )}
      </td>
      <td className="px-2 py-2">
        {classIssue ? (
          <select
            className={input}
            value={row.classArmId ?? ""}
            onChange={(e) => onEdit(row.line, { classArmId: e.target.value || null })}
            aria-label={`Class for row ${row.line}`}
          >
            <option value="">{row.className || "Choose"}</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          arms.find((a) => a.id === row.classArmId)?.name ?? row.className
        )}
      </td>
      <td className="px-2 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#8A430B]">
          <span aria-hidden className="size-2 flex-none rounded-[2px] bg-warning" />
          {issue?.message}
        </span>
        {issue?.suggestion && (
          <button
            type="button"
            onClick={() => onEdit(row.line, { classArmId: issue.suggestion!.id })}
            className="mt-1 h-8 rounded-md bg-ink px-2.5 text-xs font-bold text-white"
          >
            Use {issue.suggestion.name}
          </button>
        )}
      </td>
      <td className="px-[18px] py-2 text-right">
        <button type="button" onClick={onExclude} className="h-8 text-xs font-semibold text-ink-2 underline">
          Leave out
        </button>
      </td>
    </tr>
  );
}
