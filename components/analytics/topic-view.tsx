import type { topicMastery } from "@/lib/analytics/topics";
import { MIN_CELL } from "@/lib/analytics/topics";
import { num } from "@/lib/format";
import { CsvLink } from "./picker";
import { Card, heat } from "./ui";

type Mastery = Awaited<ReturnType<typeof topicMastery>>;
const SCALE: [string, number][] = [
  ["<35", 20],
  ["35", 40],
  ["50", 60],
  ["65", 70],
  ["80+", 90],
];

export function TopicView({ m, csv }: { m: Mastery; csv: string }) {
  if (!m.subject) return <p className="text-sm text-ink-2">No exams with answers in your subjects this term yet. Topic mastery fills in as students sit CBT exams.</p>;
  return (
    <div className="flex flex-col gap-5">
      <Card
        title={`${m.subject.name} · topic mastery by class`}
        sub={`% of marks earned on each topic's questions · ${m.exams.map((e) => e.title).join(", ")}`}
        action={
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1.5">% correct</span>
            {SCALE.map(([t, v]) => (
              <span key={t} className="flex h-[22px] w-11 items-center justify-center font-mono text-[11px]" style={{ background: heat(v).bg, color: heat(v).fg }}>
                {t}
              </span>
            ))}
            <span className="ml-2">
              <CsvLink href={csv} />
            </span>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1" aria-label="Topic mastery">
            <thead>
              <tr>
                <th className="w-[200px]" />
                {m.arms.map((a) => (
                  <th key={a} scope="col" className="min-w-[72px] py-1.5 text-center text-xs font-bold">
                    {a}
                  </th>
                ))}
                <th scope="col" className="min-w-[72px] py-1.5 text-center text-xs font-bold">
                  All
                </th>
              </tr>
            </thead>
            <tbody>
              {m.topics.map((t) => (
                <tr key={t.name}>
                  <th scope="row" className="pr-2 text-left text-[13px] font-semibold">
                    {t.name}
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {t.questions} {t.questions === 1 ? "question" : "questions"}
                    </span>
                  </th>
                  {[...t.cells, { arm: "All", pct: t.pct, answers: t.answers }].map((c) => (
                    <td
                      key={c.arm}
                      title={c.pct === null ? `Fewer than ${MIN_CELL} answers` : `${c.answers} answers`}
                      className="h-11 rounded-md text-center font-mono text-[13px] font-semibold"
                      style={{ background: heat(c.pct).bg, color: heat(c.pct).fg }}
                    >
                      {c.pct === null ? "—" : Math.round(c.pct)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Weakest topics" sub="Where to spend revision time" flush>
          <ol>
            {m.weakest.map((w, i) => (
              <li key={w.name} className="flex items-center gap-3 border-t border-divider px-[22px] py-3">
                <span className="font-mono text-sm font-bold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{w.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {w.questions} {w.questions === 1 ? "question" : "questions"}
                    {w.worstArm && m.arms.length > 1 ? ` · lowest in ${w.worstArm} (${num(w.worstPct)}%)` : ""}
                  </div>
                </div>
                <span className="rounded-md px-2 py-1 font-mono text-sm font-bold" style={{ background: heat(w.pct).bg, color: heat(w.pct).fg }}>
                  {Math.round(w.pct)}%
                </span>
              </li>
            ))}
          </ol>
        </Card>
        {m.trend && (
          <Card title={`${m.subject.name} across terms`} sub="Class average from the CA grid (parts entered so far)">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="pb-2">Class</th>
                  {m.trend.terms.map((t) => (
                    <th key={t.id} className="pb-2 text-right" title={t.label}>
                      {t.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.trend.rows.map((r) => (
                  <tr key={r.arm} className="border-t border-divider">
                    <td className="py-2 font-semibold">{r.arm}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="py-2 text-right font-mono">
                        {v === null ? "—" : `${num(v)}%`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">Students move up a class each session, so a class&apos;s earlier terms show under its old name.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
