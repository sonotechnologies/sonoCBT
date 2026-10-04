import type { IntegritySettings } from "@/lib/db/schema";

/** What each integrity preset switches on (see the build brief, module 6). */
export const PRESETS: Record<"practice" | "standard" | "strict", IntegritySettings> = {
  practice: { fullscreen: "off", logTabSwitches: true, warnOnLeave: false, blockCopy: false, oneDevice: false, submitAfterLeaves: null, snapshot: false },
  standard: { fullscreen: "prompt", logTabSwitches: true, warnOnLeave: true, blockCopy: true, oneDevice: true, submitAfterLeaves: null, snapshot: false },
  strict: { fullscreen: "required", logTabSwitches: true, warnOnLeave: true, blockCopy: true, oneDevice: true, submitAfterLeaves: 3, snapshot: false },
};
