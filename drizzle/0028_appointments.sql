CREATE TABLE "app"."appointment_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."appointment_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"instructor_user_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"series_start_date" timestamp NOT NULL,
	"series_end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"series_id" uuid,
	"instructor_user_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cross_instructor_reason_code" text,
	"cross_instructor_reason_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."appointment_attendees" ADD CONSTRAINT "appointment_attendees_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_attendees" ADD CONSTRAINT "appointment_attendees_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "app"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_attendees" ADD CONSTRAINT "appointment_attendees_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "app"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_series" ADD CONSTRAINT "appointment_series_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_series" ADD CONSTRAINT "appointment_series_instructor_user_id_user_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_series" ADD CONSTRAINT "appointment_series_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointment_series" ADD CONSTRAINT "appointment_series_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_series_id_appointment_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "app"."appointment_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_instructor_user_id_user_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "app"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_attendees_appointment_student_unique" ON "app"."appointment_attendees" USING btree ("appointment_id","student_id");