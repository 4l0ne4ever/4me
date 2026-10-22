CREATE TABLE "diary_bans" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"user_id" integer,
	"ip_hash" text,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_bans" ADD CONSTRAINT "diary_bans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_bans" ADD CONSTRAINT "diary_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diary_bans_owner_user_idx" ON "diary_bans" USING btree ("owner_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diary_bans_owner_ip_idx" ON "diary_bans" USING btree ("owner_id","ip_hash");