import { describe, expect, it } from "vitest";
import { can, type Actor } from "./permissions";

const A = "school-a";
const B = "school-b";

const admin: Actor = { id: "u-admin", roles: [{ role: "school_admin", schoolId: A }] };
const teacher: Actor = {
  id: "u-teacher",
  roles: [
    { role: "teacher", schoolId: A },
    { role: "form_teacher", schoolId: A, classArmId: "jss3b" },
  ],
};
const hod: Actor = { id: "u-hod", roles: [{ role: "hod", schoolId: A, departmentId: "sciences" }] };
const officer: Actor = { id: "u-officer", roles: [{ role: "exam_officer", schoolId: A }] };
const studentActor: Actor = { id: "u-student", studentId: "s-1", roles: [{ role: "student", schoolId: A }] };
const owner: Actor = { id: "u-owner", roles: [{ role: "platform_owner", schoolId: null }] };

describe("can()", () => {
  it("denies anonymous users", () => {
    expect(can(null, "results.view", { schoolId: A })).toBe(false);
  });

  it("never crosses schools, whatever the role", () => {
    for (const actor of [admin, teacher, hod, officer, studentActor]) {
      expect(can(actor, "results.release", { schoolId: B })).toBe(false);
      expect(can(actor, "question.create", { schoolId: B })).toBe(false);
      expect(can(actor, "results.view", { schoolId: B, studentId: "s-1", classArmId: "jss3b" })).toBe(false);
    }
  });

  it("lets the school admin release results and manage billing", () => {
    expect(can(admin, "results.release", { schoolId: A })).toBe(true);
    expect(can(admin, "billing.manage", { schoolId: A })).toBe(true);
    expect(can(admin, "exam.take", { schoolId: A, studentId: "s-1" })).toBe(false);
  });

  it("does not let exam officers release results or touch billing", () => {
    expect(can(officer, "results.review", { schoolId: A })).toBe(true);
    expect(can(officer, "results.release", { schoolId: A })).toBe(false);
    expect(can(officer, "billing.manage", { schoolId: A })).toBe(false);
  });

  it("scopes HODs to their department", () => {
    expect(can(hod, "question.approve", { schoolId: A, departmentId: "sciences" })).toBe(true);
    expect(can(hod, "question.approve", { schoolId: A, departmentId: "arts" })).toBe(false);
  });

  it("lets teachers enter marks only for their own subject offerings", () => {
    expect(can(teacher, "marks.enter", { schoolId: A, teacherId: "u-teacher" })).toBe(true);
    expect(can(teacher, "marks.enter", { schoolId: A, teacherId: "someone-else" })).toBe(false);
    expect(can(teacher, "question.approve", { schoolId: A })).toBe(false);
  });

  it("combines roles: a teacher who is also form teacher writes remarks for their arm only", () => {
    expect(can(teacher, "reportCard.remarks", { schoolId: A, classArmId: "jss3b" })).toBe(true);
    expect(can(teacher, "reportCard.remarks", { schoolId: A, classArmId: "jss3a" })).toBe(false);
  });

  it("lets students take their own exams and see only their own results", () => {
    expect(can(studentActor, "exam.take", { schoolId: A, studentId: "s-1" })).toBe(true);
    expect(can(studentActor, "results.view", { schoolId: A, studentId: "s-2" })).toBe(false);
  });

  it("keeps the platform owner out of school data", () => {
    expect(can(owner, "platform.manage", { schoolId: A })).toBe(true);
    expect(can(owner, "results.view", { schoolId: A, studentId: "s-1" })).toBe(false);
  });
});
