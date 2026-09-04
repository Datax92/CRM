# Deployment Runbook

Order matters. Steps 1–3 must happen together: tightening the Security Rules
before the server has credentials would take the app offline, because there is
no longer any client-side write path to fall back on.

---

## 0. Enable Email/Password sign-in

Firebase console → **Authentication** → **Sign-in method** → **Email/Password** →
Enable → Save. If Authentication has never been opened on the project, it will
ask you to "Get started" first.

This is easy to miss and produces a sign-in failure that looks like a wrong
password. Nothing else in the app exercises the auth provider, so the omission
stays invisible until someone tries to log in. The symptom is
`auth/configuration-not-found`, and no account can sign in until it is fixed.

Check it at any time with:

```bash
npm run check-auth -- someone@yourcompany.com 'their-password'
```

That reports the exact Firebase error code and, on success, whether the account
carries a role claim — which is the difference between being signed in and being
able to use the CRM.

## 1. Firebase service account

Firebase console → Project settings → Service accounts → **Generate new private
key**. Keep the JSON out of the repo.

Set three variables in Vercel (Project → Settings → Environment Variables), for
Production *and* Preview:

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `cms-system-crm` |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the JSON |
| `FIREBASE_PRIVATE_KEY` | `private_key` from the JSON |

For `FIREBASE_PRIVATE_KEY`, paste the real multi-line key into the Vercel
dashboard. In a local `.env.local`, wrap it in double quotes and keep the `\n`
sequences literal instead.

Locally, copy `.env.example` to `.env.local` and fill in the same values plus
the `NEXT_PUBLIC_FIREBASE_*` web config.

## 2. Create the first administrator

Role lives in a Firebase custom claim that only the Admin SDK can set. There is
deliberately no way to make yourself an admin from inside the app.

```bash
npm run set-admin-role -- you@yourcompany.com
```

Creates the account if it does not exist (it will prompt for a password), sets
the claim, writes the `users/{uid}` profile, and revokes existing sessions so
the new claim takes effect. **Sign out and back in afterwards.**

Run it again for any other admin.

## 3. Deploy Security Rules and indexes

```bash
npm run deploy:rules
```

Equivalent to `firebase deploy --only firestore:rules,firestore:indexes,storage`.

Until this runs, the database is wide open. Verify afterwards in the Firebase
console that the rules match `firestore.rules` — the previous version allowed
unauthenticated read and write on every collection.

Index builds take a few minutes on a populated database. Until they finish, the
dashboard may report that a view needs an index.

### 3a. Indexes without the Firebase CLI

`npm run deploy:rules` needs the Firebase CLI and an interactive login. If it is
not installed, the service account in `.env.local` can create the indexes on its
own:

```bash
npm run deploy:indexes -- --dry   # list what is missing
npm run deploy:indexes            # create it
npm run check:indexes             # confirm every one is READY
```

This reads `firestore.indexes.json` and creates both kinds of thing in it:

- **composite indexes**, and
- **field overrides** — what the console calls *Single field → Add exemption*.
  `followUps.dayKey` is the one that matters: Firestore's automatic single-field
  indexes are **collection-scoped only**, so `collectionGroup('followUps')` has
  nothing to run on until the override exists, and the Team report falls back to
  one query per lead and says so on screen.

**It needs one IAM role first**, and the error says so if it is missing —
`The caller does not have permission`. A Firebase service account can read and
write documents but cannot manage indexes until you grant it:

> Google Cloud console → **IAM & Admin → IAM** →
> https://console.cloud.google.com/iam-admin/iam?project=leadway-crm
>
> Find `firebase-adminsdk-…@leadway-crm.iam.gserviceaccount.com`, click the
> pencil, **Add another role** → **Cloud Datastore Index Admin** → **Save**.

That role permits index management and nothing else. Wait a minute for it to
propagate, then run `npm run deploy:indexes` again.

**Doing it by hand instead.** The console path is *Firestore Database →
Indexes → Single field* tab → **Add exemption** → collection group `followUps`,
field path `dayKey`, then tick **Collection group** scope with **Ascending**.
The tab is easy to miss because it sits beside *Composite* rather than under
the composite list. The script is the better route when several are missing —
there are 14 composite indexes owed as well.

## 4. Remove the demo records from production

An earlier seed script wrote fictional leads, expenses and a fictional deal into
the live project, plus three employee profiles with no matching Auth accounts.

```bash
npm run purge-demo-data              # dry run — lists what would be deleted
npm run purge-demo-data -- --confirm # actually deletes
```

## 5. Scheduler

Generate a secret and set it in Vercel as `CRON_SECRET`:

```bash
openssl rand -hex 32
```

`vercel.json` already declares the schedule. Vercel Cron sends the secret
automatically as `Authorization: Bearer $CRON_SECRET`. The endpoint returns 503
if the variable is unset and 401 if the header is wrong, so it fails closed.

**Check your plan's cron limits.** The declared schedule is every minute, which
Hobby does not allow. Two options:

- Upgrade to Pro, or
- Remove the `crons` block from `vercel.json` and use Google Cloud Scheduler
  instead — free tier covers three jobs. Target
  `https://<your-domain>/api/cron/process-deadlines`, method GET, with header
  `Authorization: Bearer <CRON_SECRET>`.

Verify it is running:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/process-deadlines
```

Expect `{"ok":true,"autoAssigned":0,"reassigned":0,"noFollowUpAlerts":0,...}`.

Until this is scheduled, nothing enforces the 5-minute or 10-minute windows.

## 6. Meta Lead Ads

Needs credentials from whoever administers the Meta Business Manager. See the
Meta section of `.env.example` for the full list. Set in Vercel:

- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN` (any string you choose)
- `META_PAGE_ACCESS_TOKEN` (needs `leads_retrieval`)

Then in the Meta app dashboard → Webhooks → Page:

- Callback URL: `https://<your-domain>/api/webhooks/meta`
- Verify token: the same string as `META_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **`leadgen`** field
- Subscribe the specific Page running the ads

Test with the [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing).
A test lead should appear on the admin dashboard within seconds, with the name
and phone number filled in.

If leads arrive named "Meta lead 123…" with no contact details, the page access
token is missing or lacks `leads_retrieval` — the lead detail view will say so.

`leads_retrieval` requires Advanced Access, which requires Meta business
verification. Start that early; it can take days.

## 7. Verify end to end

1. Sign in as the admin. The dashboard loads with no error banner.
2. Add an employee. They receive an email and password from you.
3. Sign in as that employee in a private window — they see only their own leads.
4. Submit a test lead from Meta. It appears under "Waiting for assignment" with
   a live 5-minute countdown.
5. Leave it. Within a minute of the countdown expiring, it auto-assigns and a
   10-minute acceptance countdown starts.
6. Let that lapse too. The lead moves to the next employee and a red flag appears
   in the admin's alerts.
7. Accept a lead as the employee, log a follow-up, then record a deal entry.
   The deal appears in the admin's **Deal entries** tab and in the financial
   totals.

## Local development

```bash
npm install
npm run dev
```

`npm run check` runs typecheck, unit tests and lint together — worth running
before any deploy.

To work against the Firebase Emulator Suite instead of the live project, set
`NEXT_PUBLIC_USE_EMULATORS=true` and run `firebase emulators:start`.

---

## Rollback

Rules and indexes are versioned in the repo; redeploy a previous commit with
`npm run deploy:rules`. Vercel keeps previous deployments and can promote one
instantly. Nothing in this system hard-deletes lead, follow-up or financial
data, so a bad deploy does not destroy records.
