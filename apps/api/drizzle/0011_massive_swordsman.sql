CREATE TABLE "error_events" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
