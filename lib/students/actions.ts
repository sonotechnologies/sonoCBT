"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { student } from "@/lib/db/schema";
import { FileReadError, readSpreadsheet } from "@/lib/import/read-file";
import { readStudentSheet, type RawStudent } from "@/lib/import/students";
import { requireCan, requireStaff } from "@/lib/tenant/context";
import { eq } from "drizzle-orm";
import { createStudents, resetStudentPassword, type CreateStudentsResult } from "./accounts";

export type ReadResult = { ok: true; fileName: string; rows: RawStudent[] } | { ok: false; error: string };

/** Step 1 of an import: read the file. Nothing is saved. */
export async function readImportFileAction(slug: string, form: FormData): Promise<ReadResult> {
  await requireCan(slug, "student.manage");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  try {
    const sheet = await readSpreadsheet(file);
    const { rows, missingColumns } = readStudentSheet(sheet);
    if (missingColumns.length) {
      return { ok: false, error: `We couldn't find these columns: ${missingColumns.join(", ")}. Check the header row, or start from our template.` };
    }
    if (!rows.length) return { ok: false, error: "That file has no students in it." };
    if (rows.length > 3000) return { ok: false, error: "That's more than 3,000 students. Split the list by class and upload each part." };
    // Rows go back exactly as read; the review screen checks them (and re-checks on every edit).
    return { ok: true, fileName: file.name, rows };
  } catch (e) {
    if (e instanceof FileReadError) return { ok: false, error: e.message };
    throw e;
  }
}

const rowSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  otherNames: z.string().optional(),
  admissionNo: z.string(),
  classArmId: z.uuid(),
  gender: z.enum(["female", "male", ""]).optional(),
  dateOfBirth: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
});

/** Step 2: create up to 100 students per call (the client sends batches and shows progress). */
export async function importStudentsAction(slug: string, rows: unknown[]): Promise<CreateStudentsResult | { error: string }> {
  const ctx = await requireCan(slug, "student.manage");
  const parsed = z.array(rowSchema).max(100).safeParse(rows);
  if (!parsed.success) return { error: "Some rows weren't in the expected shape. Upload the file again." };
  const result = await createStudents(ctx.scope, parsed.data, ctx.user.id);
  revalidatePath(`/s/${slug}`, "layout");
  return result;
}

/** Admin, or the student's form teacher, gives them a new starting password. */
export async function resetStudentPasswordAction(slug: string, studentId: string): Promise<{ password?: string; error?: string }> {
  const ctx = await requireStaff(slug);
  const s = await ctx.scope.findFirst(student, eq(student.id, studentId));
  if (!s) return { error: "Student not found." };
  if (!can(ctx.actor, "student.resetPassword", { schoolId: ctx.school.id, classArmId: s.classArmId, studentId: s.id })) {
    return { error: "Only the school admin or this student's form teacher can reset their password." };
  }
  return { password: await resetStudentPassword(ctx.scope, s.id, ctx.user.id) };
}
