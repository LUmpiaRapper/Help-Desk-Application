-- =====================================================
-- Help Desk — Migration v2
-- Adds: activity_log, rate_limits, storage policies,
--       email notification trigger, log/rate-limit triggers
-- Run this in the Supabase SQL Editor (safe to re-run)
-- =====================================================

-- 1. ACTIVITY LOG TABLE

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

DROP POLICY IF EXISTS "activity_log select" ON public.activity_log;
CREATE POLICY "activity_log select" ON public.activity_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (t.submitter_id = auth.uid() OR public.get_user_role() IN ('technician', 'admin'))
    )
  );

-- 2. ACTIVITY LOG TRIGGER (logs status/assignment changes)

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

-- 3. RATE LIMITING TABLE

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id       UUID NOT NULL REFERENCES public.users(id),
  action        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count         INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits(user_id, action, window_start);

-- 4. RATE LIMIT CHECK FUNCTION + TRIGGERS

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

-- 5. STORAGE BUCKET (safe to re-run)

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated can upload" ON storage.objects;
CREATE POLICY "authenticated can upload" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "attachments can read" ON storage.objects;
CREATE POLICY "attachments can read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated');

-- 6. PUBLIC RATE LIMITS (unauthenticated actions: login, register, forgot-password)

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

