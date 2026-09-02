# Implementation Notes — where the build diverges from `architecture.md`

`architecture.md` is the original technical design. This file records where the
shipped system deliberately differs from it, and why. Read both: the design doc
explains the intent, this one explains what the code actually does.

---

## 1. No Cloud Functions — Next.js Server Actions instead

**Design:** a `/functions` package of callable Cloud Functions handling every
privileged write, deployed to Firebase.

**Built:** Next.js Server Actions in `src/app/actions/`, deployed to Vercel with
the rest of the app. There is no `functions/` directory.

**Why it still satisfies the design's requirements:**

- Privileged writes remain server-side. Server Actions run on the server only;
  the browser calls them by reference and never sees the Firebase Admin SDK.
- Role and ownership are re-checked server-side on every action, via
  `verifyAuth`/`requireAdmin` in `src/lib/firebase/serverAuth.ts`.
- Firestore Security Rules remain the outer boundary and deny all client writes,
  exactly as §7 specifies.

**What it costs:** one fewer deployment target and no Firebase Functions billing,
at the price of the Vercel/Firebase split being slightly more tangled — the
Next.js app now needs Admin SDK service-account credentials, which the original
design treated as optional.

`firebase.json` no longer declares a `functions` codebase. It previously pointed
at a directory that did not exist, which made `firebase deploy` fail outright.

---

## 2. No Cloud Tasks — a scheduled sweep instead

**Design:** §6 argues for Cloud Tasks, one durable delayed job per deadline, and
explicitly rules out in-memory timers.

**Built:** deadlines are stored as timestamps on the lead document
(`adminAssignDeadlineAt`, `acceptDeadlineAt`) and a cron-triggered route,
`/api/cron/process-deadlines`, acts on whatever has expired.

**Why this is acceptable:** the design's core objection to `setTimeout` was that
in-memory timers die on redeploy. Timestamps in Firestore have the same
durability property as a Cloud Task — nothing is held in process memory, and a
redeploy mid-window changes nothing. Every handler re-reads the lead's status
inside a transaction before acting, so repeated or overlapping runs are safe.

**What it costs:** precision. A Cloud Task fires at the deadline; a sweep fires
at the next scheduled run. **The effective window is the SLA plus up to one cron
interval** — a "5-minute" window is really 5 to 6 minutes at a one-minute
schedule. Confirm this is acceptable to the client, since BR-4 and BR-7 state
the windows precisely.

Scheduling is configured in `vercel.json`. Note that Vercel's Hobby tier limits
cron frequency; a per-minute schedule needs a paid plan, or an external
scheduler (Google Cloud Scheduler's free tier covers it) calling the same URL
with the `CRON_SECRET` bearer token. Verify current tier limits before relying
on either.

---

## 3. No Cloud Scheduler — the same sweep does the follow-up scan

§4.6 specifies a separate scheduled Function for the no-follow-up reminder. It
runs inside the same sweep instead. To keep it a single indexed query rather
than a subcollection read per lead, leads carry a denormalised `lastActivityAt`,
stamped on assignment and refreshed by every follow-up.

The monitoring window defaults to 24 hours and is read from
`config/monitoring.noFollowUpHours`, satisfying FR-18's "configurable"
requirement. Note this is 24 *clock* hours, not the 24 *business* hours the PRD
proposed — see the open questions below.

---

## 4. Additions not in the original design

| Field / collection | Why |
|---|---|
| `leads.attemptedAssignees` | Stops a lead ping-ponging between two employees forever. Anyone who has already let the window lapse is excluded from later automatic passes. PRD §8 question 4 asked what should happen; this is the proposed answer — the lead parks in `UNASSIGNED_NO_CAPACITY` for the admin once everyone has had a turn. |
| `leads.lastActivityAt` | Makes the no-follow-up scan one query. See §3. |
| `leads.intakeWarning` | Records that Meta contact details could not be retrieved, so an empty-looking lead explains itself. |
| `closedDeals.customer` | The Entry Module (BR-18) records a full customer record, not just amounts. See §5. |
| `closedDeals` doc id = lead id | Makes closing a deal idempotent. A double-submitted form is rejected rather than double-counting revenue. |
| `config/monitoring` | Holds `noFollowUpHours`. |

---

## 5. The Entry Module captures a customer record

FR-20 says the employee enters "customer info + Amount Received + Payable
Amount". The first part was previously missing — the form took two numbers.

A lead arrives from Meta with whatever the customer typed into an ad form, which
is rarely what belongs in a permanent business record. At the point of sale the
employee now confirms and completes the details, and that confirmed version is
what is kept:

```
closedDeals/{leadId}
  customer: { name, phone, email, cnic, address, city }
  serviceDescription      what was actually sold
  paymentMethod           Cash | Bank Transfer | Cheque | Easypaisa | JazzCash | Card | Other
  dealDate                may be backdated, never postdated
  notes
  amountReceived, payableAmount, profit
  userId                  the employee credited with the sale
  enteredByUid            whoever typed the form (an admin may act for them)
  campaignId, campaignName  denormalised for campaign reporting
```

`CLOSED_WON` is unreachable through the ordinary status dropdown. `closeDeal` is
the only path into it, which is what makes BR-18 ("closed customers must go
through the Entry Module") true rather than merely intended.

**Confirm with the client:** the `cnic`, `address`, `city`, `paymentMethod` and
`serviceDescription` fields are a reasonable guess at what a Pakistani sales
business records at close. Only name, phone and description are required. Adjust
the set before real data accumulates — these records are append-only by design.

---

## 6. Currency and timezone

All amounts are PKR, formatted with `Intl.NumberFormat('en-PK')` via
`src/lib/money.ts`. All reporting periods are computed in Asia/Karachi via
`src/lib/dates.ts`, so "today" means the local working day rather than a UTC
day starting at 05:00 local.

Phone numbers are normalised to E.164 in `src/lib/phone.ts` before being used in
`wa.me` links. A local `0300-1234567` becomes `923001234567`; stripping
non-digits alone produces `03001234567`, which WhatsApp cannot route.

---

## 7. Still open — needs the client's answer

These are shipped as assumptions. Changing them later means migrating data.

1. **The 8-lead rotation.** Implemented as: the highest-priority employee takes
   eight, then the next priority takes eight, wrapping around at the bottom.
   Only automatic assignments advance the counters — a lead the admin hands out
   manually inside the 5-minute window does not consume anyone's eight. This is
   the behaviour the system already had and has been left unchanged rather than
   quietly adjusted.
2. **The no-follow-up window.** 24 clock hours. The PRD proposed 24 business
   hours.
3. **Deadline precision.** Deadlines fire on the next sweep, not at the exact
   second. See §2.
4. **Customer record fields.** See §5.
5. **Correcting a deal entry.** Deal records are currently immutable, consistent
   with the "nothing financial is hard-deleted" invariant. There is no
   correction flow — decide whether admins need one, and if so whether it should
   be an adjusting entry rather than an edit.
