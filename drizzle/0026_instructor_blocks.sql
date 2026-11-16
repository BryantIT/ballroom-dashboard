CREATE TABLE "app"."instructor_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"instructor_user_id" text,
	"kind" text NOT NULL,
	"day_of_week" integer,
	"start_time" text,
	"end_time" text,
	"start_at" timestamp,
	"end_at" timestamp,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."instructor_blocks" ADD CONSTRAINT "instructor_blocks_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instructor_blocks" ADD CONSTRAINT "instructor_blocks_instructor_user_id_user_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;