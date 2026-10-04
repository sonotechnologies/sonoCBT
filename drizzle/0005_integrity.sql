CREATE TYPE "public"."integrity_event_type" AS ENUM('started', 'resumed', 'tab_hidden', 'fullscreen_exit', 'copy', 'paste', 'multi_session', 'device_moved', 'snapshot', 'snapshot_declined', 'blocked_ip', 'auto_submitted', 'submitted', 'extra_time', 'session_reset', 'force_submitted', 'late_answers_accepted');--> statement-breakpoint
CREATE TABLE "integrity_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"type" "integrity_event_type" NOT NULL,
	"client_seq" integer,
	"at" timestamp with time zone NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "submit_reason" text;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "integrity_flags" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "leave_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt" ADD COLUMN "event_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrity_event" ADD CONSTRAINT "integrity_event_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_event" ADD CONSTRAINT "integrity_event_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrity_event_seq_uq" ON "integrity_event" USING btree ("attempt_id","client_seq");--> statement-breakpoint
CREATE INDEX "integrity_event_attempt_idx" ON "integrity_event" USING btree ("attempt_id","at");