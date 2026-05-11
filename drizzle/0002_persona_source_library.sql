CREATE TABLE IF NOT EXISTS "persona_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "title" varchar(255) NOT NULL,
  "sourceType" varchar(50) DEFAULT 'epub' NOT NULL,
  "originalName" varchar(255),
  "fileHash" varchar(128),
  "metadata" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona_source_chunks" (
  "id" serial PRIMARY KEY NOT NULL,
  "sourceId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "chapterTitle" text,
  "chunkIndex" integer NOT NULL,
  "content" text NOT NULL,
  "keywords" jsonb,
  "tokenEstimate" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_sources_persona_user_idx" ON "persona_sources" ("personaId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_source_chunks_persona_user_idx" ON "persona_source_chunks" ("personaId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_source_chunks_source_idx" ON "persona_source_chunks" ("sourceId");
