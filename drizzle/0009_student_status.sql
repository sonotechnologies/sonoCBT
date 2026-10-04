CREATE TYPE "public"."student_status" AS ENUM('active', 'graduated', 'left');--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "status" "student_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "left_reason" text;