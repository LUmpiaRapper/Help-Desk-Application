# IT Help Desk Ticketing System — Project Plan

> **Stack:** React + Vite (frontend) · Supabase (BaaS: auth, database, storage, realtime, edge functions)
> **Deploy:** Vercel (frontend) · Supabase cloud (backend)
> **Purpose:** Portfolio project demonstrating full-stack development, role-based access control, SLA tracking, and IT operations knowledge.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [System Architecture](#system-architecture)
4. [Database Schema](#database-schema)
5. [Roles & Permissions (RLS)](#roles--permissions-rls)
6. [Frontend Data Access](#frontend-data-access)
7. [Frontend Pages](#frontend-pages)
8. [SLA Tracking Logic](#sla-tracking-logic)
9. [Project Setup](#project-setup)
10. [Build Order](#build-order)
11. [Portfolio Extras](#portfolio-extras)

---

## Project Overview

A full-stack IT help desk ticketing system with three user roles (user, technician, admin), SLA deadline tracking, email notifications, and an admin analytics dashboard. Modeled after real-world IT support workflows.

**Core features:**
- Submit, assign, and resolve support tickets
- Role-based dashboards (user / technician / admin)
- Automatic SLA deadline calculation per ticket category
- SLA breach detection with escalation alerts
- Comment threads on tickets (public + internal notes)
- File attachments (Supabase Storage)
- Admin reports: MTTR, SLA compliance rate, open vs. resolved trends
- CSV/PDF export of reports

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, React Router v6, TanStack Query, Supabase JS Client |
| Styling | Tailwind CSS |
| BaaS | Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions) |
| Database | PostgreSQL 15 (Supabase managed) |
| Auth | Supabase Auth (email/password, magic link) |
| File storage | Supabase Storage (S3-compatible) |
| Email | Supabase Auth emails + Edge Function (Resend / SMTP) |
| Real-time | Supabase Realtime (WebSockets, built-in) |
| Scheduled tasks | pg_cron (Supabase via SQL) or Edge Function cron |
| Deployment | Vercel (frontend) |

---

## System Architecture

```
┌──────────────────────────────────────────────────────┐
│            Vercel — React + Vite (SPA)               │
│  ┌──────────┐ ┌─────────────┐ ┌──────────────────┐  │
│  │ User     │ │ Technician  │ │ Admin panel      │  │
│  │ portal   │ │ dashboard   │ │ + analytics      │  │
│  └──────────┘ └─────────────┘ └──────────────────┘  │
└──────────────────────┬───────────────────────────────┘
                       │ supabase-js (direct client)
                       │ Auth: supabase.auth (session tokens)
┌──────────────────────▼───────────────────────────────┐
│              Supabase Cloud (BaaS)                    │
│  ┌──────────┐ ┌─────────────┐ ┌──────────────────┐  │
│  │ Auth     │ │ PostgreSQL  │ │ Storage (files)  │  │
│  │ (GoTrue) │ │ + RLS       │ │ (S3-compatible)  │  │
│  └──────────┘ └─────────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌─────────────┐                       │
│  │Realtime  │ │ Edge Fn     │                       │
│  │(WS sub)  │ │(SLA check)  │                       │
│  └──────────┘ └─────────────┘                       │
└──────────────────────────────────────────────────────┘
```

**Key difference from traditional backend:** No custom API server. The React app talks directly to Supabase via the JS client. Row-Level Security (RLS) enforces authorization at the database level — same as having middleware, but embedded in the DB.

---

## Database Schema

All tables live in the `public` schema on Supabase PostgreSQL. Supabase Auth manages the `auth.users` table; we create a separate `public.users` table linked by UUID for app-level fields like `role`.

### `users` (app-level)
```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user'
              CHECK (role IN ('user', 'technician', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### `categories`
```sql
CREATE TABLE categories (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        TEXT NOT NULL,                    -- e.g. "Network", "Hardware", "Software"
  sla_hours   INT NOT NULL,                     -- hours before SLA breach (e.g. 8, 24, 48)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### `tickets`
```sql
CREATE TABLE tickets (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority      TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  submitter_id  UUID NOT NULL REFERENCES users(id),
  assignee_id   UUID REFERENCES users(id),
  category_id   BIGINT NOT NULL REFERENCES categories(id),
  sla_due_at    TIMESTAMPTZ,
  sla_breached_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### `comments`
```sql
CREATE TABLE comments (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  is_internal   BOOLEAN DEFAULT FALSE,        -- internal notes only visible to staff
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### `attachments`
```sql
CREATE TABLE attachments (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ticket_id     BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  file_path     TEXT NOT NULL,                -- Supabase storage object path
  file_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Relationships summary
- `users` 1→many `tickets` (as submitter)
- `users` 1→many `tickets` (as assignee)
- `categories` 1→many `tickets`
- `tickets` 1→many `comments`
- `tickets` 1→many `attachments`
- `users` 1→many `comments`

---

## Roles & Permissions (RLS)

Authorization is enforced via PostgreSQL Row-Level Security policies — one policy per table per operation. No middleware code needed.

| Action | user | technician | admin |
|---|:---:|:---:|:---:|
| Submit ticket | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ |
| View all tickets | ❌ | ✅ | ✅ |
| Add public comment | ✅ | ✅ | ✅ |
| Add internal note | ❌ | ✅ | ✅ |
| Update ticket status | ❌ | ✅ | ✅ |
| Assign technician | ❌ | ❌ | ✅ |
| Manage categories | ❌ | ❌ | ✅ |
| View reports | ❌ | ❌ | ✅ |
| Manage users | ❌ | ❌ | ✅ |

### RLS policy examples

```sql
-- Enable RLS on all tables
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Helper: get the current user's role from public.users
-- (available because supabase-js sets `auth.uid()` from the session)

-- Tickets: users see only their own; techs/admins see all
CREATE POLICY "users see own tickets" ON tickets
  FOR SELECT
  USING (
    submitter_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
  );

-- Tickets: only tech/admin can update status
CREATE POLICY "techs and admins can update tickets" ON tickets
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('technician', 'admin')));

-- Tickets: only admin can assign, delete
CREATE POLICY "admins can assign" ON tickets
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (
    -- only allow assignee_id changes on the assign action
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Comments: internal notes only visible to staff
CREATE POLICY "comments visibility" ON comments
  FOR SELECT
  USING (
    is_internal = FALSE
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
  );

-- Comments: regular users cannot set is_internal = true
CREATE POLICY "users cannot create internal notes" ON comments
  FOR INSERT
  WITH CHECK (
    (is_internal = FALSE)
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('technician', 'admin'))
  );
```

---

## Frontend Data Access

There are no custom API endpoints. The React app uses the `supabase-js` client directly:

### Supabase client setup
```js
// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Auth (Supabase Auth handles this)
```js
// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email, password
})

// Register (also creates public.users row via DB trigger)
const { data, error } = await supabase.auth.signUp({
  email, password,
  options: { data: { name } }
})

// Get session
const { data: { session } } = await supabase.auth.getSession()

// Listen to auth state
supabase.auth.onAuthStateChange((event, session) => { ... })
```

### Data fetching examples
```js
// List tickets (filtered automatically by RLS)
const { data: tickets } = await supabase
  .from('tickets')
  .select('*, categories(name), assignee:assignee_id(name)')
  .order('created_at', { ascending: false })

// Create ticket
const { data: ticket } = await supabase
  .from('tickets')
  .insert({
    title, description,
    category_id,
    priority,
    submitter_id: (await supabase.auth.getUser()).data.user.id,
    sla_due_at: null // calculated by DB trigger on insert
  })
  .select()
  .single()

// File upload
const { data } = await supabase.storage
  .from('attachments')
  .upload(`tickets/${ticketId}/${file.name}`, file)
```

### SLA deadline trigger (runs on ticket insert)
```sql
CREATE OR REPLACE FUNCTION set_sla_due_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.sla_due_at := NOW() + (SELECT sla_hours FROM categories WHERE id = NEW.category_id) * INTERVAL '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_sla_due_at
  BEFORE INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_sla_due_at();
```

---

## Frontend Pages

### Route structure
```
/login                    Public
/register                 Public
/dashboard                Auth — role-aware
/tickets                  Auth — list view
/tickets/new              Auth — create form
/tickets/:id              Auth — detail view
/admin/users              Admin only
/admin/categories         Admin only
/admin/reports            Admin only
```

### Component breakdown

**`/dashboard`**
- User: shows their own open/resolved tickets + "Submit ticket" CTA
- Technician: shows assigned queue sorted by priority + SLA urgency indicator
- Admin: summary cards (total open, breached SLA, avg MTTR) + recent activity feed

**`/tickets/new`**
- Fields: Title, Description (textarea), Category (select), Priority (select)
- File upload (multiple) — uploads directly to Supabase Storage
- On submit: insert via supabase-js → redirect to `/tickets/:id`

**`/tickets/:id`**
- Ticket header: title, status badge, priority badge, SLA countdown timer (client-side from `sla_due_at`)
- Assignee info (admin/tech can change via dropdown)
- Status update dropdown (tech/admin)
- Comment thread (public comments visible to all, internal notes shown only to staff with different visual style)
- Attachment list with download links (Supabase signed URLs)

**`/admin/reports`**
- Metric cards: Total tickets, Avg MTTR (hours), SLA compliance %, Open now
- Bar chart: tickets created per day (last 30 days)
- Pie chart: tickets by category
- Table: tickets with longest resolution time
- Export CSV button

### Auth guard component
```jsx
// src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ allowedRoles, children }) {
  const { user, role, loading } = useAuth()

  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" />
  if (allowedRoles && !allowedRoles.includes(role)) return <Navigate to="/dashboard" />

  return children
}
```

---

## SLA Tracking Logic

### On ticket creation — set deadline (DB trigger)
```sql
-- Handled by trigger trg_set_sla_due_at (see above)
-- Auto-calculates sla_due_at from category.sla_hours
```

### Scheduled SLA breach checker (Edge Function)
```js
// supabase/functions/check-sla-breaches/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: breached } = await supabase
    .from('tickets')
    .update({ sla_breached_at: new Date().toISOString() })
    .not('status', 'in', '("resolved","closed")')
    .lt('sla_due_at', new Date().toISOString())
    .is('sla_breached_at', null)
    .select()

  // Send email notifications for each breached ticket
  if (breached?.length) {
    const { data: admins } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'admin')

    for (const ticket of breached) {
      // call email API (Resend / SendGrid) for each admin
    }
  }

  return new Response(JSON.stringify({ checked: true, breached: breached?.length }))
})
```

**Scheduling:** Deploy with cron schedule via Supabase Dashboard (Database → Triggers → Create → Cron) or call via a Vercel Cron Job.

### SLA countdown (client-side)
```js
// Display on ticket detail page
const timeLeft = new Date(ticket.sla_due_at) - new Date()
// Use setInterval to update every second
// Show red when breached, yellow when < 25% time remains
```

---

## Project Setup

### 1. Supabase project
```bash
# Create project at https://supabase.com
# Copy project URL and anon key from Settings → API
```

### 2. Database tables + RLS
Open Supabase SQL Editor and run the schema + RLS policies + triggers from the sections above.

### 3. Auth trigger (auto-create public.users)
```sql
-- Creates a public.users row when someone signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### 4. Frontend
```bash
npm create vite@latest helpdesk-client -- --template react
cd helpdesk-client

npm install @supabase/supabase-js react-router-dom @tanstack/react-query recharts
npm install -D tailwindcss @tailwindcss/vite

# .env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

npm run dev
```

### 5. Deploy to Vercel
```bash
# Push to GitHub
git init && git add . && git commit -m "init"
gh repo create helpdesk --public --push

# Import repo in Vercel dashboard
# Add environment variables in Vercel:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY

# Deploy — that's it
```

---

## Build Order

Follow this sequence to avoid blockers:

1. **Supabase: project + schema** — create project, run SQL for all tables + relationships
2. **Supabase: auth trigger** — auto-create `public.users` on sign-up
3. **Supabase: RLS policies** — enable RLS, write all policies per table
4. **Supabase: storage bucket** — create `attachments` bucket (public read, authenticated write)
5. **React: project scaffold** — Vite + Tailwind + Router + Supabase client setup
6. **React: auth flow** — login/register pages, auth guard, `useAuth` hook
7. **React: ticket list + detail** — the most used screens (data comes directly from Supabase)
8. **React: create ticket form** — with file upload to Storage
9. **React: admin assign + status update** — admin panel for users & categories
10. **React: reports dashboard** — charts last (needs real data to look good)
11. **Supabase: SLA trigger** — `set_sla_due_at` on ticket insert
12. **Supabase/Edge: SLA breach checker** — cron job or Edge Function to mark breaches
13. **Polish:** SLA countdown timer on ticket detail, internal note styling, file download signed URLs

---

## Portfolio Extras

These additions make the project significantly more impressive:

### Real-time updates (Supabase Realtime)
- Subscribe to `tickets` table changes: when a technician changes status, all viewers see it instantly
- Built-in — no Pusher needed:
```js
const channel = supabase
  .channel('ticket-changes')
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'tickets' },
    (payload) => { /* update UI */ }
  )
  .subscribe()
```

### Process efficiency metric (ties to your resume)
- Track average resolution turnaround time per category
- Show a "process efficiency" card on the admin dashboard
- Reference the ~25% improvement you achieved at Cliberduche as the benchmark

### Lean Six Sigma angle
- Add a "root cause" field to resolved tickets (dropdown: hardware, software, user error, network, other)
- Show a Pareto chart on the reports page (80/20 rule visualization of incident root causes)
- This directly connects your LSS Yellow Belt cert to the project

### Data export (ties to your DataCamp certs)
- CSV export built entirely client-side from query results
- PDF report via `html2canvas` + `jsPDF` (no server-side package needed)

### README for GitHub
Write a detailed README with:
- Live demo link (Vercel deployment URL)
- Architecture diagram screenshot
- Feature list
- Setup instructions (Supabase + Vercel)
- Tech decisions and why you made them (good for interviews)
