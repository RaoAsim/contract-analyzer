-- Supabase one-time setup (§7). Idempotent so it is safe on a fresh or existing project.

-- pgvector: only used by the optional semantic-search extra; enabling it early is harmless.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
--> statement-breakpoint

-- Supabase exposes the public schema through its Data API. RLS with NO policies keeps that API
-- closed; the app connects as the owner role, which bypasses RLS.
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_html" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clauses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversation_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "comparisons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Private Storage bucket for original uploads. Supabase manages storage.buckets; inserting here
-- keeps setup in one place. scripts/setup-storage.ts does the same through the Storage API.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('documents', 'documents', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
