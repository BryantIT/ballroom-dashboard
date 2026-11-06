CREATE TABLE "app"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."studios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rooms" ADD CONSTRAINT "rooms_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rooms" ADD CONSTRAINT "rooms_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;