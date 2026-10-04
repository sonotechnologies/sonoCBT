CREATE TABLE "attempt_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"exam_question_id" uuid NOT NULL,
	"response" jsonb,
	"flagged" boolean DEFAULT false NOT NULL,
	"client_seq" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"is_correct" boolean,
	"marks_awarded" numeric(5, 2),
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_draw_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_level_id" uuid,
	"topic_id" uuid,
	"difficulty" "difficulty",
	"count" integer NOT NULL,
	"marks_each" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_sealed" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"question_id" uuid,
	"sort_order" integer NOT NULL,
	"marks" numeric(5, 2) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_section_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"marks" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "question_order" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "option_order" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "current_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "client_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "answered_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "extra_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "device_session_id" text;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "late_answers" jsonb;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "late_entry_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "integrity_settings" jsonb;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "shuffle_questions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "shuffle_options" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "pin_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "exam_assignment" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "exam_assignment" ADD COLUMN "invigilator_id" uuid;--> statement-breakpoint
ALTER TABLE "exam_section" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_exam_question_id_exam_question_id_fk" FOREIGN KEY ("exam_question_id") REFERENCES "public"."exam_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answer" ADD CONSTRAINT "attempt_answer_marked_by_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_exam_id_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_section_id_exam_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."exam_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_class_level_id_class_level_id_fk" FOREIGN KEY ("class_level_id") REFERENCES "public"."class_level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_draw_rule" ADD CONSTRAINT "exam_draw_rule_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_pin" ADD CONSTRAINT "exam_pin_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_pin" ADD CONSTRAINT "exam_pin_exam_id_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_pin" ADD CONSTRAINT "exam_pin_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question" ADD CONSTRAINT "exam_question_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question" ADD CONSTRAINT "exam_question_exam_id_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question" ADD CONSTRAINT "exam_question_section_id_exam_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."exam_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_question" ADD CONSTRAINT "exam_question_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_section_item" ADD CONSTRAINT "exam_section_item_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_section_item" ADD CONSTRAINT "exam_section_item_exam_id_exam_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exam"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_section_item" ADD CONSTRAINT "exam_section_item_section_id_exam_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."exam_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_section_item" ADD CONSTRAINT "exam_section_item_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_answer_uq" ON "attempt_answer" USING btree ("attempt_id","exam_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_pin_uq" ON "exam_pin" USING btree ("exam_id","student_id");--> statement-breakpoint
CREATE INDEX "exam_question_exam_idx" ON "exam_question" USING btree ("exam_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_section_item_uq" ON "exam_section_item" USING btree ("section_id","question_id");--> statement-breakpoint
ALTER TABLE "exam" ADD CONSTRAINT "exam_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_assignment" ADD CONSTRAINT "exam_assignment_invigilator_id_user_id_fk" FOREIGN KEY ("invigilator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_section" ADD CONSTRAINT "exam_section_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;