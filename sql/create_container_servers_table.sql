-- Create table for container-based servers (separate from mcp_servers)
CREATE TABLE IF NOT EXISTS public.container_servers (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  runtime TEXT NOT NULL CHECK (runtime IN ('node','python')),
  endpoint TEXT NOT NULL,                -- Friendly MCP-style URL
  container_endpoint TEXT NOT NULL,      -- Direct /containers/{id} proxy URL
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful index
CREATE INDEX IF NOT EXISTS idx_container_servers_user_id ON public.container_servers(user_id);

-- Update trigger for updated_at (Postgres)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_container_servers_updated_at ON public.container_servers;
CREATE TRIGGER trg_container_servers_updated_at
BEFORE UPDATE ON public.container_servers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable Row Level Security so the table is not "unrestricted"
ALTER TABLE public.container_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.container_servers FORCE ROW LEVEL SECURITY;

-- Policies: users can only access their own rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'container_servers' AND policyname = 'Select own container servers'
  ) THEN
    CREATE POLICY "Select own container servers" ON public.container_servers
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'container_servers' AND policyname = 'Insert own container servers'
  ) THEN
    CREATE POLICY "Insert own container servers" ON public.container_servers
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'container_servers' AND policyname = 'Update own container servers'
  ) THEN
    CREATE POLICY "Update own container servers" ON public.container_servers
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'container_servers' AND policyname = 'Delete own container servers'
  ) THEN
    CREATE POLICY "Delete own container servers" ON public.container_servers
      FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END$$;

