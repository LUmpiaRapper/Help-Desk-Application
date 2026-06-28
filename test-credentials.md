# Test Credentials

Built-in accounts for demo/testing the help desk system.

| Role | Email | Password |
|---|---|---|
| **Admin** | admin@helpdesk.test | password123 |
| **Technician** | tech@helpdesk.test | password123 |
| **User** | user@helpdesk.test | password123 |

## Setup

Run the seed script to create these users automatically:

```bash
# Get your service_role key from Supabase Dashboard → Settings → API
set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Run the seed script
node scripts/seed-demo-users.js
```

This creates all 3 users, confirms their emails, and sets their roles.

> Passwords are deliberately simple — this is a demo system only.
