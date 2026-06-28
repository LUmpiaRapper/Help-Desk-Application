import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Ticket {
  id: number
  title: string
  status: string
  sla_due_at: string | null
  assignee_id: string | null
}

interface User {
  id: string
  email?: string
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Find tickets past SLA that haven't been marked breached
  const { data: tickets, error: fetchError } = await supabase
    .from('tickets')
    .select('id, title, status, sla_due_at, assignee_id')
    .not('status', 'in', '("resolved","closed")')
    .lt('sla_due_at', new Date().toISOString())
    .is('sla_breached_at', null)

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  if (!tickets || tickets.length === 0) {
    return new Response(JSON.stringify({ checked: true, breached: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Mark as breached
  const breachedIds = tickets.map((t: Ticket) => t.id)
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ sla_breached_at: new Date().toISOString() })
    .in('id', breachedIds)

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 500 })
  }

  // Notify admins
  const { data: admins } = await supabase
    .from('users')
    .select('id, email')
    .eq('role', 'admin')

  for (const ticket of tickets as Ticket[]) {
    for (const admin of (admins as User[]) || []) {
      try {
        await fetch(`${Deno.env.get('SUPABASE_URL')!}/rest/v1/rpc/send_sla_email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
          },
          body: JSON.stringify({
            admin_email: admin.email,
            ticket_id: ticket.id,
            ticket_title: ticket.title,
          }),
        })
      } catch {
        // Email notification is best-effort
      }
    }
  }

  return new Response(
    JSON.stringify({ checked: true, breached: tickets.length }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
