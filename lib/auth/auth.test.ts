import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb } from "@/test/db";
import { PASSWORD, seedSchoolFixture } from "@/test/fixtures";
import { createAuth, type Auth } from "./auth";
import { studentUsername } from "./student-username";

let db: Db;
let auth: Auth;
let a: Awaited<ReturnType<typeof seedSchoolFixture>>;
let b: Awaited<ReturnType<typeof seedSchoolFixture>>;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  db = await createTestDb();
  auth = createAuth(db);
  a = await seedSchoolFixture(db, "a");
  b = await seedSchoolFixture(db, "b");
});

const schoolIdOf = (u: unknown) => (u as { schoolId?: string | null }).schoolId;

describe("logins across two schools", () => {
  it("staff sign in with email and belong to their own school", async () => {
    for (const s of [a, b]) {
      const res = await auth.api.signInEmail({ body: { email: s.staff.email, password: PASSWORD } });
      expect(res.user.id).toBe(s.staff.id);
      expect(schoolIdOf(res.user)).toBe(s.school.id);
    }
  });

  it("students sign in with the same admission number in each school", async () => {
    for (const [s, tag] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const res = await auth.api.signInUsername({
        body: { username: studentUsername(s.school.id, "GFA/2021/0147"), password: `${PASSWORD}-${tag}` },
      });
      expect(res?.user.id).toBe(s.student.userId);
      expect(schoolIdOf(res?.user)).toBe(s.school.id);
    }
  });

  it("a student's password does not work at the other school", async () => {
    await expect(
      auth.api.signInUsername({
        body: { username: studentUsername(b.school.id, "GFA/2021/0147"), password: `${PASSWORD}-a` },
      }),
    ).rejects.toThrow();
  });

  it("matches admission numbers case- and space-insensitively", async () => {
    const res = await auth.api.signInUsername({
      body: { username: studentUsername(a.school.id, " gfa/2021/0147 "), password: `${PASSWORD}-a` },
    });
    expect(res?.user.id).toBe(a.student.userId);
  });

  it("has public sign-up disabled", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "X", email: "x@x.test", password: "password1234" } }),
    ).rejects.toThrow();
  });
});
