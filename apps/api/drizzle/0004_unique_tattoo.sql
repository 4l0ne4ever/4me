CREATE TABLE "reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"target_id" integer NOT NULL,
	"reactor" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "parent_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_target_reactor_idx" ON "reactions" USING btree ("target","target_id","reactor");--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_id_notes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_parent_idx" ON "notes" USING btree ("parent_id");