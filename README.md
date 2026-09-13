# CRM System.
newchanges
Lead Management & CRM Platform. Ingests leads from Meta Lead Ads, distributes
them to employees under a timed priority rotation, records every follow-up
immutably, and rolls up closed-deal financials against office expenses.

Built for a Pakistan-based sales business: amounts in PKR, reporting periods in
Asia/Karachi, phone numbers normalised to +92.
....
## Features

- **Lead intake** — Meta Lead Ads webhook, signature-verified, with the
  customer's details retrieved from the Graph API and the ad resolved to its
  campaign.
- **Timed distribution** — the admin has 5 minutes to assign by hand; after
  that a priority-ordered 8-lead rotation takes over. The assigned employee has
  10 minutes to accept or the lead moves on and a red flag is raised.
- **Immutable follow-ups** — append-only in the code *and* in the Security
  Rules. There is no edit or delete path for anyone, including admins.
- **Entry Module** — a closed deal captures a full customer record alongside the
  amounts, and is the only route to a "won" status.
- **Financials** — revenue, payable, gross profit, expenses and net profit, by
  day, week, month or all time.
- **Performance & campaigns** — per-employee metrics and rankings, per-campaign
  conversion and value per lead.
- **Role isolation** — employees see only their own leads, enforced at the query
  layer by Security Rules rather than hidden in the UI.

## Stack

- **Next.js** (App Router) on **Vercel** — UI, Server Actions, webhook and cron
  route handlers.
- **Cloud Firestore** — database, with realtime `onSnapshot` subscriptions.
- **Firebase Auth** — email/password, with a `role` custom claim.
- **Vercel Cron** (or Google Cloud Scheduler) — drives the SLA deadline sweep.



CHANGES MADE AND PUSHING 
