/**
 * Students sign in with an admission number that is only unique inside a school,
 * while Better Auth usernames are global. The stored username is therefore
 * "<schoolId>|<normalised admission no>".
 */
export function normaliseAdmissionNo(admissionNo: string): string {
  return admissionNo.trim().replace(/\s+/g, "").toUpperCase();
}

export function studentUsername(schoolId: string, admissionNo: string): string {
  return `${schoolId}|${normaliseAdmissionNo(admissionNo)}`.toLowerCase();
}

/** Students have no email; Better Auth requires one, so they get an unroutable placeholder. */
export function studentPlaceholderEmail(schoolId: string, admissionNo: string): string {
  const local = normaliseAdmissionNo(admissionNo).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${local}.${schoolId}@students.sonocbt.invalid`;
}
