import { and, eq, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db/client";

/** Any table that carries a `schoolId` column. */
export type TenantTable = PgTable & { schoolId: AnyPgColumn };

export type Owns = <T extends TenantTable>(table: T, where?: SQL) => SQL;

type Row<T extends TenantTable> = InferSelectModel<T>;
// Key remapping instead of Omit: Omit over a generic insert model drops the optional columns.
type Without<M, K extends PropertyKey> = { [P in keyof M as P extends K ? never : P]: M[P] };
type NewRow<T extends TenantTable> = Without<InferInsertModel<T>, "schoolId">;
type Patch<T extends TenantTable> = Partial<Without<InferInsertModel<T>, "schoolId" | "id">>;

/**
 * The only way app code touches tenant-owned tables. Every read, write and
 * delete is pinned to one school; `schoolId` comes from the server-side session
 * (see getTenantContext), never from the client.
 */
export function tenantScope(db: Db, schoolId: string): TenantScopeApi {
  /** `table.schoolId = <this school>`, AND-ed with an optional extra condition. */
  const owns: Owns = (table, where) =>
    (where ? and(eq(table.schoolId, schoolId), where) : eq(table.schoolId, schoolId)) as SQL;

  return {
    schoolId,
    owns,

    async findMany<T extends TenantTable>(table: T, where?: SQL): Promise<Row<T>[]> {
      // Drizzle's generic select types don't survive a table type parameter; the cast is sound.
      return (await db
        .select()
        .from(table as PgTable)
        .where(owns(table, where))) as Row<T>[];
    },

    async findFirst<T extends TenantTable>(table: T, where?: SQL): Promise<Row<T> | undefined> {
      const rows = (await db
        .select()
        .from(table as PgTable)
        .where(owns(table, where))
        .limit(1)) as Row<T>[];
      return rows[0];
    },

    async insert<T extends TenantTable>(table: T, values: NoInfer<NewRow<T> | NewRow<T>[]>): Promise<Row<T>[]> {
      const list = (Array.isArray(values) ? values : [values]).map((v) => ({ ...v, schoolId }));
      if (list.length === 0) return [];
      return (await db
        .insert(table)
        .values(list as InferInsertModel<T>[])
        .returning()) as Row<T>[];
    },

    async update<T extends TenantTable>(table: T, set: NoInfer<Patch<T>>, where: SQL): Promise<Row<T>[]> {
      const safe: Record<string, unknown> = { ...set };
      delete safe.schoolId; // a row can never be moved to another school
      return (await db
        .update(table)
        .set(safe as never)
        .where(owns(table, where))
        .returning()) as Row<T>[];
    },

    async delete<T extends TenantTable>(table: T, where: SQL): Promise<number> {
      const rows = await db.delete(table).where(owns(table, where)).returning();
      return (rows as unknown[]).length;
    },

    /**
     * Escape hatch for joins and aggregates. The callback MUST apply `owns()`
     * to every tenant table it reads; lib/tenant/scope.test.ts covers each entity.
     */
    query<R>(fn: (db: Db, owns: Owns) => Promise<R>): Promise<R> {
      return fn(db, owns);
    },

    /** Runs `fn` in a database transaction with a scope pinned to the same school. */
    transaction<R>(fn: (tx: TenantScope) => Promise<R>): Promise<R> {
      return db.transaction((tx) => fn(tenantScope(tx as unknown as Db, schoolId)));
    },
  };
}

type TenantScopeApi = {
  schoolId: string;
  owns: Owns;
  findMany<T extends TenantTable>(table: T, where?: SQL): Promise<Row<T>[]>;
  findFirst<T extends TenantTable>(table: T, where?: SQL): Promise<Row<T> | undefined>;
  insert<T extends TenantTable>(table: T, values: NoInfer<NewRow<T> | NewRow<T>[]>): Promise<Row<T>[]>;
  update<T extends TenantTable>(table: T, set: NoInfer<Patch<T>>, where: SQL): Promise<Row<T>[]>;
  delete<T extends TenantTable>(table: T, where: SQL): Promise<number>;
  query<R>(fn: (db: Db, owns: Owns) => Promise<R>): Promise<R>;
  transaction<R>(fn: (tx: TenantScope) => Promise<R>): Promise<R>;
};

export type TenantScope = TenantScopeApi;
