import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

interface NotificationPayload {
  type: 'assigned' | 'status_changed' | 'sla_breached' | 'new_comment'
  ticket_id: number
  ticket_title: string
  recipient_email: string
  recipient_name?: string
  actor_name?: string
  old_value?: string
  new_value?: string
  comment_body?: string
}

const resend = new Resend(Deno.env.get('RESEND_API_KEY')!)

const FROM_EMAIL = 'helpdesk@notifications.yourdomain.com'

const TEMPLATES: Record<string, (p: NotificationPayload) => { subject: string; html: string }> = {
  assigned: (p) => ({
    subject: `[Helpdesk] Ticket #${p.ticket_id} assigned to you`,
    html: `<p>Hi ${p.recipient_name || 'there'},</p><p>Ticket <strong>#${p.ticket_id}</strong> has been assigned to you:</p><blockquote style="margin:12px 0;padding:12px;border-left:3px solid #6366f1;color:#374151"><strong>${p.ticket_title}</strong></blockquote><p>View it here: <a href="${Deno.env.get('APP_URL') || ''}/tickets/${p.ticket_id}">Ticket #${p.ticket_id}</a></p>`,
  }),
  status_changed: (p) => ({
    subject: `[Helpdesk] Ticket #${p.ticket_id} status updated`,
    html: `<p>Hi ${p.recipient_name || 'there'},</p><p>Ticket <strong>#${p.ticket_id}</strong> status changed from <strong>${p.old_value?.replace('_', ' ')}</strong> to <strong>${p.new_value?.replace('_', ' ')}</strong> by ${p.actor_name || 'a staff member'}.</p><p>View it here: <a href="${Deno.env.get('APP_URL') || ''}/tickets/${p.ticket_id}">Ticket #${p.ticket_id}</a></p>`,
  }),
  sla_breached: (p) => ({
    subject: `[Helpdesk] SLA BREACHED — Ticket #${p.ticket_id}`,
    html: `<p style="color:#dc2626"><strong>SLA Breached</strong></p><p>Ticket <strong>#${p.ticket_id}</strong> has exceeded its SLA deadline:</p><blockquote style="margin:12px 0;padding:12px;border-left:3px solid #dc2626;color:#374151"><strong>${p.ticket_title}</strong></blockquote><p>View it here: <a href="${Deno.env.get('APP_URL') || ''}/tickets/${p.ticket_id}">Ticket #${p.ticket_id}</a></p>`,
  }),
  new_comment: (p) => ({
    subject: `[Helpdesk] New comment on Ticket #${p.ticket_id}`,
    html: `<p>Hi ${p.recipient_name || 'there'},</p><p>${p.actor_name || 'Someone'} commented on ticket <strong>#${p.ticket_id}</strong>:</p><blockquote style="margin:12px 0;padding:12px;border-left:3px solid #6366f1;color:#374151">${p.comment_body || ''}</blockquote><p>View it here: <a href="${Deno.env.get('APP_URL') || ''}/tickets/${p.ticket_id}">Ticket #${p.ticket_id}</a></p>`,
  }),
}

Deno.serve(async (req) => {
  try {
    const payload: NotificationPayload = await req.json()

    const template = TEMPLATES[payload.type]
    if (!template) {
      return new Response(JSON.stringify({ error: `Unknown notification type: ${payload.type}` }), { status: 400 })
    }

    const { subject, html } = template(payload)

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [payload.recipient_email],
      subject,
      html,
    })

    if (error) {
      console.error('Resend error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    return new Response(JSON.stringify({ sent: true }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('send-notification error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
  }
})
