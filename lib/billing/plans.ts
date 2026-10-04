/**
 * Plans and what each unlocks. Prices are placeholders (the marketing
 * design's figures), in naira per student per term; change them here.
 * No server imports: the billing page uses this too.
 */

export type PlanCode = "starter" | "standard" | "premium";

/** Features beyond the core (CBT exams, question bank, CA grid, broadsheet, release, parent checker). */
export type Feature = "report_cards" | "analytics" | "smart_import" | "photo_import" | "ai_assistant" | "snapshots";

export const FEATURE_LABEL: Record<Feature, string> = {
  report_cards: "PDF report cards",
  analytics: "Analytics",
  smart_import: "Smart import from Word and Excel",
  photo_import: "Photo import",
  ai_assistant: "AI assistant and AI marking suggestions",
  snapshots: "Webcam identity photos",
};

export type Plan = { code: PlanCode; name: string; naira: number; blurb: string; features: Feature[]; includes: string[] };

export const PLANS: Plan[] = [
  {
    code: "starter",
    name: "Starter",
    naira: 500,
    blurb: "CBT exams and results.",
    features: [],
    includes: ["Unlimited CBT exams and practice tests", "Question bank with maths and images", "Offline-safe exam runtime and live monitor", "CA grid, broadsheet and positions", "Result release, parent result checker and PIN cards"],
  },
  {
    code: "standard",
    name: "Standard",
    naira: 900,
    blurb: "Everything in Starter, plus report cards and analytics.",
    features: ["report_cards", "analytics"],
    includes: ["A4 PDF report cards with QR verification", "Remarks, ratings and attendance", "Exam, topic and school analytics"],
  },
  {
    code: "premium",
    name: "Premium",
    naira: 1400,
    blurb: "Everything in Standard, plus smart import, AI and identity photos.",
    features: ["report_cards", "analytics", "smart_import", "photo_import", "ai_assistant", "snapshots"],
    includes: ["Smart import from Word, Excel and photos", "AI question assistant", "AI marking suggestions for theory", "Webcam identity photos during exams"],
  },
];

export const planByCode = (code: PlanCode) => PLANS.find((p) => p.code === code)!;

/** The cheapest plan with a feature. */
export const planFor = (f: Feature) => PLANS.find((p) => p.features.includes(f))!;

export const TRIAL_DAYS = 30;
/** Days to pay after a trial ends or a new term starts, with a banner, before paid features stop. */
export const GRACE_DAYS = 14;

export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
