import type { ExamReport } from "@/lib/analytics/exam";
import { formatDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CsvLink } from "./picker";
import { Card, Stat } from "./ui";

const pctStr = (v: number | null) => (v === null ? "—" : `${num(v)}%`);
const secs = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)} s` : `${num(s / 60)} min`);
const EVENT_LABEL: Record<string, string> = {
  tab_hidden: "Left the exam window",
  fullscreen_exit: "Left full screen",
  copy: "Copy",
  paste: "Paste",
  multi_session: "Second sign-in blocked",
  device_moved: "Moved to another device",
  snapshot_declined: "Photo declined",
  blocked_ip: "Outside the school network",
  auto_submitted: "Submitted automatically",
  extra_time: "Extra time given",
  session_reset: "Session reset",
  force_submitted: "Submitted by staff",
  late_answers_accepted: "Late answers counted",
};

export function ExamReportView({ r, csv }: { r: ExamReport; csv: (table: string) => string }) {
  const max = Math.max(1, ...r.distribution.map((d) => d.count));
  return (
    <div className="flex flex-col gap-5">
      {(r.partial || r.pendingTheory > 0) && (
        <p className="rounded-md bg-[#EAF1F9] px-3.5 py-2.5 text-sm text-[#1D4B80]">
          {r.partial && "Showing only the questions in your subjects; scores are over those questions. "}
          {r.pendingTheory > 0 && `${r.pendingTheory} theory answers are still being marked and count as 0 until then.`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat k="Average" v={pctStr(r.stats.average)} d={`median ${pctStr(r.stats.median)}`} />
        <Stat k="Pass rate" v={r.stats.passRate === null ? "—" : `${r.stats.passRate}%`} d="scored 40% or more" />
        <Stat k="Highest" v={pctStr(r.stats.highest)} d={`lowest ${pctStr(r.stats.lowest)}`} />
        <Stat k="Median time" v={r.stats.medianMinutes === null ? "—" : `${Math.round(r.stats.medianMinutes)} min`} d={`of ${r.exam.durationMinutes} min allowed`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title="Score distribution" sub={`${r.stats.sat} of ${r.stats.candidates} students sat it · ${formatDate(r.exam.windowStart)} · score %`}>
          <div className="flex h-[220px] items-end gap-2 border-b-[1.5px] border-ink" role="img" aria-label={`Score distribution: ${r.distribution.map((d) => `${d.from}–${d.from + 9}%: ${d.count}`).join(", ")}`}>
            {r.distribution.map((d) => (
              <div key={d.from} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="font-mono text-[11px]">{d.count}</span>
                <span className={cn("w-full rounded-t", d.from < 40 ? "bg-[#C9CCD4]" : "bg-ink")} style={{ height: `${(d.count / max) * 88}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2">
            {r.distribution.map((d) => (
              <span key={d.from} className="flex-1 text-center font-mono text-[11px] text-muted-foreground">
                {d.from}
              </span>
            ))}
          </div>
          <div className="mt-3.5 flex gap-4 text-xs text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-[#C9CCD4]" />
              Below pass (40)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-ink" />
              Pass
            </span>
          </div>
        </Card>

        <Card title="Most-missed questions" sub="With the wrong option most students picked" flush action={<CsvLink href={csv("exam-questions")} label="All questions" />}>
          <ol aria-label="Most-missed questions">
            {r.mostMissed.map((q) => (
              <li key={q.id} className="grid grid-cols-[44px_minmax(0,1fr)_150px] items-center gap-3.5 border-t border-divider px-[22px] py-3.5">
                <span className="font-mono text-sm font-bold">Q{q.number}</span>
                <div className="min-w-0">
                  <div className="rich font-exam truncate text-[15px] [&_p]:inline" dangerouslySetInnerHTML={{ __html: q.html }} />
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold text-[#155E34]">
                      ✓ {q.right.map((o) => o.letter).join(", ")} <span className="rich [&_p]:inline" dangerouslySetInnerHTML={{ __html: q.right[0]?.html ?? "" }} />
                    </span>
                    {q.wrong && (
                      <span className="font-semibold text-[#8A430B]">
                        Most picked {q.wrong.letter} <span className="rich [&_p]:inline" dangerouslySetInnerHTML={{ __html: q.wrong.html }} /> · {num(q.wrong.picked)}%
                      </span>
                    )}
                    <span className="text-muted-foreground">{q.topic}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex h-2.5 overflow-hidden rounded-[5px] bg-[#EEF0F5]" aria-hidden>
                    <span className="h-full bg-[#1F8A4C]" style={{ width: `${q.pctCorrect}%` }} />
                    <span className="h-full bg-[#D9731A]" style={{ width: `${q.wrong?.picked ?? 0}%` }} />
                  </span>
                  <span className="text-right font-mono text-xs">{num(q.pctCorrect)}% correct</span>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Topics in this exam" sub="% of marks earned, weakest first" action={<CsvLink href={csv("exam-topics")} />}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="pb-2">Topic</th>
                <th className="pb-2 text-right">All</th>
                {r.armNames.map((a) => (
                  <th key={a} className="pb-2 text-right">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.topics.map((t) => (
                <tr key={t.name} className="border-t border-divider">
                  <td className="py-2 font-semibold">
                    {t.name} <span className="text-xs font-normal text-muted-foreground">· {t.questions}Q</span>
                  </td>
                  <td className={cn("py-2 text-right font-mono", t.pct !== null && t.pct < 40 && "font-bold text-[#A1271F]")}>{pctStr(t.pct)}</td>
                  {r.armNames.map((a) => (
                    <td key={a} className={cn("py-2 text-right font-mono", t.arms[a] !== null && t.arms[a]! < 40 && "font-bold text-[#A1271F]")}>
                      {pctStr(t.arms[a])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="By class" action={<CsvLink href={csv("exam-scores")} label="Scores" />}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="pb-2">Class</th>
                  <th className="pb-2 text-right">Sat</th>
                  <th className="pb-2 text-right">Average</th>
                  <th className="pb-2 text-right">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {r.byArm.map((a) => (
                  <tr key={a.name} className="border-t border-divider">
                    <td className="py-2 font-semibold">{a.name}</td>
                    <td className="py-2 text-right font-mono">{a.sat}</td>
                    <td className="py-2 text-right font-mono">{pctStr(a.average)}</td>
                    <td className="py-2 text-right font-mono">{a.passRate === null ? "—" : `${a.passRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Integrity" sub={`${r.integrity.flaggedScripts} of ${r.stats.sat} scripts flagged`}>
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>
                Ended by the timer: <b className="font-mono">{r.integrity.autoSubmitted.timeout}</b>
              </li>
              <li>
                Ended by the integrity rules: <b className="font-mono">{r.integrity.autoSubmitted.integrity}</b>
              </li>
              {r.integrity.events.map((e) => (
                <li key={e.type}>
                  {EVENT_LABEL[e.type] ?? e.type}: <b className="font-mono">{e.count}</b>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card title="Every question" sub="% correct counts a skipped question as missed. Time is the median gap since the student's previous answer." flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-ink-2">
              <tr>
                <th className="px-4 py-2.5">Q</th>
                <th className="px-2 py-2.5">Question</th>
                <th className="px-2 py-2.5">Topic</th>
                <th className="px-2 py-2.5 text-right">Correct</th>
                <th className="px-2 py-2.5">Most-picked wrong</th>
                <th className="px-2 py-2.5 text-right">Skipped</th>
                <th className="px-4 py-2.5 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {r.questions.map((q) => (
                <tr key={q.id} className="border-t border-divider">
                  <td className="px-4 py-2 font-mono font-bold">{q.number}</td>
                  <td className="max-w-[360px] px-2 py-2">
                    <div className="rich truncate [&_p]:inline" dangerouslySetInnerHTML={{ __html: q.html }} />
                  </td>
                  <td className="px-2 py-2 text-ink-2">{q.topic}</td>
                  <td className={cn("px-2 py-2 text-right font-mono", q.pctCorrect < 40 && "font-bold text-[#A1271F]")}>{num(q.pctCorrect)}%</td>
                  <td className="px-2 py-2 font-mono text-[13px]">{q.wrong ? `${q.wrong.letter} · ${num(q.wrong.picked)}%` : "—"}</td>
                  <td className="px-2 py-2 text-right font-mono">{num(q.skipped)}%</td>
                  <td className="px-4 py-2 text-right font-mono">{secs(q.medianSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
