CREATE TABLE "app"."student_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"student_a_id" uuid NOT NULL,
	"student_b_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."student_relationships" ADD CONSTRAINT "student_relationships_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."student_relationships" ADD CONSTRAINT "student_relationships_student_a_id_students_id_fk" FOREIGN KEY ("student_a_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."student_relationships" ADD CONSTRAINT "student_relationships_student_b_id_students_id_fk" FOREIGN KEY ("student_b_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;