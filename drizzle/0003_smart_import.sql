CREATE TYPE "public"."import_kind" AS ENUM('word', 'photo', 'sheet', 'ai');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('review', 'saved', 'discarded');--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" "import_kind" NOT NULL,
	"title" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"class_level_id" uuid,
	"status" "import_status" DEFAULT 'review' NOT NULL,
	"items" jsonb NOT NULL,
	"passages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_html" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_class_level_id_class_level_id_fk" FOREIGN KEY ("class_level_id") REFERENCES "public"."class_level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_job_school_idx" ON "import_job" USING btree ("school_id","created_at");