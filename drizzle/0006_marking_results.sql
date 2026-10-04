ALTER TABLE "attempt_answer" ADD COLUMN "marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD COLUMN "ai_marks" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD COLUMN "ai_points" jsonb;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "component_id" uuid;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "ai_marking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "scores_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_question" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "exam_question" ADD CONSTRAINT "exam_question_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_component_id_assessment_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."assessment_component"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "exam_question" AS eq SET "subject_id" = q."subject_id" FROM "question" AS q WHERE q."id" = eq."question_id" AND eq."subject_id" IS NULL;
