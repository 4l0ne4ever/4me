CREATE TABLE "follows" (
	"follower_id" integer NOT NULL,
	"followee_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id")
);
--> statement-breakpoint
CREATE TABLE "note_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"reporter" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "search_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reports" ADD CONSTRAINT "note_reports_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "note_reports_note_reporter_idx" ON "note_reports" USING btree ("note_id","reporter");--> statement-breakpoint
-- Existing pages and people become searchable straight away (accents are dropped as they are next saved).
UPDATE "entries" SET "search_text" = lower("title" || ' ' || "body") WHERE "search_text" = '';--> statement-breakpoint
UPDATE "users" SET "search_name" = lower("display_name" || ' ' || "handle") WHERE "search_name" = '';
