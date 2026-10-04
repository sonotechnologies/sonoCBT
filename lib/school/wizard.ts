export const WIZARD_STEPS = [
  {
    slug: "details",
    title: "School details",
    sub: "Name, address, contact",
    heading: "Tell us about your school",
    lead: "This appears on exam slips, report cards and the parent result checker.",
  },
  {
    slug: "branding",
    title: "Branding",
    sub: "Crest, motto, colour",
    heading: "Add your crest and colour",
    lead: "Parents see these on every report card.",
  },
  {
    slug: "session",
    title: "Session & terms",
    sub: "Dates, CA and exam weights",
    heading: "Session and term dates",
    lead: "We use these for next-term dates on report cards and for CA deadlines.",
  },
  {
    slug: "classes",
    title: "Classes & subjects",
    sub: "JSS1 – SS3",
    heading: "Which classes do you run?",
    lead: "Tap a class to turn it off. You can change arms and subjects later.",
  },
  {
    slug: "staff",
    title: "Invite staff",
    sub: "Teachers, exam officers",
    heading: "Invite your staff",
    lead: "Each person gets an email to set their password. Roles decide what they can see.",
  },
  {
    slug: "students",
    title: "Import students",
    sub: "Excel or CSV",
    heading: "Import your students",
    lead: "Upload your class list. We match names to classes and flag anything unclear.",
  },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]["slug"];

export function stepIndex(slug: WizardStep): number {
  return WIZARD_STEPS.findIndex((s) => s.slug === slug);
}

export function nextStep(slug: WizardStep): WizardStep | null {
  return WIZARD_STEPS[stepIndex(slug) + 1]?.slug ?? null;
}

export function prevStep(slug: WizardStep): WizardStep | null {
  return WIZARD_STEPS[stepIndex(slug) - 1]?.slug ?? null;
}
