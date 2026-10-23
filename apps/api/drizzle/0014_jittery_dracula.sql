CREATE TABLE "night_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"night" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"question" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"shift" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "event_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "night_events_night_idx" ON "night_events" USING btree ("night");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_event_id_night_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."night_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_event_idx" ON "entries" USING btree ("event_id");