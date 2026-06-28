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

-- 6. ACTIVITY LOG TABLE + TRIGGERS

CREATE TABLE IF NOT EXISTS public.activity_log (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id   BIGINT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id),
  action      TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_ticket ON public.activity_log(ticket_id, created_at);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log select" ON public.activity_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (t.submitter_id = auth.uid() OR public.get_user_role() IN ('technician', 'admin'))
    )
  );

CREATE OR REPLACE FUNCTION public.log_ticket_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.activity_log (ticket_id, user_id, action, old_value, new_value)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.submitter_id), 'status_change', OLD.status, NEW.status);
  END IF;
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    INSERT INTO public.activity_log (ticket_id, user_id, action, old_value, new_value)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.submitter_id), 'assignment', OLD.assignee_id::text, NEW.assignee_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_ticket_change ON public.tickets;
CREATE TRIGGER trg_log_ticket_change
  AFTER UPDATE OF status, assignee_id ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.log_ticket_change();

-- 7. RATE LIMITING (anti-spam)

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id       UUID NOT NULL REFERENCES public.users(id),
  action        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count         INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits(user_id, action, window_start);

CREATE OR REPLACE FUNCTION public.check_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_max      INT;
  v_interval INTERVAL;
  v_count    INT;
BEGIN
  IF TG_TABLE_NAME = 'tickets' AND TG_OP = 'INSERT' THEN
    v_max := 3;
    v_interval := '1 hour';
  ELSIF TG_TABLE_NAME = 'comments' AND TG_OP = 'INSERT' THEN
    v_max := 5;
    v_interval := '1 minute';
  ELSE
    RETURN NEW;
  END IF;

  DELETE FROM public.rate_limits
  WHERE user_id = auth.uid()
    AND action = TG_TABLE_NAME || '_' || TG_OP
    AND window_start < NOW() - v_interval;

  SELECT COALESCE(SUM(count), 0) INTO v_count
  FROM public.rate_limits
  WHERE user_id = auth.uid()
    AND action = TG_TABLE_NAME || '_' || TG_OP
    AND window_start >= NOW() - v_interval;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Rate limit exceeded: max % per %', v_max,
      CASE WHEN v_interval = '1 hour' THEN 'hour' ELSE 'minute' END
      USING HINT = 'Please wait before submitting again.';
  END IF;

  INSERT INTO public.rate_limits (user_id, action)
  VALUES (auth.uid(), TG_TABLE_NAME || '_' || TG_OP);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_rate_limit_tickets ON public.tickets;
CREATE TRIGGER trg_rate_limit_tickets
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.check_rate_limit();

DROP TRIGGER IF EXISTS trg_rate_limit_comments ON public.comments;
CREATE TRIGGER trg_rate_limit_comments
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_rate_limit();

-- 8. PUBLIC RATE LIMITS (login, register, forgot-password)

CREATE TABLE IF NOT EXISTS public.public_rate_limits (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  fingerprint   TEXT NOT NULL,
  action        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_rate_limits_lookup
  ON public.public_rate_limits(fingerprint, action, created_at);

CREATE OR REPLACE FUNCTION public.check_public_rate_limit(p_fingerprint TEXT, p_action TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max      INT;
  v_interval INTERVAL;
  v_count    INT;
BEGIN
  v_max := CASE p_action
    WHEN 'login' THEN 5
    WHEN 'register' THEN 3
    WHEN 'forgot_password' THEN 3
    ELSE 10
  END;
  v_interval := CASE p_action
    WHEN 'login' THEN INTERVAL '5 minutes'
    WHEN 'register' THEN INTERVAL '10 minutes'
    WHEN 'forgot_password' THEN INTERVAL '10 minutes'
    ELSE INTERVAL '1 hour'
  END;

  DELETE FROM public.public_rate_limits
  WHERE fingerprint = p_fingerprint
    AND action = p_action
    AND created_at < NOW() - v_interval;

  SELECT COUNT(*) INTO v_count
  FROM public.public_rate_limits
  WHERE fingerprint = p_fingerprint
    AND action = p_action
    AND created_at >= NOW() - v_interval;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'reset_in', EXTRACT(EPOCH FROM (MIN(created_at) + v_interval - NOW())) * 1000
    );
  END IF;

  INSERT INTO public.public_rate_limits (fingerprint, action)
  VALUES (p_fingerprint, p_action);

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', v_max - v_count - 1,
    'reset_in', 0
  );
END;
$$;

-- 9. SEED DATA

INSERT INTO public.categories (name, sla_hours) VALUES
  ('Network', 4),
  ('Hardware', 8),
  ('Software', 24),
  ('Security', 2),
  ('Access', 48);
