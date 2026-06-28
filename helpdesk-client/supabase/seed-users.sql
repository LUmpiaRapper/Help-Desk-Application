-- =====================================================
-- Seed demo users
-- Run this AFTER setting up auth users manually or via
-- the Supabase dashboard Auth → Users → Add User
-- =====================================================

-- First, create these users in Supabase Auth dashboard:
--   admin@helpdesk.test / password123
--   tech@helpdesk.test   / password123
--   user@helpdesk.test   / password123

-- Then update their roles:
UPDATE public.users SET role = 'admin' WHERE email = 'admin@helpdesk.test';
UPDATE public.users SET role = 'technician' WHERE email = 'tech@helpdesk.test';
-- user@helpdesk.test stays as 'user' (default)
