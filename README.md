# CRM System

Lead Management & CRM Platform. Ingests leads from Meta Lead Ads, distributes
them to employees under a timed priority rotation, records every follow-up
immutably, and rolls up closed-deal financials against office expenses.

Built for a Pakistan-based sales business: amounts in PKR, reporting periods in
Asia/Karachi, phone numbers normalised to +92.

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

The original design in `architecture.md` called for Cloud Functions and Cloud
Tasks. See [`docs/implementation-notes.md`](docs/implementation-notes.md) for
what was built instead and why.

## Getting started

### See it working in two minutes, with no Firebase

```bash
npm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_DEMO_MODE=true` in `.env.local`, then:

```bash
npm run dev
```

Sign in at http://localhost:3000 with **`admin@crm.com`** / **`Demo12345`**
(or `ayesha@crm.com`, `bilal@crm.com`, `sana@crm.com` for the employee view).

Everything is in memory and fully interactive — assign a lead, accept it, log a
follow-up, record a deal. Nothing is saved and no backend is contacted. An amber
banner marks every screen so it can never be mistaken for live data.

### Connecting your own Firebase project

1. Create a Firebase project, then **Authentication → Sign-in method → enable
   Email/Password**. Skipping this is the single most common setup failure: no
   account can sign in and the error looks like a wrong password.
2. Put your project id in `.firebaserc` (it currently points at another project).
3. Fill in the `NEXT_PUBLIC_FIREBASE_*` values from
   `firebase apps:sdkconfig web`, and set `NEXT_PUBLIC_DEMO_MODE=false`.
4. Add a service account key — `FIREBASE_CLIENT_EMAIL` and
   `FIREBASE_PRIVATE_KEY`. Without it every privileged write fails.
5. `npm run deploy:rules` to push the Security Rules and indexes.
6. `npm run set-admin-role -- you@yourcompany.com` to create the first admin.
7. `npm run check-auth -- you@yourcompany.com '<password>'` to confirm it worked
   before opening a browser.

Full detail, in dependency order, in
[`docs/deployment-runbook.md`](docs/deployment-runbook.md). The order matters —
deploying the rules before the service account exists takes the app offline.

Meta Lead Ads intake and the SLA timers need credentials and a cron schedule;
see [`SETUP_STATUS.md`](SETUP_STATUS.md) for exactly what is still outstanding.

### Commands

```bash
npm run check           # typecheck + unit tests + lint
npm run test            # unit tests only
npm run deploy:rules    # Firestore rules, indexes and Storage rules
npm run set-admin-role -- you@company.com
npm run check-auth -- you@company.com '<password>'   # diagnose sign-in problems
npm run purge-demo-data # remove seeded demo records from the live project
```

## Documentation

| File | What it covers |
| --- | --- |
| [`PRD.md`](PRD.md) | Functional requirements and the 22 numbered business rules |
| [`architecture.md`](architecture.md) | Original technical design |
| [`docs/implementation-notes.md`](docs/implementation-notes.md) | Where the build diverges from that design, and the assumptions still awaiting client sign-off |
| [`docs/deployment-runbook.md`](docs/deployment-runbook.md) | Step-by-step deployment, in dependency order |
| [`docs/integrations/whatsapp-placeholder.md`](docs/integrations/whatsapp-placeholder.md) | The switched-off WhatsApp send seam (Phase 2) |
