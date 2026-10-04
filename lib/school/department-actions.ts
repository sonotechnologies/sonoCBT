"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCan } from "@/lib/tenant/context";
import { deleteDepartment, saveDepartment } from "./departments";
import { SetupError } from "./setup";

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().max(60),
  subjectIds: z.array(z.uuid()).max(100),
  hodUserId: z.uuid().nullable(),
});

export async function saveDepartmentAction(slug: string, input: z.infer<typeof schema>): Promise<{ error?: string }> {
  const ctx = await requireCan(slug, "staff.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the department details." };
  try {
    await saveDepartment(ctx.scope, ctx.user.id, parsed.data);
  } catch (e) {
    if (e instanceof SetupError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/s/${slug}`, "layout");
  return {};
}

export async function deleteDepartmentAction(slug: string, id: string): Promise<void> {
  const ctx = await requireCan(slug, "staff.manage");
  await deleteDepartment(ctx.scope, ctx.user.id, z.uuid().parse(id));
  revalidatePath(`/s/${slug}`, "layout");
}
