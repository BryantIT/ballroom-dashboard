CREATE TABLE "app"."instructor_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"instructor_user_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."instructor_locations" ADD CONSTRAINT "instructor_locations_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instructor_locations" ADD CONSTRAINT "instructor_locations_instructor_user_id_user_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."instructor_locations" ADD CONSTRAINT "instructor_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instructor_locations_studio_instructor_location_unique" ON "app"."instructor_locations" USING btree ("studio_id","instructor_user_id","location_id");