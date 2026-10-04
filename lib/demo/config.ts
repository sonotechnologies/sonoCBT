/**
 * The public demo school (Crestview Model College). Its sign-ins are meant to
 * be public: the demo page signs visitors in with one click. Everything in it
 * is rebuilt every night (app/api/cron/reset-demo).
 */
export const DEMO_SLUG = "crestview";
export const DEMO_STAFF_PASSWORD = "crestview-demo-2026";
export const DEMO_STUDENT_PASSWORD = "crestview-student";

export const DEMO_PEOPLE = {
  admin: { email: "principal@crestview.edu.ng", name: "Mrs. Folake Adeyemi" },
  examOfficer: { email: "exams@crestview.edu.ng", name: "Mr. Kunle Ajayi" },
  teacher: { email: "e.nwosu@crestview.edu.ng", name: "Mr. Emeka Nwosu" },
} as const;

/** The released student whose report card the "Parent" card opens. */
export const DEMO_PARENT_CHILD = "CMC/2023/0101";

/** One-click demo sign-in is on in development, and in production only with DEMO_MODE=1. */
export function demoEnabled(): boolean {
  return process.env.DEMO_MODE === "1" || (process.env.NODE_ENV !== "production" && process.env.DEMO_MODE !== "0");
}
