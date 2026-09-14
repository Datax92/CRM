# Lead sweep cron (Railway)

Drives the CRM's **5-minute accept window** by calling
`/api/cron/process-deadlines` on the deployed app every five minutes.

## Why this is not on Vercel

Vercel's **Hobby plan allows one cron run per day**. The CRM's accept window is
five minutes: an employee is offered a lead, and if they do not answer it has to
cascade to the next person in the priority lane. On a daily schedule the
countdown reached 0:00 and the lead sat with the person who never answered until
the small hours. Railway's cron minimum is exactly five minutes, which is the
interval this needs.

`recalculate-priorities` and `mark-absentees` stay on Vercel's scheduler —
both are daily by nature, so a daily cron is all they need.

**The Vercel daily run of `process-deadlines` is deliberately left in place** as
a backstop. The sweep is idempotent, so the two schedules cannot conflict: if
Railway is ever down, the nightly run still clears the backlog.

## What it does, and what it deliberately does not

It makes one authenticated GET request and logs the response. **Every rule —
who is next in the lane, the force-accept floor at the bottom, the transaction
that re-checks each lead before touching it — lives in the CRM.** A second
implementation of "who gets this lead", running on a different host, is how two
systems start disagreeing about the same lead. There isn't one here.

## Setup

1. **Railway → New Project → Deploy from GitHub repo** → this repository.
2. **Settings → Source → Root Directory**: `ops/lead-cron`
3. **Settings → Deploy → Cron Schedule**: `*/5 * * * *`
   (Railway's minimum interval is 5 minutes. A run is skipped if the previous
   one is still going, which is the behaviour you want.)
4. **Settings → Networking**: no public domain. Nothing should be able to reach
   this service from outside.
5. **Variables**:

   | Variable | Value |
   |---|---|
   | `CRM_URL` | `https://crm-seven-pi-55.vercel.app` (no trailing slash, must be https) |
   | `CRON_SECRET` | **the same value as `CRON_SECRET` in the Vercel project** |

   The route compares the secret byte for byte and fails closed. Get the value
   from Vercel → the CRM project → Settings → Environment Variables, or from
   `.env.local`. A mismatch shows as `401` on every run; a CRM with no secret at
   all shows as `503`.

## Reading the logs

A healthy run:

```
[sweep] /api/cron/process-deadlines → 200 in 840ms: {"ok":true,"autoAssigned":0,"reassigned":1,"noFollowUpAlerts":0,"durationMs":812}
[sweep] done — 1 target(s) swept.
```

`reassigned` is the number of leads whose accept window lapsed and which
cascaded to the next person in the lane — so the log is a record of the lane
working, not just of the request succeeding.

Failures exit non-zero, so a broken run shows as failed in Railway rather than
as a green tick with an error buried in the output.

## Cost

At `*/5` that is 288 runs a day. Both expiry queries are bounded and return
nothing when nothing is due, and the stale-lead alert is gated to once per
Karachi day by a marker document — roughly **860 Firestore reads a day**
against the free tier's 50,000. Writes happen only when something has actually
expired, which is the point of running it.

## Other variables

| Variable | Default | Purpose |
|---|---|---|
| `CRON_TARGETS` | `/api/cron/process-deadlines` | Comma-separated paths, if you ever move another job here |
| `CRON_TIMEOUT_MS` | `75000` | The route declares `maxDuration = 60`; this allows that plus the round trip |
