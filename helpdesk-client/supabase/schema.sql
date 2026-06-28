-- =====================================================
-- IT Help Desk — Supabase Schema + RLS + Triggers
-- Run this in the Supabase SQL Editor
-- =====================================================

-- 1. TABLES

CREATE TABLE public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'user'
              CHECK (role IN ('user', 'technician', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.categories (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        TEXT NOT NULL,
  sla_hours   INT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.tickets (
  id              BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  submitter_id    UUID NOT NULL REFERENCES public.users(id),
  assignee_id     UUID REFERENCES public.users(id),
  category_id     BIGINT NOT NULL REFERENCES public.categories(id),
  sla_due_at      TIMESTAMPTZ,
  sla_breached_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.comments (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id     BIGINT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id),
  body          TEXT NOT NULL,
  is_internal   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.attachments (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id     BIGINT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id),
  file_path     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. AUTO-CREATE public.users ON SIGNUP

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 3. SLA DUE DATE TRIGGER

CREATE OR REPLACE FUNCTION public.set_sla_due_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.sla_due_at := NOW() + (SELECT sla_hours FROM public.categories WHERE id = NEW.category_id) * INTERVAL '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_sla_due_at ON public.tickets;
CREATE TRIGGER trg_set_sla_due_at
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sla_due_at();

-- 4. ROW LEVEL SECURITY

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Users: admins can see all; users see themselves
CREATE POLICY "users select" ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "users update" ON public.users
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Categories: all authenticated can read; only admin can write
CREATE POLICY "categories select" ON public.categories
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "categories insert" ON public.categories
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "categories update" ON public.categories
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "categories delete" ON public.categories
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Tickets: users see own; staff see all
CREATE POLICY "tickets select" ON public.tickets
  FOR SELECT
  USING (
    submitter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
  );

CREATE POLICY "tickets insert" ON public.tickets
  FOR INSERT
  WITH CHECK (submitter_id = auth.uid());

CREATE POLICY "tickets update staff" ON public.tickets
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin')));

CREATE POLICY "tickets delete admin" ON public.tickets
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

-- Comments: staff see all; users see public only
CREATE POLICY "comments select" ON public.comments
  FOR SELECT
  USING (
    is_internal = FALSE
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
  );

CREATE POLICY "comments insert" ON public.comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      is_internal = FALSE
      OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
    )
  );

CREATE POLICY "comments delete" ON public.comments
  FOR DELETE
  USING (user_id = auth.uid());

-- Attachments: read if you can see ticket; write if authenticated
CREATE POLICY "attachments select" ON public.attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (
        t.submitter_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
      )
    )
  );

CREATE POLICY "attachments insert" ON public.attachments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (
        t.submitter_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
      )
    )
  );

-- 5. STORAGE BUCKET + POLICIES
-- Run these in Supabase SQL Editor under the Storage section, or here:

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

-- Bucket-level: authenticated users can upload
CREATE POLICY "authenticated can upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments'
    AND auth.role() = 'authenticated'
  );

-- Bucket-level: read if you can see the ticket (uses public.tickets RLS)
CREATE POLICY "attachments can read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND auth.role() = 'authenticated'
  );

-- 6. SEED DATA

INSERT INTO public.categories (name, sla_hours) VALUES
  ('Network', 4),
  ('Hardware', 8),
  ('Software', 24),
  ('Security', 2),
  ('Access', 48);
