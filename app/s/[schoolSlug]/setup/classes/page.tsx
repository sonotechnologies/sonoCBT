import { CLASS_LEVELS, DEFAULT_ARMS, DEFAULT_SUBJECTS } from "@/lib/school/defaults";
import { armsOf, getSetupState } from "@/lib/school/setup";
import { requireCan } from "@/lib/tenant/context";
import { saveClassesAction } from "../actions";
import { StepForm } from "../step-shell";
import { ClassesEditor } from "./classes-editor";

export default async function ClassesStep({ params }: PageProps<"/s/[schoolSlug]/setup/classes">) {
  const { schoolSlug } = await params;
  const { scope } = await requireCan(schoolSlug, "school.manage");
  const [state, arms] = await Promise.all([getSetupState(scope), armsOf(scope)]);

  const hasClasses = arms.length > 0;
  const levels = CLASS_LEVELS.map((code) => {
    const mine = arms.filter((a) => a.levelCode === code).map((a) => a.name.slice(code.length).trim());
    return hasClasses
      ? { code, on: mine.length > 0, arms: mine.join(mine.some((m) => m.length > 2) ? ", " : " ") || DEFAULT_ARMS[code].join(" ") }
      : { code, on: true, arms: DEFAULT_ARMS[code].join(DEFAULT_ARMS[code].some((a) => a.length > 2) ? ", " : " ") };
  });
  const subjects = state.subjects.length
    ? state.subjects.map((s) => ({ name: s.name, shortName: s.shortName, stage: s.stage }))
    : DEFAULT_SUBJECTS;

  return (
    <StepForm base={`/s/${schoolSlug}/setup`} step="classes" action={saveClassesAction.bind(null, schoolSlug)}>
      <ClassesEditor initialLevels={levels} initialSubjects={subjects} />
    </StepForm>
  );
}
