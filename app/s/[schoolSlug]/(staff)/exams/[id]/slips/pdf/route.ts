import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { ExamError, examSlips } from "@/lib/exams/builder";
import { formatDate, formatTime } from "@/lib/format";
import { appUrl } from "@/lib/pdf/assets";
import { ExamPinSheetDocument, ExamSlipsDocument } from "@/lib/pdf/exam-slips-doc";
import { attachment } from "@/lib/pdf/report-cards";
import { getTenantContext } from "@/lib/tenant/context";

/**
 * Exam slips or the invigilator's PIN sheet as an A4 PDF:
 * ?view=slips|pins&class=<class arm id>|all. Same access as the slips page.
 */
export async function GET(req: Request, ctx: RouteContext<"/s/[schoolSlug]/exams/[id]/slips/pdf">) {
  const { schoolSlug, id } = await ctx.params;
  const t = await getTenantContext(schoolSlug);
  if (!t || !t.isStaff) return new Response("Signed out", { status: 401 });
  const q = new URL(req.url).searchParams;
  const view = q.get("view") === "pins" ? "pins" : "slips";
  let data: Awaited<ReturnType<typeof examSlips>>;
  try {
    data = await examSlips(t.scope, t.actor, id);
  } catch (e) {
    if (e instanceof ExamError) return new Response(e.message, { status: 404 });
    throw e;
  }
  const { exam, classes } = data;
  if (view === "pins" && !exam.pinRequired) return new Response("This exam doesn't use PINs.", { status: 404 });
  const wanted = q.get("class") && q.get("class") !== "all" ? classes.filter((c) => c.classArmId === q.get("class")) : classes;
  if (!wanted.length) return new Response("No such class for this exam.", { status: 404 });
  const info = {
    school: t.school.name,
    exam: exam.title,
    when: `${formatDate(exam.windowStart)} · ${formatTime(exam.windowStart)}`,
    signInUrl: `${appUrl().replace(/^https?:\/\//, "")}/s/${schoolSlug}/login`,
    brand: t.school.brandColor ?? "#14213D",
  };
  const doc = view === "pins" ? createElement(ExamPinSheetDocument, { info, classes: wanted }) : createElement(ExamSlipsDocument, { info, classes: wanted });
  const pdf = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  const scopeName = wanted.length === 1 ? wanted[0].name : "all classes";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(`${exam.title} ${view === "pins" ? "PIN sheet" : "slips"} ${scopeName}.pdf`),
      // PINs are on it: never cache.
      "Cache-Control": "private, no-store",
    },
  });
}
