CREATE TABLE "game_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"spec_json" jsonb NOT NULL,
	"source" text NOT NULL,
	"prompt" text,
	"attempt_count" integer NOT NULL,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"validation_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_versions_game_id_version_number_key" UNIQUE("game_id","version_number"),
	CONSTRAINT "game_versions_source_check" CHECK ("game_versions"."source" IN ('generate', 'edit', 'rollback'))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_versions" ADD CONSTRAINT "game_versions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_game_versions_game_id" ON "game_versions" USING btree ("game_id","version_number" desc);