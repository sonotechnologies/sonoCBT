/** Nigerian secondary-school defaults used to pre-fill onboarding. */

export const CLASS_LEVELS = ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"] as const;
export type LevelCode = (typeof CLASS_LEVELS)[number];

export const stageOf = (code: string): "jss" | "ss" => (code.startsWith("JSS") ? "jss" : "ss");

export const DEFAULT_ARMS: Record<LevelCode, string[]> = {
  JSS1: ["A", "B"],
  JSS2: ["A", "B"],
  JSS3: ["A", "B"],
  SS1: ["Science", "Art", "Commercial"],
  SS2: ["Science", "Art", "Commercial"],
  SS3: ["Science", "Art", "Commercial"],
};

/** "JSS1" + "A" → "JSS1A"; "SS1" + "Science" → "SS1 Science" */
export function armName(level: string, arm: string): string {
  const a = arm.trim();
  return a.length <= 2 ? `${level}${a.toUpperCase()}` : `${level} ${a[0].toUpperCase()}${a.slice(1)}`;
}

/** Splits "A B C" or "Science, Art" into arm labels. */
export function parseArms(input: string): string[] {
  const parts = input.includes(",") ? input.split(",") : input.split(/\s+/);
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}

export type SubjectDefault = { name: string; shortName?: string; stage: "jss" | "ss" | "all" };

export const DEFAULT_SUBJECTS: SubjectDefault[] = [
  { name: "English Language", shortName: "English", stage: "all" },
  { name: "Mathematics", shortName: "Maths", stage: "all" },
  { name: "Civic Education", shortName: "Civic", stage: "all" },
  { name: "CRS / IRS", stage: "all" },
  { name: "Computer Studies", shortName: "Computer", stage: "all" },
  { name: "Agricultural Science", shortName: "Agric", stage: "all" },
  { name: "Basic Science", stage: "jss" },
  { name: "Basic Technology", shortName: "Basic Tech", stage: "jss" },
  { name: "Social Studies", stage: "jss" },
  { name: "Business Studies", shortName: "Business", stage: "jss" },
  { name: "French", stage: "jss" },
  { name: "Yoruba", stage: "jss" },
  { name: "Physics", stage: "ss" },
  { name: "Chemistry", stage: "ss" },
  { name: "Biology", stage: "ss" },
  { name: "Further Mathematics", shortName: "Further Maths", stage: "ss" },
  { name: "Economics", stage: "ss" },
  { name: "Government", stage: "ss" },
  { name: "Literature in English", shortName: "Literature", stage: "ss" },
  { name: "Geography", stage: "ss" },
  { name: "Financial Accounting", shortName: "Accounting", stage: "ss" },
  { name: "Commerce", stage: "ss" },
];

/** Default term dates for a session starting in `startYear` (2nd Monday of September, etc.). */
export function defaultTerms(startYear: number) {
  return [
    { number: 1, startsOn: `${startYear}-09-14`, endsOn: `${startYear}-12-18` },
    { number: 2, startsOn: `${startYear + 1}-01-11`, endsOn: `${startYear + 1}-04-01` },
    { number: 3, startsOn: `${startYear + 1}-04-26`, endsOn: `${startYear + 1}-07-23` },
  ];
}

export const BRAND_SWATCHES = ["#1B5E3A", "#7A1F2B", "#1E3F8C", "#5A2D82", "#8A5A00", "#2B2B2B"];

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT (Abuja)", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
  "Sokoto", "Taraba", "Yobe", "Zamfara",
];
