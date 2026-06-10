CREATE TABLE IF NOT EXISTS "roleplay_channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "scenePrompt" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roleplay_channel_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "channelId" integer NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "displayOrder" integer DEFAULT 0 NOT NULL,
  "speakingEnabled" boolean DEFAULT true NOT NULL,
  "lastReadMessageId" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roleplay_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "channelId" integer NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer,
  "speakerName" varchar(100) NOT NULL,
  "role" varchar(32) DEFAULT 'persona' NOT NULL,
  "content" text NOT NULL,
  "innerThought" text,
  "moodState" jsonb,
  "turnKind" varchar(50) DEFAULT 'dialogue' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roleplay_channels_user_idx" ON "roleplay_channels" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roleplay_members_channel_idx" ON "roleplay_channel_members" ("channelId", "displayOrder");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roleplay_members_channel_persona_idx" ON "roleplay_channel_members" ("channelId", "personaId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roleplay_messages_channel_idx" ON "roleplay_messages" ("channelId", "id");
