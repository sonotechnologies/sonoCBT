CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('manual', 'word', 'photo', 'ai', 'sheet');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'pending', 'returned', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq_single', 'mcq_multi', 'true_false', 'fill_blank', 'numeric', 'theory');--> statement-breakpoint
CREATE TABLE "passage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_level_id" uuid,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_level_id" uuid,
	"topic_id" uuid,
	"passage_id" uuid,
	"type" "question_type" NOT NULL,
	"stem" jsonb NOT NULL,
	"stem_text" text NOT NULL,
	"answer" jsonb NOT NULL,
	"marks" numeric(5, 2) DEFAULT 1 NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"source" "question_source" DEFAULT 'manual' NOT NULL,
	"author_id" uuid,
	"review_comment" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"label" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"sort_order" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"pct_correct" numeric(5, 2),
	"discrimination" numeric(4, 3),
	"computed_difficulty" "difficulty",
	"last_used_at" timestamp with time zone,
	"likely_wrong_key" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_level_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passage" ADD CONSTRAINT "passage_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage" ADD CONSTRAINT "passage_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage" ADD CONSTRAINT "passage_class_level_id_class_level_id_fk" FOREIGN KEY ("class_level_id") REFERENCES "public"."class_level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage" ADD CONSTRAINT "passage_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_class_level_id_class_level_id_fk" FOREIGN KEY ("class_level_id") REFERENCES "public"."class_level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_passage_id_passage_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_option" ADD CONSTRAINT "question_option_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_option" ADD CONSTRAINT "question_option_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_stats" ADD CONSTRAINT "question_stats_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_stats" ADD CONSTRAINT "question_stats_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_class_level_id_class_level_id_fk" FOREIGN KEY ("class_level_id") REFERENCES "public"."class_level"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_subject_number_uq" ON "question" USING btree ("school_id","subject_id","number");--> statement-breakpoint
CREATE INDEX "question_bank_idx" ON "question" USING btree ("school_id","subject_id","class_level_id","status");--> statement-breakpoint
CREATE INDEX "question_search_idx" ON "question" USING gin (to_tsvector('english', "stem_text"));--> statement-breakpoint
CREATE INDEX "question_option_question_idx" ON "question_option" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_stats_question_uq" ON "question_stats" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "topic_subject_idx" ON "topic" USING btree ("school_id","subject_id");