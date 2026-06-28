/**
 * Seed demo users into Supabase.
 *
 * Usage:
 *   1. Copy .env.local to .env (or set env vars manually)
 *   2. Set SUPABASE_SERVICE_ROLE_KEY in your environment
 *   3. Run: node scripts/seed-demo-users.js
 *
 * IMPORTANT: Never commit service role keys to git.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable.')
  console.error('Get it from Supabase Dashboard → Settings → API → service_role key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

const users = [
  {
    email: 'admin@helpdesk.test',
    password: 'password123',
    email_confirm: true,
    user_metadata: { name: 'Admin User' },
    role: 'admin',
  },
  {
    email: 'tech@helpdesk.test',
    password: 'password123',
    email_confirm: true,
    user_metadata: { name: 'Tech User' },
    role: 'technician',
  },
  {
    email: 'user@helpdesk.test',
    password: 'password123',
    email_confirm: true,
    user_metadata: { name: 'Regular User' },
    role: 'user',
  },
]

async function seed() {
  for (const u of users) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', u.email)
      .maybeSingle()

    if (existing) {
      console.log(`  ↳ ${u.email} already exists, updating role...`)
      await supabase.from('users').update({ role: u.role }).eq('id', existing.id)
      continue
    }

    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: u.email_confirm,
      user_metadata: u.user_metadata,
    })

    if (error) {
      console.error(`  ✗ ${u.email}: ${error.message}`)
      continue
    }

    await supabase.from('users').update({ role: u.role }).eq('id', authUser.user.id)

    console.log(`  ✓ ${u.email} (${u.role})`)
  }

  console.log('\nDone! Demo users created.')
}

seed().catch(console.error)
