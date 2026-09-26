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

-- Private Storage bucket for original uploads. Supabase restricts SQL on the storage schema
-- (changelog 2025-03-18), so this is best-effort only: the server also creates the bucket through the
-- Storage API at startup (ensureBucket), and `npm run storage:setup` does the same.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('documents', 'documents', false)
      ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'storage.buckets insert skipped (%); the app creates the bucket via the Storage API', SQLERRM;
    END;
  END IF;
END $$;
