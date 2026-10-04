CREATE TABLE "staff_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"title" text,
	"roles" jsonb NOT NULL,
	"subject_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "principal_name" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "stage" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_accepted_user_id_user_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invite_token_uq" ON "staff_invite" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_invite_school_email_idx" ON "staff_invite" USING btree ("school_id","email");