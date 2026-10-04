CREATE TABLE "report_card_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_card_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "result_pin" ADD COLUMN "max_uses" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "result_pin" ADD COLUMN "batch" text;--> statement-breakpoint
ALTER TABLE "result_pin" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "principal_signature_url" text;--> statement-breakpoint
ALTER TABLE "report_card_code" ADD CONSTRAINT "report_card_code_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_code" ADD CONSTRAINT "report_card_code_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card_code" ADD CONSTRAINT "report_card_code_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_card_code_uq" ON "report_card_code" USING btree ("term_id","student_id");--> statement-breakpoint
ALTER TABLE "result_pin" ADD CONSTRAINT "result_pin_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;