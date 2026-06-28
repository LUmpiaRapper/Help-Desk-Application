-- =====================================================
-- Fix RLS infinite recursion
-- Drop old policies and replace with SECURITY DEFINER helper
-- =====================================================

-- 1. Create a helper function that bypasses RLS
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (SELECT role FROM public.users WHERE id = auth.uid());
END;
$$;

-- 2. Drop all old policies
DROP POLICY IF EXISTS "users select" ON public.users;
DROP POLICY IF EXISTS "users update" ON public.users;

DROP POLICY IF EXISTS "categories select" ON public.categories;
DROP POLICY IF EXISTS "categories insert" ON public.categories;
DROP POLICY IF EXISTS "categories update" ON public.categories;
DROP POLICY IF EXISTS "categories delete" ON public.categories;

DROP POLICY IF EXISTS "tickets select" ON public.tickets;
DROP POLICY IF EXISTS "tickets insert" ON public.tickets;
DROP POLICY IF EXISTS "tickets update staff" ON public.tickets;
DROP POLICY IF EXISTS "tickets delete admin" ON public.tickets;

DROP POLICY IF EXISTS "comments select" ON public.comments;
DROP POLICY IF EXISTS "comments insert" ON public.comments;
DROP POLICY IF EXISTS "comments delete" ON public.comments;

DROP POLICY IF EXISTS "attachments select" ON public.attachments;
DROP POLICY IF EXISTS "attachments insert" ON public.attachments;

-- 3. Recreate policies using the helper function

-- Users
CREATE POLICY "users select" ON public.users
  FOR SELECT
  USING (id = auth.uid() OR public.get_user_role() = 'admin');

CREATE POLICY "users update" ON public.users
  FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Categories
CREATE POLICY "categories select" ON public.categories
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "categories insert" ON public.categories
  FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "categories update" ON public.categories
  FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "categories delete" ON public.categories
  FOR DELETE
  USING (public.get_user_role() = 'admin');

-- Tickets
CREATE POLICY "tickets select" ON public.tickets
  FOR SELECT
  USING (
    submitter_id = auth.uid()
    OR public.get_user_role() IN ('technician', 'admin')
  );

CREATE POLICY "tickets insert" ON public.tickets
  FOR INSERT
  WITH CHECK (submitter_id = auth.uid());

CREATE POLICY "tickets update staff" ON public.tickets
  FOR UPDATE
  USING (public.get_user_role() IN ('technician', 'admin'));

CREATE POLICY "tickets delete admin" ON public.tickets
  FOR DELETE
  USING (public.get_user_role() = 'admin');

-- Comments
CREATE POLICY "comments select" ON public.comments
  FOR SELECT
  USING (
    is_internal = FALSE
    OR public.get_user_role() IN ('technician', 'admin')
  );

CREATE POLICY "comments insert" ON public.comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (is_internal = FALSE OR public.get_user_role() IN ('technician', 'admin'))
  );

CREATE POLICY "comments delete" ON public.comments
  FOR DELETE
  USING (user_id = auth.uid());

-- Attachments
CREATE POLICY "attachments select" ON public.attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (t.submitter_id = auth.uid() OR public.get_user_role() IN ('technician', 'admin'))
    )
  );

CREATE POLICY "attachments insert" ON public.attachments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_id
      AND (t.submitter_id = auth.uid() OR public.get_user_role() IN ('technician', 'admin'))
    )
  );
