# Send Notification — Edge Function Deployment

## Step 1: Get a Resend API Key

1. Go to [resend.com](https://resend.com) and sign up (free tier: 100 emails/day)
2. Go to **API Keys** → **Create API Key**
3. Copy the key (starts with `re_...`)

## Step 2: Add Domain (Resend)

1. In Resend, go to **Domains** → **Add Domain**
2. Enter a domain you own (e.g., `yourdomain.com`)
3. Add the DNS TXT records to your domain provider
4. Wait for verification (may take a few minutes)
5. After verified, sender email will be: `helpdesk@yourdomain.com`

## Step 3: Deploy Edge Function via Supabase Dashboard

1. Go to [supabase.com](https://supabase.com) → your project
2. Click **Edge Functions** in the left sidebar
3. Click **Create a new function**
4. Name: `send-notification`
5. Open `supabase/functions/send-notification/index.ts` and copy the entire content
6. Paste into the editor
7. Click **Deploy**

> Or use the Supabase CLI: `supabase functions deploy send-notification`

## Step 4: Set Environment Secrets

1. In your Supabase dashboard, go to **Edge Functions**
2. Click the **gear icon** (Settings) for `send-notification`
3. Under **Environment Variables**, add:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` (your Resend key) |
| `APP_URL` | `https://your-app.vercel.app` (your Vercel URL) |
| `SUPABASE_URL` | `https://eqohmsuiekpihlphkzfk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key from Settings → API |

## Step 5: Create Database Webhook (triggers the function)

1. Go to **Database** → **Webhooks** → **Create a new webhook**
2. Name: `notify-ticket-changes`
3. Table: `tickets`
4. Events: `INSERT`, `UPDATE`
5. Target: **Edge Function** → `send-notification`
6. HTTP Method: `POST`
7. Click **Create**

## Testing

Create a ticket or change a status — the Edge Function will fire and send an email notification.
