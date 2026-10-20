CREATE TABLE "almost" (
	"id" serial PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_stats" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pets" bigint DEFAULT 0 NOT NULL,
	"fish" bigint DEFAULT 0 NOT NULL,
	"plays" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"mood" text DEFAULT '' NOT NULL,
	"weather" text DEFAULT '' NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	"song_title" text,
	"song_artist" text,
	"song_url" text,
	"song_embed_url" text,
	"song_cover_url" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"read_count" integer DEFAULT 0 NOT NULL,
	"buzz_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"is_author" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_hits" (
	"key" text NOT NULL,
	"window" bigint NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_hits_key_window_pk" PRIMARY KEY("key","window")
);
--> statement-breakpoint
CREATE TABLE "shouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_visibility_written_idx" ON "entries" USING btree ("visibility","written_at");--> statement-breakpoint
CREATE INDEX "notes_entry_created_idx" ON "notes" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "shouts_created_idx" ON "shouts" USING btree ("created_at");