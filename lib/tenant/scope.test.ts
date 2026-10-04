import { eq, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { createTestDb } from "@/test/db";
import { seedSchoolFixture, TENANT_TABLES } from "@/test/fixtures";
import { tenantScope, type TenantTable } from "./scope";

let db: Db;
let a: Awaited<ReturnType<typeof seedSchoolFixture>>;
let b: Awaited<ReturnType<typeof seedSchoolFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedSchoolFixture(db, "a");
  b = await seedSchoolFixture(db, "b");
});

type Key = keyof typeof TENANT_TABLES;
const entries = Object.entries(TENANT_TABLES) as [Key, TenantTable][];
const idOf = (table: TenantTable) => (table as unknown as { id: typeof schema.school.id }).id;

describe("tenant isolation", () => {
  it("covers every table with a required school_id column", () => {
    const tenantOwned = (Object.values(schema) as unknown[])
      .filter((v): v is PgTable => is(v, PgTable))
      .filter((tbl) => getTableConfig(tbl).columns.some((c) => c.name === "school_id" && c.notNull))
      .map((tbl) => getTableName(tbl))
      .sort();
    const covered = entries.map(([, tbl]) => getTableName(tbl)).sort();
    expect(covered).toEqual(tenantOwned);
  });

  describe.each(entries)("%s", (key, table) => {
    it("lists only the caller's school rows", async () => {
      const rows = (await tenantScope(db, a.school.id).findMany(table)) as { id: string; schoolId: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.schoolId === a.school.id)).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(b.ids[key]);
    });

    it("cannot read another school's row by id", async () => {
      const row = await tenantScope(db, a.school.id).findFirst(table, eq(idOf(table), b.ids[key]));
      expect(row).toBeUndefined();
    });

    it("cannot update another school's row", async () => {
      const rows = await tenantScope(db, a.school.id).update(
        table,
        { updatedAt: new Date(0) } as never,
        eq(idOf(table), b.ids[key]),
      );
      expect(rows).toHaveLength(0);
      const still = await tenantScope(db, b.school.id).findFirst(table, eq(idOf(table), b.ids[key]));
      expect((still as { updatedAt: Date }).updatedAt.getTime()).not.toBe(0);
    });

    it("cannot delete another school's row", async () => {
      const n = await tenantScope(db, a.school.id).delete(table, eq(idOf(table), b.ids[key]));
      expect(n).toBe(0);
      expect(await tenantScope(db, b.school.id).findFirst(table, eq(idOf(table), b.ids[key]))).toBeDefined();
    });
  });

  it("forces the scope's schoolId on insert, even if the caller passes another", async () => {
    const [row] = await tenantScope(db, a.school.id).insert(schema.department, {
      name: "Arts",
      schoolId: b.school.id,
    } as never);
    expect(row.schoolId).toBe(a.school.id);
  });

  it("ignores schoolId in an update patch", async () => {
    const [row] = await tenantScope(db, a.school.id).update(
      schema.subject,
      { name: "Maths", schoolId: b.school.id } as never,
      eq(schema.subject.id, a.ids.subject),
    );
    expect(row.schoolId).toBe(a.school.id);
    expect(row.name).toBe("Maths");
  });
});
