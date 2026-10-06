import type { schoolOverview } from "@/lib/analytics/school";
import { AT_RISK_BELOW, AT_RISK_DROP } from "@/lib/analytics/school";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CsvLink } from "./picker";
import { Card, Stat } from "./ui";

type Overview = Awaited<ReturnType<typeof schoolOverview>>;
const BAR = ["#C9CCD4", "#8C93A3", "#14213D"];
const TONE = { bad: "text-[#A1271F]", warn: "text-[#8A430B]", good: "text-[#155E34]" };
const signed = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}`);

export function SchoolView({ o, csv }: { o: Overview; csv: (table: string) => string }) {
  const terms = o.recent;
  const offset = BAR.length - terms.length;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          k="School average"
          v={o.stats.average === null ? "—" : num(o.stats.average)}
          d={o.stats.change === null ? "first term with scores" : `${signed(o.stats.change)} on ${o.previous?.short ?? "last term"}`}
          tone={o.stats.change === null ? undefined : o.stats.change >= 0 ? "good" : "bad"}
        />
        <Stat k="Pass rate" v={o.stats.passRate === null ? "—" : `${o.stats.passRate}%`} d="all subjects, 40% or more" />
        <Stat k="Exams this term" v={String(o.stats.exams)} d={`${o.stats.scripts.toLocaleString("en-NG")} scripts handed in`} />
        <Stat k="Students at risk" v={String(o.stats.atRisk)} d={`of ${o.stats.students} with scores`} tone={o.stats.atRisk ? "bad" : undefined} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Averages use the CA grid over the parts entered so far this term, so they are comparable mid-term.</p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title={`Average score by class, last ${terms.length} ${terms.length === 1 ? "term" : "terms"}`}>
          <div className="flex flex-col gap-3">
            {o.trend.map((t) => {
              const now = t.values[t.values.length - 1];
              return (
                <div key={t.level} className="grid grid-cols-[52px_minmax(0,1fr)_52px] items-center gap-3">
                  <span className="text-sm font-bold">{t.level}</span>
                  <div className="flex flex-col gap-[3px]">
                    {t.values.map((v, i) => (
                      <span
                        key={i}
                        className="h-2 rounded-r"
                        style={{ width: `${v ?? 0}%`, background: BAR[i + offset] }}
                        title={`${terms[i].label}: ${v === null ? "no scores" : `${num(v)}%`}`}
                      />
                    ))}
                  </div>
                  <span className="text-right font-mono text-sm font-semibold">{now === null ? "—" : num(now)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink-2">
            {terms.map((t, i) => (
              <span key={t.id} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: BAR[i + offset] }} />
                {t.label}
                {t.id === o.term.id ? " (now)" : ""}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Subjects to watch" flush>
          {o.watch.length ? (
            <ul>
              {o.watch.map((w) => (
                <li key={w.title} className="flex items-center gap-3 border-t border-divider px-[22px] py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{w.title}</div>
                    <div className="text-[13px] text-muted-foreground">{w.detail}</div>
                  </div>
                  <span className={cn("font-mono text-lg font-semibold", TONE[w.tone])}>{w.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-divider px-[22px] py-4 text-sm text-muted-foreground">Nothing stands out this term.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Subjects, best first" sub={o.previous ? `Change is against ${o.previous.label}` : undefined} action={<CsvLink href={csv("subjects")} />}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="pb-2">Subject</th>
                <th className="pb-2 text-right">Average</th>
                <th className="pb-2 text-right">Pass rate</th>
                <th className="pb-2 text-right">Below 40</th>
                <th className="pb-2 text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {o.subjects.map((s) => (
                <tr key={s.id} className="border-t border-divider">
                  <td className="py-2 font-semibold">{s.name}</td>
                  <td className="py-2 text-right font-mono">{num(s.average)}%</td>
                  <td className="py-2 text-right font-mono">{s.passRate}%</td>
                  <td className="py-2 text-right font-mono">{s.below}</td>
                  <td className={cn("py-2 text-right font-mono", s.change !== null && (s.change >= 0 ? "text-[#155E34]" : "text-[#A1271F]"))}>{signed(s.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Classes this term" action={<CsvLink href={csv("classes")} />}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="pb-2">Class</th>
                <th className="pb-2 text-right">Students</th>
                <th className="pb-2 text-right">Average</th>
                <th className="pb-2 text-right">Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {o.arms.map((a) => (
                <tr key={a.arm} className="border-t border-divider">
                  <td className="py-2 font-semibold">{a.arm}</td>
                  <td className="py-2 text-right font-mono">{a.students}</td>
                  <td className="py-2 text-right font-mono">{num(a.average)}%</td>
                  <td className="py-2 text-right font-mono">{a.passRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Students at risk" sub={`Average below ${AT_RISK_BELOW}%, or down ${AT_RISK_DROP} points or more since last term`} flush action={<CsvLink href={csv("at-risk")} />}>
        {o.atRisk.length ? (
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-sm">
              <thead className="bg-secondary text-left text-xs text-ink-2">
                <tr>
                  <th className="px-[22px] py-2.5">Student</th>
                  <th className="px-2 py-2.5">Class</th>
                  <th className="px-2 py-2.5 text-right">Average</th>
                  <th className="px-2 py-2.5 text-right">Last term</th>
                  <th className="px-2 py-2.5 text-right">Change</th>
                  <th className="px-2 py-2.5">Weakest subject</th>
                  <th className="px-[22px] py-2.5">Why</th>
                </tr>
              </thead>
              <tbody>
                {o.atRisk.map((s) => (
                  <tr key={s.id} className="border-t border-divider">
                    <td className="px-[22px] py-2">
                      <span className="font-semibold">{s.name}</span> <span className="font-mono text-xs text-muted-foreground">{s.admissionNo}</span>
                    </td>
                    <td data-label="Class" className="px-2 py-2">{s.arm}</td>
                    <td data-label="Average" className="px-2 py-2 text-right font-mono">{num(s.average)}%</td>
                    <td data-label="Last term" className="px-2 py-2 text-right font-mono">{s.previous === null ? "—" : `${num(s.previous)}%`}</td>
                    <td data-label="Change" className="px-2 py-2 text-right font-mono text-[#A1271F]">{signed(s.change)}</td>
                    <td data-label="Weakest subject" className="px-2 py-2">{s.weakest}</td>
                    <td data-label="Why" className="px-[22px] py-2">{s.reason === "below" ? `Below ${AT_RISK_BELOW}%` : "Dropping"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="border-t border-divider px-[22px] py-4 text-sm text-muted-foreground">No student is below {AT_RISK_BELOW}% or dropping sharply.</p>
        )}
      </Card>
    </div>
  );
}
