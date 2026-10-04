import "server-only";
import { getDb } from "@/lib/db";
import { createAuth, type Auth } from "./auth";

const globalForAuth = globalThis as unknown as { __sonoAuth?: Auth };

export function getAuth(): Auth {
  return (globalForAuth.__sonoAuth ??= createAuth(getDb()));
}
