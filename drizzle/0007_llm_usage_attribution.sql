ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "userId" integer;
--> statement-breakpoint
ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "personaId" integer;
--> statement-breakpoint
ALTER TABLE "llm_usage_records" ADD COLUMN IF NOT EXISTS "route" varchar(128);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_user_started_idx" ON "llm_usage_records" ("userId", "startedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_persona_started_idx" ON "llm_usage_records" ("personaId", "startedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_route_started_idx" ON "llm_usage_records" ("route", "startedAt");
