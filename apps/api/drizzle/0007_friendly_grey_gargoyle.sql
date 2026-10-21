CREATE TABLE "song_videos" (
	"key" text PRIMARY KEY NOT NULL,
	"video_id" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
