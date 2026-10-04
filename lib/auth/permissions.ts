/**
 * The single permission check for SonoCBT. Pure and synchronous: callers load
 * the user's roles (getTenantContext does) and describe the resource.
 */

export type Role =
  | "platform_owner"
  | "school_admin"
  | "exam_officer"
  | "hod"
  | "teacher"
  | "form_teacher"
  | "student"
  | "parent";

export type Action =
  // platform
  | "platform.manage"
  | "platform.impersonate"
  // school administration
  | "school.manage"
  | "billing.manage"
  | "staff.manage"
  | "student.manage"
  | "student.resetPassword"
  | "resultPins.manage"
  // questions & exams
  | "question.create"
  | "question.approve"
  | "exam.manage"
  | "exam.monitor"
  // marks & results
  | "marks.enter"
  | "marks.moderate"
  | "results.review"
  | "results.release"
  | "reportCard.remarks"
  | "analytics.view"
  // students & parents
  | "exam.take"
  | "results.view";

export type RoleGrant = {
  role: Role;
  /** Null only for platform_owner. */
  schoolId: string | null;
  /** HOD scope. */
  departmentId?: string | null;
  /** Form-teacher scope. */
  classArmId?: string | null;
};

export type Actor = {
  id: string;
  roles: RoleGrant[];
  /** Set when the actor is a student. */
  studentId?: string | null;
  /** Set for parent accounts. */
  linkedStudentIds?: string[];
};

export type Resource = {
  schoolId: string;
  departmentId?: string | null;
  classArmId?: string | null;
  /** Teacher assigned to the subject offering the resource belongs to. */
  teacherId?: string | null;
  studentId?: string | null;
};

const ADMIN_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "school.manage",
  "billing.manage",
  "staff.manage",
  "student.manage",
  "student.resetPassword",
  "resultPins.manage",
  "question.create",
  "question.approve",
  "exam.manage",
  "exam.monitor",
  "marks.enter",
  "marks.moderate",
  "results.review",
  "results.release",
  "reportCard.remarks",
  "analytics.view",
  "results.view",
]);

const EXAM_OFFICER_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "question.create",
  "question.approve",
  "exam.manage",
  "exam.monitor",
  "marks.moderate",
  "results.review",
  "analytics.view",
]);

function grantAllows(grant: RoleGrant, actor: Actor, action: Action, r: Resource): boolean {
  if (grant.role === "platform_owner") {
    return action === "platform.manage" || action === "platform.impersonate";
  }
  // Every other role is bound to exactly one school.
  if (!grant.schoolId || grant.schoolId !== r.schoolId) return false;

  switch (grant.role) {
    case "school_admin":
      return ADMIN_ACTIONS.has(action);

    case "exam_officer":
      return EXAM_OFFICER_ACTIONS.has(action);

    case "hod":
      if (!EXAM_OFFICER_ACTIONS.has(action)) return false;
      // An HOD scoped to a department only acts on that department's resources.
      if (grant.departmentId && r.departmentId && grant.departmentId !== r.departmentId) return false;
      if (grant.departmentId && !r.departmentId && action !== "question.create") return false;
      return true;

    case "teacher":
      if (action === "question.create") return true;
      if (action === "marks.enter" || action === "analytics.view") {
        return !!r.teacherId && r.teacherId === actor.id;
      }
      return false;

    case "form_teacher":
      if (action === "reportCard.remarks" || action === "results.view" || action === "student.resetPassword") {
        return !!grant.classArmId && grant.classArmId === r.classArmId;
      }
      return false;

    case "student":
      if (action === "exam.take" || action === "results.view") {
        return !!actor.studentId && actor.studentId === r.studentId;
      }
      return false;

    case "parent":
      if (action === "results.view") {
        return !!r.studentId && (actor.linkedStudentIds ?? []).includes(r.studentId);
      }
      return false;
  }
}

export function can(actor: Actor | null | undefined, action: Action, resource: Resource): boolean {
  if (!actor) return false;
  return actor.roles.some((g) => grantAllows(g, actor, action, resource));
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.some((g) => g.role === role);
}

export const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  "school_admin",
  "exam_officer",
  "hod",
  "teacher",
  "form_teacher",
]);

export const ROLE_LABEL: Record<Role, string> = {
  platform_owner: "Platform owner",
  school_admin: "School admin",
  exam_officer: "Exam officer",
  hod: "Head of department",
  teacher: "Teacher",
  form_teacher: "Form teacher",
  student: "Student",
  parent: "Parent",
};
