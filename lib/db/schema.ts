import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
/** Every tenant-owned table carries this column. Read/write it only through lib/tenant. */
const tenant = () =>
  uuid("school_id")
    .notNull()
    .references(() => school.id, { onDelete: "cascade" });

// ─── Platform ────────────────────────────────────────────────────────────────

export const schoolStatus = pgEnum("school_status", ["trial", "active", "grace", "suspended"]);
export const planCode = pgEnum("plan_code", ["starter", "standard", "premium"]);

export const school = pgTable("school", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Area shown after the name, e.g. "Lekki". */
  locality: text("locality"),
  address: text("address"),
  state: text("state"),
  phone: text("phone"),
  email: text("email"),
  principalName: text("principal_name"),
  motto: text("motto"),
  logoUrl: text("logo_url"),
  /** PNG/JPG of the principal's signature, printed on report cards. */
  principalSignatureUrl: text("principal_signature_url"),
  /** School brand colour — report cards and school login header only. */
  brandColor: text("brand_color"),
  plan: planCode("plan").notNull().default("starter"),
  status: schoolStatus("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Set when the admin finishes (or skips through) the onboarding wizard. */
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  ...timestamps,
});

// ─── Auth (Better Auth core tables + app fields) ────────────────────────────

export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Students only: "<schoolId>|<admission no>", see lib/auth/student-username.ts */
  username: text("username").unique(),
  displayUsername: text("display_username"),
  /** Null for platform owners. */
  schoolId: uuid("school_id").references(() => school.id, { onDelete: "cascade" }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** Better Auth admin plugin: "admin" only for platform owners (support sign-in). */
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Set while a platform owner is signed in as this user for support. */
    impersonatedBy: text("impersonated_by"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ─── Roles ───────────────────────────────────────────────────────────────────

export const roleName = pgEnum("role_name", [
  "platform_owner",
  "school_admin",
  "exam_officer",
  "hod",
  "teacher",
  "form_teacher",
  "student",
  "parent",
]);

/** A user can hold several roles; department/class-arm narrow the scope where relevant. */
export const userRole = pgTable(
  "user_role",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null only for platform_owner. */
    schoolId: uuid("school_id").references(() => school.id, { onDelete: "cascade" }),
    role: roleName("role").notNull(),
    departmentId: uuid("department_id").references(() => department.id, { onDelete: "cascade" }),
    classArmId: uuid("class_arm_id").references(() => classArm.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("user_role_user_idx").on(t.userId)],
);

// ─── School structure ────────────────────────────────────────────────────────

export const academicSession = pgTable(
  "academic_session",
  {
    id: id(),
    schoolId: tenant(),
    /** "2025/2026" */
    name: text("name").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    isCurrent: boolean("is_current").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("academic_session_school_name_uq").on(t.schoolId, t.name)],
);

export const term = pgTable(
  "term",
  {
    id: id(),
    schoolId: tenant(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => academicSession.id, { onDelete: "cascade" }),
    /** 1, 2 or 3 */
    number: smallint("number").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    nextResumesOn: date("next_resumes_on"),
    isCurrent: boolean("is_current").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("term_session_number_uq").on(t.sessionId, t.number)],
);

export const classLevel = pgTable(
  "class_level",
  {
    id: id(),
    schoolId: tenant(),
    /** JSS1…SS3 */
    code: text("code").notNull(),
    sortOrder: smallint("sort_order").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("class_level_school_code_uq").on(t.schoolId, t.code)],
);

export const classArm = pgTable(
  "class_arm",
  {
    id: id(),
    schoolId: tenant(),
    classLevelId: uuid("class_level_id")
      .notNull()
      .references(() => classLevel.id, { onDelete: "cascade" }),
    /** "JSS3B", "SS2 Science" */
    name: text("name").notNull(),
    formTeacherId: uuid("form_teacher_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("class_arm_school_name_uq").on(t.schoolId, t.name)],
);

export const department = pgTable("department", {
  id: id(),
  schoolId: tenant(),
  name: text("name").notNull(),
  hodUserId: uuid("hod_user_id").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

export const subject = pgTable(
  "subject",
  {
    id: id(),
    schoolId: tenant(),
    name: text("name").notNull(),
    /** Used where space is tight, e.g. "Maths", "Civic". */
    shortName: text("short_name"),
    code: text("code"),
    /** Which classes take it: JSS only, SS only, or both. */
    stage: text("stage", { enum: ["jss", "ss", "all"] }).notNull().default("all"),
    /** School's own subject order on report cards and broadsheets. */
    sortOrder: smallint("sort_order").notNull().default(0),
    departmentId: uuid("department_id").references(() => department.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("subject_school_name_uq").on(t.schoolId, t.name)],
);

export const subjectOffering = pgTable(
  "subject_offering",
  {
    id: id(),
    schoolId: tenant(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    classArmId: uuid("class_arm_id")
      .notNull()
      .references(() => classArm.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("subject_offering_uq").on(t.subjectId, t.classArmId)],
);

export const staffProfile = pgTable(
  "staff_profile",
  {
    id: id(),
    schoolId: tenant(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "Mrs.", "Mr.", "Dr." */
    title: text("title"),
    phone: text("phone"),
    ...timestamps,
  },
  (t) => [uniqueIndex("staff_profile_user_uq").on(t.userId)],
);

export const gender = pgEnum("gender", ["female", "male"]);

/** Active students are on a class register; graduated and left ones keep their records but no class or sign-in. */
export const studentStatus = pgEnum("student_status", ["active", "graduated", "left"]);

export const student = pgTable(
  "student",
  {
    id: id(),
    schoolId: tenant(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    admissionNo: text("admission_no").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    otherNames: text("other_names"),
    gender: gender("gender"),
    dateOfBirth: date("date_of_birth"),
    photoUrl: text("photo_url"),
    classArmId: uuid("class_arm_id").references(() => classArm.id, { onDelete: "set null" }),
    guardianName: text("guardian_name"),
    guardianPhone: text("guardian_phone"),
    status: studentStatus("status").notNull().default("active"),
    /** When a student graduated or left, and why (e.g. "Moved to another school"). */
    leftOn: date("left_on"),
    leftReason: text("left_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("student_school_admission_uq").on(t.schoolId, t.admissionNo),
    index("student_class_arm_idx").on(t.classArmId),
  ],
);

export const enrollment = pgTable(
  "enrollment",
  {
    id: id(),
    schoolId: tenant(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    classArmId: uuid("class_arm_id")
      .notNull()
      .references(() => classArm.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("enrollment_student_term_uq").on(t.studentId, t.termId)],
);

/** A pending staff invitation. The token is emailed; only its hash is stored. */
export const staffInvite = pgTable(
  "staff_invite",
  {
    id: id(),
    schoolId: tenant(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    title: text("title"),
    /** Role grants applied on acceptance. */
    roles: jsonb("roles")
      .$type<{ role: "school_admin" | "exam_officer" | "hod" | "teacher" | "form_teacher"; departmentId?: string; classArmId?: string }[]>()
      .notNull(),
    /** Subjects this person teaches; unassigned offerings of these subjects go to them on acceptance. */
    subjectIds: jsonb("subject_ids").$type<string[]>().notNull().default([]),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => user.id, { onDelete: "set null" }),
    invitedBy: uuid("invited_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("staff_invite_token_uq").on(t.tokenHash), index("staff_invite_school_email_idx").on(t.schoolId, t.email)],
);

// ─── Question bank (Phase 2) ─────────────────────────────────────────────────

/** Tiptap / ProseMirror JSON document. */
export type RichDoc = { type: "doc"; content?: unknown[] };

export const questionType = pgEnum("question_type", [
  "mcq_single",
  "mcq_multi",
  "true_false",
  "fill_blank",
  "numeric",
  "theory",
]);
export const questionStatus = pgEnum("question_status", ["draft", "pending", "returned", "approved", "archived"]);
export const questionSource = pgEnum("question_source", ["manual", "word", "photo", "ai", "sheet"]);
export const difficulty = pgEnum("difficulty", ["easy", "medium", "hard"]);

export const topic = pgTable(
  "topic",
  {
    id: id(),
    schoolId: tenant(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    classLevelId: uuid("class_level_id").references(() => classLevel.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [index("topic_subject_idx").on(t.schoolId, t.subjectId)],
);

/** Comprehension passage; many questions point at one passage and always stay together. */
export const passage = pgTable("passage", {
  id: id(),
  schoolId: tenant(),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subject.id, { onDelete: "cascade" }),
  classLevelId: uuid("class_level_id").references(() => classLevel.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  content: jsonb("content").$type<RichDoc>().notNull(),
  contentText: text("content_text").notNull().default(""),
  authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});

/** Type-specific answer data. Never sent to students before submission. */
export type QuestionAnswer =
  | { kind: "mcq_single" }
  | { kind: "mcq_multi"; scoring: "all_or_nothing" | "partial" }
  | { kind: "true_false"; correct: boolean }
  | { kind: "fill_blank"; accepted: string[]; caseSensitive: boolean }
  | { kind: "numeric"; value: number; tolerance: number }
  | { kind: "theory"; markingGuide: RichDoc | null };

export const question = pgTable(
  "question",
  {
    id: id(),
    schoolId: tenant(),
    /** Per-subject running number; shown as e.g. CHM-0412. */
    number: integer("number").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "restrict" }),
    classLevelId: uuid("class_level_id").references(() => classLevel.id, { onDelete: "set null" }),
    topicId: uuid("topic_id").references(() => topic.id, { onDelete: "set null" }),
    passageId: uuid("passage_id").references(() => passage.id, { onDelete: "set null" }),
    type: questionType("type").notNull(),
    stem: jsonb("stem").$type<RichDoc>().notNull(),
    /** Plain text of the stem (maths as LaTeX) for search, lists and duplicate checks. */
    stemText: text("stem_text").notNull(),
    answer: jsonb("answer").$type<QuestionAnswer>().notNull(),
    marks: numeric("marks", { precision: 5, scale: 2, mode: "number" }).notNull().default(1),
    difficulty: difficulty("difficulty").notNull().default("medium"),
    status: questionStatus("status").notNull().default("draft"),
    source: questionSource("source").notNull().default("manual"),
    authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Why the answer is right (AI-written questions; shown to teachers). */
    explanation: text("explanation"),
    reviewComment: text("review_comment"),
    reviewedBy: uuid("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("question_subject_number_uq").on(t.schoolId, t.subjectId, t.number),
    index("question_bank_idx").on(t.schoolId, t.subjectId, t.classLevelId, t.status),
    index("question_search_idx").using("gin", sql`to_tsvector('english', ${t.stemText})`),
  ],
);

export const questionOption = pgTable(
  "question_option",
  {
    id: id(),
    schoolId: tenant(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    /** A–F */
    label: text("label").notNull(),
    content: jsonb("content").$type<RichDoc>().notNull(),
    contentText: text("content_text").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    sortOrder: smallint("sort_order").notNull(),
    ...timestamps,
  },
  (t) => [index("question_option_question_idx").on(t.questionId)],
);

export const importKind = pgEnum("import_kind", ["word", "photo", "sheet", "ai"]);
export const importStatus = pgEnum("import_status", ["review", "saved", "discarded"]);

/**
 * A smart-import review session: the parsed questions (edited in place until
 * they are added to the bank) and, for Word files, the original as HTML.
 */
export const importJob = pgTable(
  "import_job",
  {
    id: id(),
    schoolId: tenant(),
    kind: importKind("kind").notNull(),
    title: text("title").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    classLevelId: uuid("class_level_id").references(() => classLevel.id, { onDelete: "set null" }),
    status: importStatus("status").notNull().default("review"),
    /** ParsedItem[] (lib/import/items.ts) */
    items: jsonb("items").$type<unknown[]>().notNull(),
    /** ParsedPassage[] */
    passages: jsonb("passages").$type<unknown[]>().notNull().default([]),
    /** Original document as sanitised HTML (Word imports). */
    sourceHtml: text("source_html"),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    savedCount: integer("saved_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("import_job_school_idx").on(t.schoolId, t.createdAt)],
);

/** Filled in after each exam (Phase 4+). */
export const questionStats = pgTable(
  "question_stats",
  {
    id: id(),
    schoolId: tenant(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    timesUsed: integer("times_used").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    pctCorrect: numeric("pct_correct", { precision: 5, scale: 2, mode: "number" }),
    discrimination: numeric("discrimination", { precision: 4, scale: 3, mode: "number" }),
    computedDifficulty: difficulty("computed_difficulty"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    likelyWrongKey: boolean("likely_wrong_key").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("question_stats_question_uq").on(t.questionId)],
);

// ─── Exams ───────────────────────────────────────────────────────────────────

export const examType = pgEnum("exam_type", ["ca_test", "exam", "mock", "entrance", "practice"]);
export const examStatus = pgEnum("exam_status", ["draft", "scheduled", "live", "closed"]);
export const integrityPreset = pgEnum("integrity_preset", ["practice", "standard", "strict"]);

/** Per-exam integrity rules. The preset fills these; each can be changed. Enforced from Phase 5. */
export type IntegritySettings = {
  fullscreen: "off" | "prompt" | "required";
  logTabSwitches: boolean;
  warnOnLeave: boolean;
  blockCopy: boolean;
  oneDevice: boolean;
  /** Auto-submit after this many tab switches; null = never. */
  submitAfterLeaves: number | null;
  snapshot: boolean;
  /** Only these networks may sit the exam, e.g. ["102.89.4.0/24"]. Empty or missing = anywhere. */
  allowedIps?: string[];
};

export const exam = pgTable(
  "exam",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    /** Series name, e.g. "JSS3 Mock Examination" */
    series: text("series"),
    /** Short title, e.g. "JSS3 Mock · Paper 1" */
    title: text("title").notNull(),
    /** Long title, e.g. "Paper 1 — English, Mathematics & Basic Science" */
    fullTitle: text("full_title"),
    type: examType("type").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    /** Students can start from here… */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** …until here (null = any time before the window ends). */
    lateEntryUntil: timestamp("late_entry_until", { withTimezone: true }),
    /** Hard end: every attempt's deadline is at most this. */
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    venue: text("venue"),
    instructions: text("instructions"),
    totalMarks: integer("total_marks"),
    calculator: text("calculator", { enum: ["off", "basic", "scientific"] }).notNull().default("off"),
    integrity: integrityPreset("integrity").notNull().default("standard"),
    integritySettings: jsonb("integrity_settings").$type<IntegritySettings>(),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(true),
    shuffleOptions: boolean("shuffle_options").notNull().default(true),
    pinRequired: boolean("pin_required").notNull().default(false),
    graded: boolean("graded").notNull().default(true),
    showScoreAfterSubmit: boolean("show_score_after_submit").notNull().default(false),
    /** When students/parents may see scores (CA tests). Term results use result_batch. */
    scoresReleasedAt: timestamp("scores_released_at", { withTimezone: true }),
    status: examStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** The term's assessment component this exam's scores count towards (e.g. "Exam /60"). */
    componentId: uuid("component_id"),
    /** Offer AI score suggestions to teachers marking theory (never applied automatically). */
    aiMarking: boolean("ai_marking").notNull().default(false),
    /** Last time scores were sent to the CA grid. */
    scoresPushedAt: timestamp("scores_pushed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("exam_school_window_idx").on(t.schoolId, t.windowStart)],
);

export const examSection = pgTable("exam_section", {
  id: id(),
  schoolId: tenant(),
  examId: uuid("exam_id")
    .notNull()
    .references(() => exam.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** Groups the navigator; null for mixed sections. */
  subjectId: uuid("subject_id").references(() => subject.id, { onDelete: "set null" }),
  sortOrder: smallint("sort_order").notNull(),
  /** Kept in step with the section's questions (picked + drawn). */
  questionCount: integer("question_count").notNull(),
  marks: integer("marks").notNull(),
  ...timestamps,
});

/** A question the exam officer picked for a section (draft stage). */
export const examSectionItem = pgTable(
  "exam_section_item",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => examSection.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    /** Overrides the question's own marks. */
    marks: numeric("marks", { precision: 5, scale: 2, mode: "number" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("exam_section_item_uq").on(t.sectionId, t.questionId)],
);

/** "Draw 10 random Medium questions from Fractions" (draft stage; drawn at publish). */
export const examDrawRule = pgTable("exam_draw_rule", {
  id: id(),
  schoolId: tenant(),
  examId: uuid("exam_id")
    .notNull()
    .references(() => exam.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id")
    .notNull()
    .references(() => examSection.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => subject.id, { onDelete: "cascade" }),
  classLevelId: uuid("class_level_id").references(() => classLevel.id, { onDelete: "set null" }),
  topicId: uuid("topic_id").references(() => topic.id, { onDelete: "set null" }),
  difficulty: difficulty("difficulty"),
  count: integer("count").notNull(),
  marksEach: numeric("marks_each", { precision: 5, scale: 2, mode: "number" }),
  ...timestamps,
});

/** What a student sees and what marking uses: frozen when the exam is published. */
export type ExamQuestionSnapshot = {
  type: "mcq_single" | "mcq_multi" | "true_false" | "fill_blank" | "numeric" | "theory";
  stem: RichDoc;
  options: { id: string; content: RichDoc; isCorrect: boolean }[];
  answer: QuestionAnswer;
  passage: { id: string; title: string; content: RichDoc } | null;
  code: string;
  topicName: string | null;
};

export const examQuestion = pgTable(
  "exam_question",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => examSection.id, { onDelete: "cascade" }),
    /** The bank question it was copied from (kept for stats). */
    questionId: uuid("question_id").references(() => question.id, { onDelete: "set null" }),
    /** Whose marks these are when scores go to the CA grid (multi-subject papers). */
    subjectId: uuid("subject_id").references(() => subject.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull(),
    marks: numeric("marks", { precision: 5, scale: 2, mode: "number" }).notNull(),
    snapshot: jsonb("snapshot").$type<ExamQuestionSnapshot>().notNull(),
    ...timestamps,
  },
  (t) => [index("exam_question_exam_idx").on(t.examId, t.sortOrder)],
);

export const examSubject = pgTable(
  "exam_subject",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    sortOrder: smallint("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("exam_subject_uq").on(t.examId, t.subjectId)],
);

export const examAssignment = pgTable(
  "exam_assignment",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    classArmId: uuid("class_arm_id")
      .notNull()
      .references(() => classArm.id, { onDelete: "cascade" }),
    /** Room for this class, e.g. "ICT Lab 1" (falls back to the exam's venue). */
    venue: text("venue"),
    invigilatorId: uuid("invigilator_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("exam_assignment_uq").on(t.examId, t.classArmId)],
);

/** Seating plan: materialised when an exam is scheduled. */
export const examCandidate = pgTable(
  "exam_candidate",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    seat: text("seat"),
    ...timestamps,
  },
  (t) => [uniqueIndex("exam_candidate_uq").on(t.examId, t.studentId)],
);

/** One-time exam PIN per student (when the exam asks for one). */
export const examPin = pgTable(
  "exam_pin",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash").notNull(),
    /** The PIN encrypted with the server secret, so staff can reprint slips. */
    pinSealed: text("pin_sealed").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("exam_pin_uq").on(t.examId, t.studentId)],
);

export const attemptStatus = pgEnum("attempt_status", ["in_progress", "submitted", "auto_submitted"]);

/** An answer that reached the server after time ran out; kept for the exam officer, not marked. */
export type LateAnswer = { examQuestionId: string; response: AttemptResponse | null; clientSeq: number; receivedAt: string };

export const attempt = pgTable(
  "attempt",
  {
    id: id(),
    schoolId: tenant(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exam.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Server-authoritative: min(start + duration, window end) + any extra time. */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    status: attemptStatus("status").notNull().default("in_progress"),
    /** exam_question ids in the order this student sees them. */
    questionOrder: jsonb("question_order").$type<string[]>().notNull().default([]),
    /** exam_question id → option ids in display order. */
    optionOrder: jsonb("option_order").$type<Record<string, string[]>>().notNull().default({}),
    /** Where the student was, so a resume lands on the same question. */
    currentIndex: integer("current_index").notNull().default(0),
    /** Highest client sequence number applied; older writes are ignored. */
    clientSeq: integer("client_seq").notNull().default(0),
    answeredCount: integer("answered_count").notNull().default(0),
    extraSeconds: integer("extra_seconds").notNull().default(0),
    deviceSessionId: text("device_session_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lateAnswers: jsonb("late_answers").$type<LateAnswer[]>(),
    /** Why it ended: the student, the clock, the integrity rules, or staff. */
    submitReason: text("submit_reason", { enum: ["student", "timeout", "integrity", "staff"] }),
    /** Integrity events recorded (leaving, copying, second sign-in…), for the monitor's flag. */
    integrityFlags: integer("integrity_flags").notNull().default(0),
    /** Times the student left the exam window. */
    leaveCount: integer("leave_count").notNull().default(0),
    /** Highest device event number stored; older ones are already in. */
    eventSeq: integer("event_seq").notNull().default(0),
    score: numeric("score", { precision: 6, scale: 2, mode: "number" }),
    maxScore: numeric("max_score", { precision: 6, scale: 2, mode: "number" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("attempt_exam_student_uq").on(t.examId, t.studentId)],
);

/** What the student gave. Correctness and marks are worked out on the server at submission. */
export type AttemptResponse =
  | { kind: "choice"; optionIds: string[] }
  | { kind: "bool"; value: boolean }
  | { kind: "text"; text: string };

export const attemptAnswer = pgTable(
  "attempt_answer",
  {
    id: id(),
    schoolId: tenant(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempt.id, { onDelete: "cascade" }),
    examQuestionId: uuid("exam_question_id")
      .notNull()
      .references(() => examQuestion.id, { onDelete: "cascade" }),
    /** Null = cleared. */
    response: jsonb("response").$type<AttemptResponse>(),
    flagged: boolean("flagged").notNull().default(false),
    clientSeq: integer("client_seq").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
    isCorrect: boolean("is_correct"),
    marksAwarded: numeric("marks_awarded", { precision: 5, scale: 2, mode: "number" }),
    markedBy: uuid("marked_by").references(() => user.id, { onDelete: "set null" }),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    /** Teacher's comment to the student (theory). */
    comment: text("comment"),
    /** AI suggestion (theory): never applied unless the teacher accepts it. */
    aiMarks: numeric("ai_marks", { precision: 5, scale: 2, mode: "number" }),
    aiPoints: jsonb("ai_points").$type<{ ok: boolean; text: string }[]>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("attempt_answer_uq").on(t.attemptId, t.examQuestionId)],
);

export const integrityEventType = pgEnum("integrity_event_type", [
  "started",
  "resumed",
  "tab_hidden",
  "fullscreen_exit",
  "copy",
  "paste",
  "multi_session",
  "device_moved",
  "snapshot",
  "snapshot_declined",
  "blocked_ip",
  "auto_submitted",
  "submitted",
  "extra_time",
  "session_reset",
  "force_submitted",
  "late_answers_accepted",
]);

/** Everything that happened during an attempt, for the live monitor's timeline. */
export const integrityEvent = pgTable(
  "integrity_event",
  {
    id: id(),
    schoolId: tenant(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempt.id, { onDelete: "cascade" }),
    type: integrityEventType("type").notNull(),
    /** The device's own number for this event (null for events the server records). */
    clientSeq: integer("client_seq"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** e.g. { awayMs }, { device }, { key } of a snapshot, { minutes, by, reason } */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("integrity_event_seq_uq").on(t.attemptId, t.clientSeq), index("integrity_event_attempt_idx").on(t.attemptId, t.at)],
);

// ─── Results (minimal for Phase 0 screens; extended in Phase 6) ─────────────

export const gradingScale = pgTable("grading_scale", {
  id: id(),
  schoolId: tenant(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  ...timestamps,
});

export const gradeBand = pgTable("grade_band", {
  id: id(),
  schoolId: tenant(),
  scaleId: uuid("scale_id")
    .notNull()
    .references(() => gradingScale.id, { onDelete: "cascade" }),
  min: numeric("min", { precision: 5, scale: 2, mode: "number" }).notNull(),
  max: numeric("max", { precision: 5, scale: 2, mode: "number" }).notNull(),
  grade: text("grade").notNull(),
  remark: text("remark").notNull(),
  ...timestamps,
});

export const assessmentComponent = pgTable("assessment_component", {
  id: id(),
  schoolId: tenant(),
  termId: uuid("term_id")
    .notNull()
    .references(() => term.id, { onDelete: "cascade" }),
  /** "CA", "CA1", "Exam" */
  name: text("name").notNull(),
  weight: integer("weight").notNull(),
  sortOrder: smallint("sort_order").notNull(),
  ...timestamps,
});

export const scoreEntry = pgTable(
  "score_entry",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subject.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => assessmentComponent.id, { onDelete: "cascade" }),
    value: numeric("value", { precision: 6, scale: 2, mode: "number" }).notNull(),
    source: text("source", { enum: ["attempt", "manual", "import"] }).notNull().default("manual"),
    ...timestamps,
  },
  (t) => [uniqueIndex("score_entry_uq").on(t.studentId, t.subjectId, t.componentId)],
);

export const resultBatchStatus = pgEnum("result_batch_status", ["draft", "under_review", "approved", "released"]);

export const resultBatch = pgTable(
  "result_batch",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    classArmId: uuid("class_arm_id")
      .notNull()
      .references(() => classArm.id, { onDelete: "cascade" }),
    status: resultBatchStatus("status").notNull().default("draft"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("result_batch_uq").on(t.termId, t.classArmId)],
);

export const reportCardExtras = pgTable(
  "report_card_extras",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    formTeacherRemark: text("form_teacher_remark"),
    principalRemark: text("principal_remark"),
    affective: jsonb("affective").$type<Record<string, number>>(),
    psychomotor: jsonb("psychomotor").$type<Record<string, number>>(),
    daysPresent: integer("days_present"),
    daysOpened: integer("days_opened"),
    ...timestamps,
  },
  (t) => [uniqueIndex("report_card_extras_uq").on(t.termId, t.studentId)],
);

export const resultPin = pgTable(
  "result_pin",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    serial: text("serial").notNull(),
    /** sha256 of the normalised 12-digit PIN; lookup key within a school. */
    pinHash: text("pin_hash").notNull(),
    usesLeft: smallint("uses_left").notNull().default(5),
    maxUses: smallint("max_uses").notNull().default(5),
    /** Printed together, e.g. "B-20261002-1". Null for PINs made before batches. */
    batch: text("batch"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    /** Bound on first successful use. */
    studentId: uuid("student_id").references(() => student.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("result_pin_school_serial_uq").on(t.schoolId, t.serial),
    uniqueIndex("result_pin_school_hash_uq").on(t.schoolId, t.pinHash),
  ],
);

/** The code printed (and in the QR) on a report card; the public verify page looks it up. */
export const reportCardCode = pgTable(
  "report_card_code",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    /** e.g. "GFA-7Q2M-K9XD" — unique across all schools. */
    code: text("code").notNull().unique(),
    ...timestamps,
  },
  (t) => [uniqueIndex("report_card_code_uq").on(t.termId, t.studentId)],
);

// ─── Billing ─────────────────────────────────────────────────────────────────

export const subscriptionStatus = pgEnum("subscription_status", ["pending", "paid", "failed"]);

/** One term's payment for a plan (Paystack). */
export const subscription = pgTable(
  "subscription",
  {
    id: id(),
    schoolId: tenant(),
    termId: uuid("term_id")
      .notNull()
      .references(() => term.id, { onDelete: "cascade" }),
    plan: planCode("plan").notNull(),
    studentCount: integer("student_count").notNull(),
    /** Kobo per student, as charged. */
    pricePerStudent: integer("price_per_student").notNull(),
    /** Kobo. An upgrade during a paid term charges only the difference. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    /** Our reference, sent to Paystack; unique across all schools. */
    reference: text("reference").notNull().unique(),
    status: subscriptionStatus("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    channel: text("channel"),
    providerTransactionId: text("provider_transaction_id"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("subscription_school_term_idx").on(t.schoolId, t.termId)],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    schoolId: uuid("school_id").references(() => school.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("audit_log_school_idx").on(t.schoolId, t.createdAt)],
);
