CREATE TABLE IF NOT EXISTS "persona_runtime_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "runtimeLifeState" jsonb,
  "runtimeDiagnostics" jsonb,
  "proactiveRuntime" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persona_runtime_states_persona_user_idx" ON "persona_runtime_states" ("personaId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_runtime_states_user_idx" ON "persona_runtime_states" ("userId");
