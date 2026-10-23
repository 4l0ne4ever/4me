CREATE TABLE "night_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"night" text NOT NULL,
	"user_id" integer,
	"ip_hash" text,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "night_lines" ADD CONSTRAINT "night_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "night_lines_night_idx" ON "night_lines" USING btree ("night","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "night_lines_night_user_idx" ON "night_lines" USING btree ("night","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "night_lines_night_ip_idx" ON "night_lines" USING btree ("night","ip_hash");--> statement-breakpoint
CREATE INDEX "entries_prompt_idx" ON "entries" USING btree ("prompt");