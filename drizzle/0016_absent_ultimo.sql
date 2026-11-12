CREATE TABLE "app"."studio_branding" (
	"studio_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"theme_preset" text DEFAULT 'midnight' NOT NULL,
	"accent_color_override" text,
	"color_mode" text DEFAULT 'system' NOT NULL,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_branding_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "app"."studio_branding" ADD CONSTRAINT "studio_branding_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "app"."studios"("id") ON DELETE no action ON UPDATE no action;