import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MonitorClient } from "@/components/exams/monitor-client";
import { monitorData, MonitorError } from "@/lib/exams/monitor";
import { requireStaff } from "@/lib/tenant/context";

export const metadata: Metadata = { title: "Live monitor" };

export default async function MonitorPage({ params }: PageProps<"/s/[schoolSlug]/exams/[id]/monitor">) {
  const { schoolSlug, id } = await params;
  const ctx = await requireStaff(schoolSlug);
  let data: Awaited<ReturnType<typeof monitorData>>;
  try {
    data = await monitorData(ctx.scope, ctx.actor, id);
  } catch (e) {
    if (e instanceof MonitorError) notFound();
    throw e;
  }
  return <MonitorClient slug={schoolSlug} initial={data} />;
}
