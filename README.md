# SonoCBT

Exams and results for Nigerian private secondary schools (JSS1–SS3): set, run, mark and publish computer-based exams, then turn scores into report cards. Multi-school SaaS by Sono Technologies.

The build brief is phased; see [Status](#status).

## Stack

Next.js 16 (App Router, TypeScript strict) · Neon Postgres · Drizzle ORM · Better Auth · Tailwind CSS v4 + shadcn/ui conventions · Zod · Vitest.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill it in (below)
npm run db:reset             # apply migrations + seed
npm run dev                  # http://localhost:3000
```

### `.env.local`

| Variable | What |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (app). For local work without Neon use `pglite:./.pglite` (embedded Postgres on disk). |
| `DATABASE_URL_DIRECT` | Neon **direct** connection string (migrations, seed). |
| `BETTER_AUTH_SECRET` | 32+ random characters. |
| `BETTER_AUTH_URL` | App origin, e.g. `http://localhost:3000`. |
| `RESULTS_TOKEN_SECRET` | Signs the 30-minute parent report-card view token. |
| `BREVO_API_KEY`, `EMAIL_FROM` | Brevo sends staff invites and password resets (free, 300/day, no domain needed — `EMAIL_FROM` must be your verified Brevo sender). Optional in development: without it emails are logged to the console. `RESEND_API_KEY` works instead once you have a domain. |
| `GEMINI_API_KEY` | Google AI Studio key (free tier) for photo import, "Write with AI" and topic suggestions. Optional: without it those three are switched off with a note; Word and spreadsheet import still work. |
| `GEMINI_MODEL` | Optional. Models to try in order, comma-separated (default `gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite`). If one is overloaded (503) or out of free quota (429) the next is used. |
| `AI_DAILY_LIMIT` | Optional. AI requests per school per 24 hours (default 60), counted from the audit log. |
| `R2_PRIVATE_BUCKET` | A second, **private** R2 bucket for exam identity photos (same R2 keys). Without it, production can't turn on webcam snapshots; development keeps them in `./.uploads-private`. |
| `R2_*` | Cloudflare R2 for school crests and question images. Optional in development — uploads go to `./.uploads` and are served at `/files/…`. Required in production. |

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Scripts

| Script | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run dev:clean` | Deletes `.next` first — use if the dev server starts returning 404s for pages that exist (a stale Turbopack cache). If staff pages still 404 right after a clean start, saving any file under `app/s/[schoolSlug]/(staff)` makes Turbopack pick the route group up. |
| `npm test` | Vitest (tests run against an in-memory Postgres; no database needed) |
| `npm run test:e2e` | Playwright: builds the app and runs it on port 3100 against a throwaway PGlite database (`.pglite-e2e`), using the installed Microsoft Edge (no browser download). `E2E_DEV=1` uses `next dev` instead |
| `npm run dev:e2e` | The same throwaway server by hand (seeded with Paper 1 open now), to try the exam runtime without touching Neon |
| `npm run typecheck` / `lint` | `tsc` / ESLint |
| `npm run db:generate` | New SQL migration from `lib/db/schema.ts` (commit the `drizzle/` folder) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | **Wipes** the database and seeds it; prints the demo sign-ins |
| `npm run db:reset` | Migrate + seed |
| `npm run acceptance:sheet` | Writes the Phase 6 acceptance workbook (`docs/acceptance/…xlsx`): the seed class worked out with Excel formulas next to the app's numbers |
| `npm run demo:reset` | Rebuilds only the demo school (Crestview) — what the nightly cron does |
| `npm run snapshots:purge` | Deletes exam identity photos older than 30 days (run daily from a cron job) |

### Seed data

`scripts/seed.ts` creates **Greenfield Academy, Lekki** (the school used in the designs: Chiamaka Okafor, JSS3B, with the exact report card from the design) and **Crestview Model College, Ibadan** (a second tenant). Exam times are relative to when the seed runs, so the student home always has an exam opening ~12 minutes later. Staff, student and parent-PIN test logins are printed by the seed.

| Where | URL |
| --- | --- |
| New school signup → setup wizard | `/signup` |
| Staff sign in | `/login` (password reset at `/forgot-password`) |
| Student sign in | `/s/greenfield-academy/login` |
| Student home · lobby | `/s/greenfield-academy/student` → *Go to exam lobby* |
| Parent result checker | `/results?school=greenfield-academy` (or `/results` to pick the school) |

## Architecture

```
app/(auth)                    staff sign-in, school signup, invite acceptance, password reset
app/s/[schoolSlug]/setup      onboarding wizard (details → branding → session → classes → staff → students)
app/s/[schoolSlug]/(staff)/students, staff   student list + import, staff invites, departments, "who teaches what"
app/s/[schoolSlug]/(staff)/questions         question bank, review queue, editor
app/s/[schoolSlug]/(staff)/import            smart import: Word, Excel/CSV, photos, Write with AI → review screen
app/s/[schoolSlug]/login      student sign-in (admission number), school-branded
app/s/[schoolSlug]/(staff)    staff shell + dashboard
app/s/[schoolSlug]/student    student home
app/s/[schoolSlug]/(staff)/exams             exam list, builder (details → questions → integrity → schedule → preview), slips & PINs
app/s/[schoolSlug]/exams/[id]/try            staff preview of the real exam screen (nothing saved)
app/s/[schoolSlug]/(staff)/monitor           live monitor: exams today → /exams/[id]/monitor (polls every 10 s)
app/s/[schoolSlug]/exam/[id]  lobby (start / PIN / resume), /take the exam runtime, /sync its whole server API
app/results                   public parent result checker + report card view
lib/db                        Drizzle schema + client (Neon or PGlite)
lib/auth                      Better Auth config, sign-in actions, can() permissions
lib/tenant                    getTenantContext() + tenantScope() — the only door to tenant data
lib/grading                   positions with ties, WAEC grades, class statistics
lib/results                   result PINs, checker, report card assembly, view tokens
lib/school                    signup, wizard steps, Nigerian defaults (classes, subjects, terms)
lib/import                    student list reader; question import: .docx reader (lists, OMML equations → LaTeX),
                              question-paper parser, sheet reader, confidence checks, import jobs + commit
lib/exams                     rules (per-student order, deadlines, marking) · builder · runtime (start, payload, sync, submit)
                              · local (device-side merge) · calc (calculator) · pin (exam PINs, sealed for reprinting)
components/exam/runtime       the exam screen: IndexedDB store, sync engine, keyboard shortcuts, phone + lab layouts
public/exam-sw.js             service worker, scope /s/: reopens an exam page offline; nothing else
lib/exams/integrity·monitor   integrity rules (flags, network allow-lists, timeline wording) · monitor data and staff actions
lib/ai                        Gemini provider (structured JSON, model fallback) and the three AI tasks
lib/staff, lib/students       invites, teaching allocation, bulk student accounts, password resets
lib/storage.ts                uploads (R2, or ./.uploads in development)
lib/questions                 question bank: rich content (Tiptap JSON + KaTeX/mhchem), validation, answer checking,
                              duplicate detection, approval workflow — model/rich/labels are pure and unit-tested
scripts                       migrate, seed
```

**Multi-tenancy.** Every tenant-owned table has `school_id`. App code reaches those tables only through `tenantScope(db, schoolId)` (`lib/tenant/scope.ts`), which pins every read, insert, update and delete to one school and ignores any `schoolId` a caller passes. The school always comes from the signed-in session via `getTenantContext()`; the URL slug must agree or the request gets a 404. `lib/tenant/scope.test.ts` tries cross-school reads, updates and deletes against **every** tenant table and fails if a new tenant table is added without coverage.

**Student logins.** Admission numbers are only unique within a school, so Better Auth usernames are stored as `<schoolId>|<admission no>` (`lib/auth/student-username.ts`); the same admission number can exist in two schools.

**Permissions.** One pure function, `can(actor, action, resource)` in `lib/auth/permissions.ts`; roles are per school and a user can hold several (e.g. Teacher + Form teacher).

**Parent results.** A 12-digit scratch-card PIN (hashed, salted per school) is checked against the school, admission number and term. A successful view uses one of its uses (default 5) and binds the PIN to that student; "not yet released" and other failures use nothing. The report card is shown through a signed, 30-minute, HTTP-only cookie.

## Status

| Phase | State |
| --- | --- |
| 0. Foundation | **Done.** Acceptance: `lib/auth/auth.test.ts` + `lib/tenant/scope.test.ts` (logins in two schools; no cross-school access for any entity). |
| 1. School setup | **Done.** Acceptance: `lib/school/onboarding.test.ts` runs signup → details → session → classes → 5 staff invited and joined → 100 students imported and signing in (≈6 s server time). Also walked through in the browser. |
| Student & parent screens (from Phases 4 & 7) | Built early from the design handoff: student home, pre-exam lobby (phone + lab), parent result checker, released report card. |
| 2. Question bank | **Done.** Acceptance: `lib/questions/bank.test.ts` — a teacher creates all six types (objective, multiple answer, true/false, fill-in-the-gap, numeric, theory, one linked to a comprehension passage) and the Sciences HOD approves them; another department's HOD and the teacher cannot. |
| 3. Smart import | **Done.** Acceptance: `lib/import/word-import.test.ts` — 10 Word papers in common Nigerian layouts (Ans: lines, answer-key tables, bold/underline/highlight/asterisk answers, Word auto-numbering, sections, comprehension passages, Word equations) → **81/81 questions (100%)** with the right stem, options, answer, type and marks. `service.test.ts` / `commit-atomic.test.ts`: review → bank (with passage), duplicate flags, privacy, and an interrupted commit saves nothing. An 81-question paper commits to Neon in ≈11 s. Walked through in the browser: Word, spreadsheet, photo, Write with AI, Suggest topics. |
| 4. Exams & runtime | **Done.** Acceptance: `e2e/exam-resume.spec.ts` (Playwright, production build) — a student answers 3 questions, the network is cut, answers 5 more, closes the tab and reopens it offline: all 8 answers are there and the timer is within 3 s of the server's deadline; back online everything syncs, and a second device (no local copy) sees all 8 with the same deadline. A phone run covers the navigator and passage sheets and submitting. `lib/exams/*.test.ts`: per-student order (passages kept together), late-start deadlines, entry rules, server-side marking of every type, stale/invalid writes ignored, auto-submit after the deadline, PINs, and that no correct answer ever reaches the page. `e2e/exam-builder.spec.ts`: an exam officer builds (picks + a random draw), previews, publishes with PINs and prints slips. Runtime route JS: 143.9 KB gzipped (budget 150 KB, mostly the shared React/Next framework; keep integrity code in Phase 5 small). |
| 5. Integrity & monitoring | **Done.** Acceptance: `e2e/integrity.spec.ts` — with the exam officer's live monitor open, a student in a Strict exam leaves the window twice (warned "1 of 3", "2 of 3"), and the third time the exam is submitted; the monitor shows "Auto-submitted · tab switches" with 3 flags in under 20 s, without reloading. `lib/exams/integrity-flow.test.ts`: events counted once, the one-device rule (blocked, invigilator reset, take-over after 2 quiet minutes), school-network allow-lists, private identity photos, extra time (one student, everyone, reopening a timed-out exam), force submit, start again, counting late answers, invigilators limited to their own room. Runtime route JS: 145.8 KB gzipped. |
| 6. Marking & results | **Done.** Acceptance: `lib/results/acceptance.test.ts` seeds the demo school and checks JSS2B · 3rd Term 2025/2026 against spreadsheet arithmetic done independently in the test (SUM, AVERAGE, RANK.EQ, grade LOOKUP, MAX/MIN, ROUND to 1 dp): every subject total, grade, subject position, overall total, average and position (including the seeded tie: Ifeanyi Obi and Zainab Yusuf share a position and the next one is skipped), plus Chiamaka's report card. `npm run acceptance:sheet` writes the same class to `docs/acceptance/jss2b-3rd-term-2025-26.xlsx` with live Excel formulas beside the app's values and a check column. `lib/results/pipeline.test.ts`: components and grading-scale rules, who can type which scores, limits, theory marking with names hidden, AI suggestions that are stored but never applied (only question, guide, max marks and answer text are sent), exam scores scaled into the CA grid, and draft → review → approved → released (with reasons for late changes and un-release) feeding the change log. `e2e/results.spec.ts`: a student submits a theory answer, the teacher marks it by keyboard, types a CA score (saved, survives reload, over-max flagged), opens the broadsheet, sends the class for review; the exam officer approves; the admin releases it and the log shows each step. |
| 7. Report cards & parents | **Done.** Acceptance: `e2e/parent-results.spec.ts` (phone) — a parent enters Chiamaka's admission number and a seeded PIN at `/results`, sees her released 3rd Term 2025/2026 report card, downloads the A4 PDF, and its verification code checks out at `/verify`; the PIN for 1st Term 2026/2027 (not released) answers "have not been released yet" and isn't used up. The lab run covers the staff side: the form teacher writes remarks, ratings and attendance; the admin downloads a released class as one PDF (38 pages) and as a zip of single PDFs, and makes a batch of result PINs and prints its card sheet. `lib/results/report-cards.test.ts`: who may write which extras and when (form teacher until approved, principal's remark and later changes by the admin, logged after approval), rating/attendance checks, suggested principal's remarks, PIN batches (serials continue the school's numbering, only hashes stored, use limits, usage log, sheets only for real PINs), verify codes (typed loosely; withdrawn when un-released; same code after re-release). `lib/pdf/report-cards.test.ts`: every report-sheet field, 3rd-term session totals and annual average, stable unique codes, unreleased previews without codes, one page per student, zips, PIN sheets 10 to a page. |
| 8. Analytics | **Done.** Acceptance: `lib/analytics/analytics.test.ts` seeds the demo school and checks the seeded exams' most-missed questions (% correct and the wrong option most chosen) and weakest topics against figures worked out in the test from the raw answers; `e2e/analytics.spec.ts` shows them on screen (exam report, topic-mastery heatmap for JSS3A/JSS3B, school overview, CSV export), and that an HOD sees only their department's exams and no school overview. Screens: **Exam report** (average, pass rate, highest/lowest, median time, score distribution, most-missed questions, every question with % skipped and median time to answer, topics by class, results by class, integrity summary); **Topic mastery** (topic × class heatmap for a subject and term, weakest topics, the subject's class averages across terms); **School overview** (average and pass rate against last term, classes over three terms, subject ranking, classes, subjects to watch, students at risk — average below 40% or down 10+ points). Every table exports to CSV. The bank's question statistics (used, % correct, computed difficulty, discrimination, likely wrong key) are recomputed when scores go to the CA grid and when a closed exam's report is opened. |
| 9. Billing & platform | **Done.** Acceptance: `e2e/billing.spec.ts` — Greenfield (Standard, paid this term) finds Smart import locked as a Premium feature; the admin upgrades on Billing (charged the difference for the term's students), pays on the Flutterwave test checkout, Flutterwave's webhook (checked with its secret hash) and the return page both confirm with Flutterwave, and Smart import unlocks. The platform owner then sees the payment, signs in as the school admin for support (banner, logged start and end) and suspends/reactivates the school. `lib/billing/billing.test.ts`: trial → grace → lapsed, a new unpaid term's grace, suspension, what each plan unlocks, per-student quotes and upgrades, only the admin can pay, a returned-but-unpaid checkout changes nothing, payment confirmed twice counts once, a wrong amount is refused and logged, webhook secret hash, the owner console's figures and audited suspension. Payments use Flutterwave (v3 hosted checkout; amounts in naira). Plans (placeholder prices in `lib/billing/plans.ts`): **Starter** ₦500 (CBT + results), **Standard** ₦900 (+ PDF report cards, analytics), **Premium** ₦1,400 (+ smart import, photo import, AI assistant, webcam identity photos) per student per term. 30-day free trial with every feature; 14 days' grace with a banner after the trial or when a new term starts unpaid; then paid features and new exams pause (data, results and the parent checker keep working). One gate, `hasFeature()`, used in the services (so an action can't bypass a hidden button) and the screens. Owner console at `/platform`. |
| 10. Demo & marketing | **Done.** Acceptance: `e2e/demo.spec.ts` — from the home page, “Try the demo school” → each of the five role cards in turn (Admin → dashboard, Exam officer → live monitor of the mock that's open now, Teacher → theory marking, Student → sits the mock on a phone, Parent → a released report card): every role in about 20 s, no sign-up (budget: 2 minutes). Also renders Home, Features, Pricing, Demo and Contact, the sitemap, robots and the Open Graph image, and serves the sample Word papers. `lib/demo/demo.test.ts`: the demo school matches the brief (12 classes, 10 subjects, 120 students, 15 staff, 600+ questions with maths, pictures and a passage; 3 finished exams with answers and integrity events; 1 exam open now; last term released with report cards; working PINs), each visitor gets their own student seated for the live exam, the reset rebuilds only the demo school (twice is fine; other schools untouched), no payments, and the DEMO_MODE switch. Demo school: **Crestview Model College, Ibadan** (`scripts/demo/seed-demo.ts`, ~5 s), rebuilt nightly by `/api/cron/reset-demo` (vercel.json, 00:00 UTC) or `npm run demo:reset`. Inside it: a “Demo school — data resets daily” strip; no password changes, emails or payments. Marketing pages under `app/(marketing)`; SEO via metadata, `app/opengraph-image.tsx`, `app/sitemap.ts`, `app/robots.ts`. |
| Admin dashboard | **Done** (after Phase 10, from the design). Greeting with the term week, quick actions, students / sitting now / theory to mark / results released, exams today and this week (live first, then upcoming, then this past week), “needs your attention” (flagged students in a live exam, unpublished exams starting soon, classes sent for review or approved, billing), and the term's results by class level. Each part follows the person's role: a teacher sees their own classes, exams and marking. `lib/dashboard/dashboard.test.ts`; the demo e2e checks the admin lands on it. |
| Moving students | **Done** (brief §10). Students → **Promote to next class** at the start of a session: every class goes to the matching class a level up (JSS1A → JSS2A; a flagged guess where names differ, e.g. JSS3A → SS1), the last level graduates, and any class can be redirected or any student kept back, graduated or marked as left; it waits until the new session's 1st term is current and asks before promoting a session twice. Per student: **Change class…** (move arm, graduated, left the school with a reason) and **Readmit…**; status tabs On the register / Graduated / Left. Before anyone moves, the class they were in is written onto every term that has started (enrolments), so past broadsheets and report cards keep the class students sat in. Graduated and departed students keep their records (parents can still check results) but can't sign in (“This account is closed…”) and don't count for billing or exam seating. All audited. `lib/students/moves.test.ts`, `e2e/students.spec.ts`. |
| Phase 11 · phone UI | **Done**. Every page checked at phone width (390 px). Staff menu is a slide-in drawer; list tables (students, exams, results release, PINs, billing, platform, analytics questions, promotion) become one card per row on phones via `.stack-table` (`globals.css`), while spreadsheet grids (CA, broadsheet, topic mastery) keep scrolling in their own box. The question bank gets a Filters toggle and opens a question full-screen; the live monitor opens a student as a full-screen sheet; exam builder steps fit as numbered circles; filter and term chips scroll in one row (`.chip-row`); fields are 16 px on phones so iOS doesn't zoom; bigger tap targets; the lobby counts down to closing time while open. `e2e/phone-layout.spec.ts` fails if a main page scrolls sideways on a phone. |
| Install as an app | **Done**. SonoCBT installs from the browser like an app (home-screen icon, full screen): `app/manifest.ts`, icons from `app/app-icon/[name]` and `app/apple-icon.tsx` (the brand mark: pencil bubble on an ink tile, which is also the browser-tab icon in `app/icon.svg` and `app/favicon.ico`), and a root service worker (`public/sw.js`, production only) that shows `public/offline.html` with no connection and caches nothing from schools (exam pages keep `exam-sw.js`). The app opens at `/start`, which sends staff to their dashboard, students to their page and the platform owner to `/platform`; signed out it asks staff / student / parent and remembers the student's school from its sign-in page. **Install the app** buttons (Android/desktop install prompt; Share → Add to Home Screen steps on iPhone) sit in the staff sidebar, the student home, both sign-in pages, the parent result checker and the site footer, and hide once installed. `e2e/install.spec.ts`. |

Interim pieces to replace in later phases:

- Integrity deters and detects; it can't lock a personal phone or laptop. Leaving the window is detected by the page losing focus or being hidden (≥ 1 s). Devtools detection isn't attempted (unreliable). Full screen isn't available on iPhones, so "required" can't be enforced there.
- One device per student: a second computer is turned away and logged (the design's "Second sign-in blocked"), rather than kicking the first off as the brief first suggested, so nobody can take over a student's exam from elsewhere. The invigilator's **Reset session** frees it; a device silent for 2 minutes can be taken over without help.
- Answers that reach the server after time runs out (plus a 90 s grace) are kept on the attempt as "late answers" and not marked until the invigilator chooses **Count late answers** on the monitor.
- Every printable is a real A4 PDF (`@react-pdf/renderer`, built-in Helvetica/Courier): exam slips (10 to a page, cut lines) and the invigilator's PIN sheet (header on every page, numbered per class) — one class or the whole exam — report cards, and result-checker PIN cards. The slips page still shows an on-screen preview. PDFs with PINs are never cached.
- Random draws happen once, when the exam is published (every student gets the same questions, each in their own order).
- In Greenfield's seed, Paper 1 and the two CA tests have questions; the other exams are placeholders for the student home screen. The demo school's exams are all real.
- PDFs embed PNG and JPEG images only: an SVG or WebP crest shows a placeholder on the PDF (the setup screen says so). The principal's signature upload is PNG/JPG.
- Result-checker PINs are shown once, when made, for printing; only their hashes are kept, so a lost sheet means making a new batch.
- Report-card verify codes are created when a released card is first viewed or printed; the verify page always shows the school's current figures, and says "withdrawn" while a class is un-released.
- The design's demo page tours Greenfield; the brief names Crestview Model College as the demo school, so Crestview is the public demo (one-click roles, reset nightly) and Greenfield stays the development/test school the end-to-end tests use.
- Demo visitors who pick Student each get a new student in JSS3A (wiped nightly), so everyone can sit the open mock. Staff roles share the seeded accounts; their sign-ins are public by design.
- Deploying: set `DEMO_MODE=1` and `CRON_SECRET` on Vercel for the demo and its nightly reset, and `NEXT_PUBLIC_SALES_WHATSAPP` for the "Book a demo" button (without it the site shows email instead).
- Payments: without Flutterwave keys, set `FLUTTERWAVE_MOCK=1` (development only) to use the in-app test checkout; with a `FLWSECK_TEST-` key and `FLUTTERWAVE_WEBHOOK_HASH` the same code talks to Flutterwave (webhook URL `/api/flutterwave/webhook`). The design's plan names (Exams / Exams + Results / Complete) differ from the brief's; the brief's Starter/Standard/Premium and its feature split are used, with the design's prices as placeholders.
- Platform owner sign-in is `owner@sonocbt.ng` (seed). Support sign-in uses Better Auth's admin plugin: a separate one-hour session as the school's first admin; the owner's own session comes back on "End support session".
- Analytics averages from the CA grid use the parts entered so far (18 of 30 marks entered = 60%), so mid-term figures are comparable with finished terms. Time per question is estimated from the gap between a student's answers. A topic/class cell needs 5 answers before it shows a %.
- Seed: JSS3A (24 students) and two finished CA tests with simulated answers exist so the analytics have data; the simulation is deterministic.
- The Word fixtures were written for the tests, not collected from schools; real teachers' papers will surface layouts the parser hasn't seen. Anything it's unsure of is flagged amber/red for the teacher, never guessed silently.
- The grading scale starts as WAEC A1–F9; schools edit it in Results → Setup.
- HOD invites (department-scoped) wait for departments to be set up in the app; the role and permissions already exist.
- The emailed sign-in link shown in the staff login design isn't built; staff use password + reset.

Notes:

- Student starting passwords are shown **once** after an import (download the CSV) and are never stored in plain text. An admin, or the student's form teacher, can reset one at any time.
- Removing a class or subject in the wizard never deletes one that has students, results or exams; it is kept and reported.
- Date inputs follow the device language: on an en-NG / en-GB phone they read DD/MM/YYYY.
- **AI privacy.** Only question text, topics, lesson notes and page photos are sent to Gemini — never student names, admission numbers or scores. AI-written or photo-read questions are always amber: a teacher checks each one before it reaches the bank. Each request is audit-logged (task and model only, no content). Google's free tier may use prompts to improve its models; use a paid key if a school needs that off.

## Deploy (Vercel Hobby, portfolio stage)

1. Create a Neon project; copy the pooled and direct connection strings.
2. Set the environment variables above in Vercel.
3. `DATABASE_URL_DIRECT=… npm run db:migrate` (and `db:seed` for the demo).
4. Deploy. No Vercel-only APIs are used, so the app can move hosts later.
