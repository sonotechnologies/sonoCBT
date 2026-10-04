import { Field, Input } from "@/components/ui/field";
import { lagosDayKey } from "@/lib/format";
import { defaultTerms } from "@/lib/school/defaults";
import { getSetupState } from "@/lib/school/setup";
import { requireCan } from "@/lib/tenant/context";
import { saveSessionAction } from "../actions";
import { StepForm } from "../step-shell";
import { WeightsEditor } from "./weights-editor";

const TERM_NAMES = ["", "1st Term", "2nd Term", "3rd Term"];

export default async function SessionStep({ params }: PageProps<"/s/[schoolSlug]/setup/session">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "school.manage");
  const state = await getSetupState(scope);

  // Sessions start in September; before August we're still in last year's session.
  const [y, m] = lagosDayKey(new Date()).split("-").map(Number);
  const startYear = state.session ? Number(state.session.name.slice(0, 4)) : m >= 8 ? y : y - 1;
  const defaults = defaultTerms(startYear);
  const terms = [1, 2, 3].map((n) => {
    const saved = state.terms.find((t) => t.number === n);
    const d = defaults[n - 1];
    return { number: n, startsOn: saved?.startsOn ?? d.startsOn, endsOn: saved?.endsOn ?? d.endsOn };
  });
  const currentTerm = state.currentTerm?.number ?? 1;
  const components = state.components.length
    ? state.components.map((c) => ({ name: c.name, weight: c.weight }))
    : [
        { name: "CA", weight: 40 },
        { name: "Exam", weight: 60 },
      ];

  return (
    <StepForm base={`/s/${schoolSlug}/setup`} step="session" action={saveSessionAction.bind(null, schoolSlug)}>
      <div className="flex flex-col gap-3">
        <Field label="Session" className="max-w-[220px]">
          <Input
            name="sessionName"
            defaultValue={state.session?.name ?? `${startYear}/${startYear + 1}`}
            mono
            placeholder="2026/2027"
            className="h-[46px] text-[15px]"
          />
        </Field>
        <fieldset className="mt-2 flex flex-col gap-3">
          <legend className="sr-only">Term dates</legend>
          {terms.map((t) => (
            <div
              key={t.number}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-[18px] py-4 sm:grid-cols-[140px_1fr_1fr_auto]"
            >
              <span className="col-span-2 text-[15px] font-bold sm:col-span-1">{TERM_NAMES[t.number]}</span>
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Resumes
                <input
                  type="date"
                  name={`t${t.number}Start`}
                  defaultValue={t.startsOn}
                  className="h-10 w-full min-w-0 rounded-md border-[1.5px] border-input bg-card px-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[13px] text-muted-foreground">
                Ends
                <input
                  type="date"
                  name={`t${t.number}End`}
                  defaultValue={t.endsOn}
                  className="h-10 w-full min-w-0 rounded-md border-[1.5px] border-input bg-card px-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-[13px] font-semibold sm:col-span-1 sm:justify-self-end">
                <input type="radio" name="currentTerm" value={t.number} defaultChecked={t.number === currentTerm} className="size-4 accent-[#14213D]" />
                Current
              </label>
            </div>
          ))}
        </fieldset>

        <div className="mt-2 flex flex-col gap-4 rounded-lg border border-border bg-card px-[18px] py-4">
          <p className="text-sm">
            Grading: <b>WAEC style (A1–F9)</b> <span className="text-muted-foreground">· you can adjust the grade bands later</span>
          </p>
          <div>
            <p className="mb-2 text-[13px] font-semibold">How each subject&apos;s 100 marks are made up</p>
            <WeightsEditor initial={components} />
          </div>
        </div>
      </div>
    </StepForm>
  );
}
