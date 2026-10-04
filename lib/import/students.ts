/**
 * Student list import: turns a spreadsheet (already read into rows of strings)
 * into validated student rows with plain-language issues. Pure functions only.
 */
import { normaliseAdmissionNo } from "@/lib/auth/student-username";

export type StudentFields = {
  firstName: string;
  lastName: string;
  otherNames: string;
  admissionNo: string;
  className: string;
  gender: string;
  dateOfBirth: string;
  guardianName: string;
  guardianPhone: string;
};

/** One row as read from the file (or as edited on the review screen). */
export type RawStudent = StudentFields & {
  /** Row number in the spreadsheet, for messages like "Duplicate of row 211". */
  line: number;
  /** Set when the reviewer picked a class, overriding `className`. */
  classArmId?: string | null;
};

export type Arm = { id: string; name: string };

export type Issue = {
  field: keyof StudentFields | "row";
  /** error: must fix or skip · warning: needs a look (a suggestion is ready) · skip: will not be imported */
  level: "error" | "warning" | "skip";
  message: string;
  suggestion?: Arm;
};

export type CheckedStudent = RawStudent & {
  classArmId: string | null;
  gender: "female" | "male" | "";
  /** ISO yyyy-mm-dd or "" */
  dateOfBirth: string;
  issues: Issue[];
};

// ─── Reading columns ─────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<keyof StudentFields | "fullName", string[]> = {
  firstName: ["firstname", "first", "givenname", "forename", "firstnames"],
  lastName: ["lastname", "surname", "familyname", "last"],
  otherNames: ["othernames", "othername", "middlename", "middlenames", "middle"],
  fullName: ["name", "names", "fullname", "studentname", "nameofstudent", "studentsname", "studentfullname"],
  admissionNo: [
    "admissionno",
    "admissionnumber",
    "admno",
    "admission",
    "regno",
    "regnumber",
    "registrationnumber",
    "registrationno",
    "studentid",
    "studentno",
  ],
  className: ["class", "classarm", "arm", "form", "classname", "currentclass"],
  gender: ["gender", "sex"],
  dateOfBirth: ["dob", "dateofbirth", "birthdate", "birthday"],
  guardianName: ["guardian", "guardianname", "parent", "parentname", "parentguardian", "parentguardianname", "parentsname"],
  guardianPhone: [
    "guardianphone",
    "parentphone",
    "phone",
    "phonenumber",
    "guardianphonenumber",
    "parentphonenumber",
    "contact",
    "gsm",
    "mobile",
  ],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

export type ColumnMap = Partial<Record<keyof StudentFields | "fullName", number>>;

export function mapColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((h, i) => {
    const k = headerKey(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ColumnMap, string[]][]) {
      if (map[field] === undefined && aliases.includes(k)) map[field] = i;
    }
  });
  return map;
}

/** Title-cases names typed in capitals ("OKAFOR" → "Okafor"); leaves mixed case alone. */
export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Splits a single "Name" column. Nigerian class lists usually put the surname
 * first in capitals ("OKAFOR Chiamaka Ngozi") or before a comma ("Okafor, Chiamaka").
 * Otherwise the last word is taken as the surname.
 */
export function splitFullName(full: string): { firstName: string; lastName: string; otherNames: string } {
  const t = full.trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", lastName: "", otherNames: "" };
  if (t.includes(",")) {
    const [last, rest] = t.split(",", 2).map((x) => x.trim());
    const [first = "", ...others] = rest.split(" ");
    return { lastName: tidyName(last), firstName: tidyName(first), otherNames: tidyName(others.join(" ")) };
  }
  const words = t.split(" ");
  if (words.length === 1) return { firstName: tidyName(words[0]), lastName: "", otherNames: "" };
  const capsIndex = words.findIndex((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w));
  const allCaps = words.every((w) => w === w.toUpperCase());
  if (capsIndex === 0 || (allCaps && words.length > 1)) {
    const [last, first, ...others] = words;
    return { lastName: tidyName(last), firstName: tidyName(first), otherNames: tidyName(others.join(" ")) };
  }
  const last = words[words.length - 1];
  const [first, ...others] = words.slice(0, -1);
  return { firstName: tidyName(first), lastName: tidyName(last), otherNames: tidyName(others.join(" ")) };
}

