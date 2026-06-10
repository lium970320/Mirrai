CREATE TABLE IF NOT EXISTS "llm_usage_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "startedAt" timestamp NOT NULL,
  "durationMs" integer DEFAULT 0 NOT NULL,
  "provider" varchar(64) NOT NULL,
  "requestedProvider" varchar(64),
  "model" varchar(128),
  "purpose" varchar(64),
  "success" boolean DEFAULT true NOT NULL,
  "inputTokens" integer DEFAULT 0 NOT NULL,
  "outputTokens" integer DEFAULT 0 NOT NULL,
  "totalTokens" integer DEFAULT 0 NOT NULL,
  "inputChars" integer DEFAULT 0 NOT NULL,
  "outputChars" integer DEFAULT 0 NOT NULL,
  "error" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_started_at_idx" ON "llm_usage_records" ("startedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_provider_started_idx" ON "llm_usage_records" ("provider", "startedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_purpose_started_idx" ON "llm_usage_records" ("purpose", "startedAt");
