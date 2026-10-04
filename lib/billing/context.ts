import "server-only";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { billingState } from "./state";

/** The school's billing state, worked out once per request. */
export const getBilling = cache((schoolId: string) => billingState(getDb(), schoolId));