const cell = (row: unknown[], i: number | undefined) => {
  if (i === undefined) return "";
  const v = row[i];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
};

export type ReadResult = { rows: RawStudent[]; missingColumns: string[] };

/** Reads the sheet's first row as headers; skips blank rows. */
export function readStudentSheet(sheet: unknown[][]): ReadResult {
  const headerIndex = sheet.findIndex((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (headerIndex === -1) return { rows: [], missingColumns: ["Name", "Admission number", "Class"] };
  const cols = mapColumns(sheet[headerIndex].map((c) => String(c ?? "")));

  const missingColumns: string[] = [];
  if (cols.fullName === undefined && (cols.firstName === undefined || cols.lastName === undefined)) {
    missingColumns.push("Name (or First name and Surname)");
  }
  if (cols.admissionNo === undefined) missingColumns.push("Admission number");
  if (cols.className === undefined) missingColumns.push("Class");

  const rows: RawStudent[] = [];
  sheet.slice(headerIndex + 1).forEach((r, i) => {
    if (!r.some((c) => String(c ?? "").trim() !== "")) return;
    const names =
      cols.firstName !== undefined || cols.lastName !== undefined
        ? {
            firstName: tidyName(cell(r, cols.firstName)),
            lastName: tidyName(cell(r, cols.lastName)),
            otherNames: tidyName(cell(r, cols.otherNames)),
          }
        : splitFullName(cell(r, cols.fullName));
    rows.push({
      line: headerIndex + i + 2,
      ...names,
      admissionNo: cell(r, cols.admissionNo),
      className: cell(r, cols.className),
      gender: cell(r, cols.gender),
      dateOfBirth: cell(r, cols.dateOfBirth),
      guardianName: tidyName(cell(r, cols.guardianName)),
      guardianPhone: cell(r, cols.guardianPhone),
    });
  });
  return { rows, missingColumns };
}

// ─── Matching classes ────────────────────────────────────────────────────────

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "J.S.S 3 B" → "JSS3B", "js3b" → "JSS3B", "SSS 2 Sci" → "SS2SCI" */
export function canonicalClass(s: string): string {
  const q = squash(s);
  const m = /^(JSS|JS|J)([1-3])(.*)$/.exec(q) ?? /^(SSS|SS|S)([1-3])(.*)$/.exec(q);
  if (!m) return q;
  return `${m[1].startsWith("J") ? "JSS" : "SS"}${m[2]}${m[3]}`;
}

export type ClassMatch =
  | { kind: "exact"; arm: Arm }
  | { kind: "suggest"; arm: Arm }
  | { kind: "choose"; options: Arm[] }
  | { kind: "none" };

export function matchClass(input: string, arms: Arm[]): ClassMatch {
  if (!input.trim()) return { kind: "none" };
  const raw = squash(input);
  const exact = arms.find((a) => squash(a.name) === raw);
  if (exact) return { kind: "exact", arm: exact };

  const canon = canonicalClass(input);
  const byCanon = arms.filter((a) => canonicalClass(a.name) === canon);
  if (byCanon.length === 1) return { kind: "suggest", arm: byCanon[0] };

  // Abbreviated arm ("SS1 Sci" → "SS1 Science").
  const level = /^(JSS|SS)[1-3]/.exec(canon)?.[0];
  if (level) {
    const rest = canon.slice(level.length);
    const sameLevel = arms.filter((a) => canonicalClass(a.name).startsWith(level));
    if (rest) {
      const prefixed = sameLevel.filter((a) => canonicalClass(a.name).slice(level.length).startsWith(rest));
      if (prefixed.length === 1) return { kind: "suggest", arm: prefixed[0] };
    }
    if (sameLevel.length === 1) return { kind: "suggest", arm: sameLevel[0] };
    if (sameLevel.length > 1) return { kind: "choose", options: sameLevel };
  }
  return { kind: "none" };
}

// ─── Other fields ────────────────────────────────────────────────────────────

export function parseGender(s: string): "female" | "male" | "" | null {
  const k = s.trim().toLowerCase();
  if (!k) return "";
  if (["f", "female", "girl", "g"].includes(k)) return "female";
  if (["m", "male", "boy", "b"].includes(k)) return "male";
  return null;
}

/** DD/MM/YYYY (Nigerian default), D-M-YYYY, or YYYY-MM-DD → ISO. Null when unreadable. */
export function parseDate(s: string): string | "" | null {
  const t = s.trim();
  if (!t) return "";
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > new Date().getUTCFullYear()) return null;
  return dt.toISOString().slice(0, 10);
}

/** Keeps digits (and a leading +); "0803 412 7788" → "08034127788". */
export function tidyPhone(s: string): string {
  const t = s.trim();
  return (t.startsWith("+") ? "+" : "") + t.replace(/\D/g, "");
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type CheckContext = {
  arms: Arm[];
  /** Normalised admission numbers already in the school. */
  existingAdmissionNos: Set<string>;
};

export function checkStudents(rows: RawStudent[], ctx: CheckContext): CheckedStudent[] {
  const armById = new Map(ctx.arms.map((a) => [a.id, a]));
  const firstLineFor = new Map<string, number>();

  return rows.map((r) => {
    const issues: Issue[] = [];
    const firstName = r.firstName.trim();
    const lastName = r.lastName.trim();
    const admissionNo = r.admissionNo.trim();

    if (!firstName || !lastName) {
      issues.push({ field: "row", level: "error", message: !firstName && !lastName ? "No name" : "Needs both a first name and a surname" });
    }

    const key = normaliseAdmissionNo(admissionNo);
    if (!admissionNo) {
      issues.push({ field: "admissionNo", level: "error", message: "No admission number" });
    } else if (firstLineFor.has(key)) {
      issues.push({ field: "admissionNo", level: "error", message: `Duplicate of row ${firstLineFor.get(key)}` });
    } else {
      firstLineFor.set(key, r.line);
      if (ctx.existingAdmissionNos.has(key)) {
        issues.push({ field: "admissionNo", level: "skip", message: "Already in SonoCBT — will be skipped" });
      }
    }

    let classArmId: string | null = null;
    if (r.classArmId && armById.has(r.classArmId)) {
      classArmId = r.classArmId;
    } else {
      const m = matchClass(r.className, ctx.arms);
      if (m.kind === "exact") classArmId = m.arm.id;
      else if (m.kind === "suggest")
        issues.push({ field: "className", level: "warning", message: `Class "${r.className}" — did you mean ${m.arm.name}?`, suggestion: m.arm });
      else if (m.kind === "choose")
        issues.push({ field: "className", level: "error", message: `Class "${r.className}" — which arm? (${m.options.map((o) => o.name).join(", ")})` });
      else
        issues.push({
          field: "className",
          level: "error",
          message: r.className ? `Class "${r.className}" isn't set up` : "No class",
        });
    }

    const gender = parseGender(r.gender);
    if (gender === null) issues.push({ field: "gender", level: "warning", message: `Gender "${r.gender}" not recognised — left blank` });

    const dob = parseDate(r.dateOfBirth);
    if (dob === null) issues.push({ field: "dateOfBirth", level: "warning", message: `Date of birth "${r.dateOfBirth}" not recognised — left blank` });

    return {
      ...r,
      firstName,
      lastName,
      otherNames: r.otherNames.trim(),
      admissionNo,
      classArmId,
      gender: gender ?? "",
      dateOfBirth: dob ?? "",
      guardianPhone: tidyPhone(r.guardianPhone),
      issues,
    };
  });
}

export type ImportSummary = { total: number; ready: number; needsLook: number; blocked: number; skipped: number };

export function summarise(rows: CheckedStudent[]): ImportSummary {
  let ready = 0,
    needsLook = 0,
    blocked = 0,
    skipped = 0;
  for (const r of rows) {
    if (r.issues.some((i) => i.level === "skip")) skipped++;
    else if (r.issues.some((i) => i.level === "error")) blocked++;
    else if (r.issues.some((i) => i.level === "warning" && i.suggestion)) needsLook++;
    else ready++;
  }
  return { total: rows.length, ready, needsLook, blocked, skipped };
}

/** Rows that can be imported as they stand (warnings without a pending class suggestion are fine). */
export function isImportable(r: CheckedStudent): boolean {
  return !!r.classArmId && !r.issues.some((i) => i.level === "error" || i.level === "skip");
}

/** CSV template columns, in order. */
export const TEMPLATE_HEADERS = [
  "Surname",
  "First name",
  "Other names",
  "Admission number",
  "Class",
  "Gender",
  "Date of birth",
  "Guardian name",
  "Guardian phone",
] as const;
