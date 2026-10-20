CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"reporter" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" DROP CONSTRAINT "entries_slug_unique";--> statement-breakpoint
ALTER TABLE "almost" ADD COLUMN "author_id" integer;--> statement-breakpoint
ALTER TABLE "blasts" ADD COLUMN "author_id" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "author_id" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "song_preview_url" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "song_id" bigint;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "status" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shouts" ADD COLUMN "owner_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
-- Existing accounts get a plain address they can change in My account.
UPDATE "users" SET "handle" = 'reader' || "id" WHERE "handle" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lastfm_user" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
-- Pages, blasts and binned lines from before accounts could write belong to the original author, "4me".
INSERT INTO "users" ("display_name", "name_key", "handle", "avatar")
SELECT '4me', '4me', '4me', 'ribbon'
WHERE (EXISTS (SELECT 1 FROM "entries") OR EXISTS (SELECT 1 FROM "blasts") OR EXISTS (SELECT 1 FROM "almost"))
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "name_key" = '4me' OR "handle" = '4me');--> statement-breakpoint
UPDATE "entries" SET "author_id" = (SELECT "id" FROM "users" WHERE "handle" = '4me') WHERE "author_id" IS NULL;--> statement-breakpoint
UPDATE "blasts" SET "author_id" = (SELECT "id" FROM "users" WHERE "handle" = '4me') WHERE "author_id" IS NULL;--> statement-breakpoint
UPDATE "almost" SET "author_id" = (SELECT "id" FROM "users" WHERE "handle" = '4me') WHERE "author_id" IS NULL;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "author_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "blasts" ALTER COLUMN "author_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "almost" ALTER COLUMN "author_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_entry_reporter_idx" ON "reports" USING btree ("entry_id","reporter");--> statement-breakpoint
CREATE INDEX "uploads_user_idx" ON "uploads" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "almost" ADD CONSTRAINT "almost_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blasts" ADD CONSTRAINT "blasts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shouts" ADD CONSTRAINT "shouts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_author_written_idx" ON "entries" USING btree ("author_id","written_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_author_slug_idx" ON "entries" USING btree ("author_id","slug");--> statement-breakpoint
CREATE INDEX "shouts_owner_created_idx" ON "shouts" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_idx" ON "users" USING btree ("handle");