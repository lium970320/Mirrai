ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source" varchar(50) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "memoryType" varchar(50) DEFAULT 'relationship_event' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "importance" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "confidence" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "keywords" jsonb;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "emotion" varchar(50);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "validFrom" varchar(50);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "validTo" varchar(50);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "lastAccessedAt" timestamp;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "evidenceMessageIds" jsonb;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "status" varchar(50) DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_persona_user_status_idx" ON "memories" ("personaId", "userId", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_type_idx" ON "memories" ("memoryType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_last_accessed_idx" ON "memories" ("lastAccessedAt");--> statement-breakpoint
