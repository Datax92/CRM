# Architecture — Lead Management & CRM Platform

Companion to `PRD.md`. This is the document the coding agent should treat as the technical
source of truth. `architecture-essentials.md` is the condensed version to keep loaded every session.

> **The shipped system diverges from this document in three places.** There is no `/functions`
> package (Server Actions on Vercel instead of Cloud Functions), no Cloud Tasks (durable
> deadline timestamps swept by a cron route), and no separate Cloud Scheduler function (the
> same sweep runs the no-follow-up scan). The security model, data model and business rules
> below are all still accurate and still enforced. Read
> **`docs/implementation-notes.md`** alongside this file for what was built instead, why, and
> what it costs — chiefly that deadlines fire on the next sweep rather than to the second.

---

## 1. Tech Stack (Firebase + Vercel)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (React, App Router) | One codebase for Admin + Employee apps; deployed on **Vercel** |
| Backend | **Cloud Functions for Firebase** (2nd gen, Node.js/TypeScript) | Serverless — no server to manage; callable functions handle all privileged writes so business rules live server-side, not in client code |
| Database | **Cloud Firestore** | Realtime by default (no separate WebSocket layer needed), scales automatically, native Firebase Auth integration for security rules |
| Auth | **Firebase Authentication** (email/password) + custom claims for `role` | Custom claim `role: admin\|employee`; `priority` and other mutable fields live in the Firestore `users/{uid}` doc, not in claims (claims are for slow-changing authorization facts, not business data) |
| Job queue / timers | **Cloud Tasks** targeting Cloud Functions | The 5-min assign window and 10-min accept window are business-critical delayed events — Cloud Tasks persists them server-side and survives redeploys, no Redis to run (see §6) |
| Realtime updates | Firestore `onSnapshot` listeners | Firestore pushes changes to the client natively — Admin dashboard subscribes directly, no custom realtime server |
| File storage | Firebase Storage | Expense receipts / supporting documents |
| Meta integration | Meta Lead Ads Webhook → HTTPS Cloud Function | Webhook gives near-instant intake |
| WhatsApp | `wa.me` click-to-chat now; a config seam reserved for the real WhatsApp Business API once the client provides it (see §10) | Matches BR-11; nothing to rebuild later, just fill in credentials |
| Frontend hosting | **Vercel** (per your setup) | Next.js-native, git-connected deploys |
| Backend hosting | **Firebase** (Functions, Firestore, Storage, Cloud Tasks) — same GCP project | Frontend and backend live on different platforms by design here; the Next.js app talks to Firebase via the client SDK (reads/realtime) and callable Functions (privileged writes) |

> Note: this intentionally drops the earlier Postgres/NestJS/Redis draft in favor of an
> all-Firebase backend, per your instruction to build on Firebase with Vercel for hosting.

---

## 2. High-Level System Components

```
Meta Ads ──(webhook)──▶ onMetaLeadWebhook (Cloud Function, HTTPS)
                                │  writes
                                ▼
                     Firestore: leads/{leadId}
                                │  onSnapshot (realtime, no polling)
                                ▼
              Next.js Admin Dashboard (Vercel) ── Firebase client SDK
                                │
              Cloud Tasks: enqueue "assign-deadline" (+5 min)
                     ┌──────────┴──────────┐
        Admin calls assignLead()      Task fires → onAssignDeadline
        (callable Function)                (Cloud Function)
                     │                        │
                     ▼                        ▼
             Employee gets lead      resolveNextAssignee()
                     │              (priority + 8-lead rotation)
                     ▼                        │
       Cloud Tasks: "accept-deadline" (+10 min) ◀──┘
                     │
        ┌────────────┴────────────┐
  Employee calls acceptLead()   Task fires → onAcceptDeadline
        │                          │
        ▼                          ▼
  Lead active, follow-ups   Reassign to next employee
  written via addFollowUp()  + Red Flag doc → notifications/
  (callable Function),           collection → Admin dashboard
  WhatsApp click-to-chat,        realtime alert
  eventually closeDeal()
        │
        ▼
Financial roll-up (Firestore aggregation queries or a scheduled
Function that maintains rollup docs) → Expense module → Net Profit
```

All privileged writes (assign, accept, follow-up creation, closed-deal entry, employee
management, expenses) go through **callable Cloud Functions**, never directly from the client SDK.
Firestore Security Rules then act as defense-in-depth (deny-by-default, only allow the specific
reads the role should have) — see §7.

---

## 3. Data Model (Firestore collections)

```
users/{uid}                      role, name, priority, status, createdAt
                                  (uid = Firebase Auth uid; role also mirrored into a custom claim)

campaigns/{campaignId}           name, metaCampaignId, category

leads/{leadId}                   name, phone, email, campaignId, source, createdAt, status,
                                  assignedUserId, assignedAt, acceptedAt, adminAssignDeadlineAt,
                                  acceptDeadlineAt, distributionMethod, autoRotationCycleSnapshot
  leads/{leadId}/followUps/{id}  message, callMade, callCount, whatsappNote, occurredAt, createdAt,
                                  authorUid — append-only (Security Rules + Functions both refuse
                                  update/delete; see §4.4 and §7)
  leads/{leadId}/events/{id}     type, actorUid, meta, at — audit trail, also append-only

closedDeals/{dealId}             leadId, userId, amountReceived, payableAmount,
                                  profit (computed in the callable Function, not client-trusted),
                                  enteredAt

expenses/{expenseId}             title, category, amount, date, description, addedByUid, noteUrl

committee/{recordId}             title, amount, date, description, addedByUid, createdAt
investments/{recordId}           title, amount, date, description, addedByUid, createdAt
capitalInvestments/{recordId}    title, amount, date, description, addedByUid, createdAt
personalExpenses/{recordId}      title, amount, date, description, addedByUid, createdAt
receivables/{recordId}           title, size, amount, date, addedByUid, createdAt

notifications/{notificationId}   type, leadId, targetRole, payload, createdAt, readAt

config/integrations              single doc: { whatsapp: { enabled, phoneNumberId, ... },
                                  meta: { verifyToken } } — see §10 for the WhatsApp placeholder
```

Firestore is document-oriented, not relational — there's no foreign-key enforcement, so referential
integrity (e.g. "a lead's `campaignId` must exist") is enforced inside the callable Functions, not
the database. Composite indexes will be needed for the common Admin filters (status + campaign +
date, assignedUserId + status) — define these in `firestore.indexes.json` as they come up rather
than guessing all of them up front.

---

## 4. Core Business Logic

### 4.1 Assignment window (BR-3–BR-5)
`onMetaLeadWebhook` (HTTPS Function) writes `leads/{leadId}` with `status=NEW`, then creates a
Cloud Task on the `assign-deadline` queue scheduled for +5 minutes, targeting the
`onAssignDeadline` HTTP Function, with the `leadId` in the payload and the task's `name` set
deterministically from `leadId` (so a duplicate webhook delivery can't double-enqueue it).
- If Admin calls the `assignLead` callable Function before the task fires → it deletes the pending
  Cloud Task, sets `distributionMethod=MANUAL`, `status=ASSIGNED`, enqueues the 10-minute
  `accept-deadline` task.
- If the task fires first → `onAssignDeadline` hands off to the Auto-Distribution Engine (§4.2).

### 4.2 Auto-distribution: priority + 8-lead rotation (proposed concrete algorithm)
The source proposal states the *rule* ("after every 8 leads, rotation moves to the next-priority
employee") without pinning the exact tie-break math. Proposed, buildable interpretation — **confirm
with the Admin before launch** (see PRD Open Question 1):

1. Maintain a per-employee `autoAssignedCount` counter (resets only by explicit admin action, not
   nightly — confirm).
2. Active employees are ordered by priority (1 = highest).
3. The current "turn" employee is whoever has received fewer than 8 leads in the running cycle;
   ties broken by priority order.
4. Once an employee's count in the cycle hits 8, move to the next-priority employee and start their
   count at 0; when the lowest-priority employee completes their 8, wrap back to priority 1.
5. Disabled employees are skipped entirely and do not break the rotation sequence.

Implement this as a pure, unit-testable function (`resolveNextAssignee(employees, cycleState) →
employeeId`) — this is the single highest-risk piece of business logic in the system and needs
dedicated test coverage.

### 4.3 Acceptance window (BR-7–BR-9)
On assignment (manual or auto): enqueue an `accept-deadline` Cloud Task for +10 minutes,
targeting `onAcceptDeadline`.
- Employee calls the `acceptLead` callable Function → deletes the pending task,
  `status=ACCEPTED`, `acceptedAt=now()`.
- Task fires unaccepted → write a `leads/{leadId}/events` doc `{type: EXPIRED}`, automatically reassign to the next highest-priority active employee bypassing the 8-lead rotation sequence for this specific lead (preserving their place/count in the rotation cycle). Create a `notifications/{id}` doc `{type: RED_FLAG}` containing the employee name, lead name, time assigned, acceptance deadline, and reason "Expired", and increment the employee's persistent `missedLeadsCount` count. The Admin dashboard's `onSnapshot` listener on `notifications` picks it up instantly.

### 4.4 Follow-up immutability (BR-13/BR-14)
Enforce at two layers, not just UI: (1) the `addFollowUp` callable Function is the *only* write
path and it only ever does `.add()` (create), never `.update()`/`.delete()` — there is no
`updateFollowUp`/`deleteFollowUp` Function, full stop; (2) Firestore Security Rules on
`leads/{leadId}/followUps/{id}` explicitly `allow update, delete: if false;` for every role,
including Admin, as defense-in-depth against a future Function bug. Corrections are always a new
follow-up document.

### 4.5 Financials & Accounts
`ClosedDeal.profit` is computed inside the `closeDeal` callable Function
(`amountReceived − payableAmount`), never trusted from the client payload. Financial dashboard
reads aggregate either via Firestore queries filtered by date range, or — once volumes grow — via a
scheduled Function that maintains daily/monthly rollup docs (`rollups/{YYYY-MM-DD}`) so the
dashboard doesn't have to sum every document on every page load.
`Net Profit = Σ(profit) − Σ(expenses.amount)` over the selected range.

The **Income Sheet** aggregates three sources in real-time on the client (`useIncomeSheet`):
1. `ClosedDeals` (`amountReceived` as INCOME)
2. `Expenses` (as OFFICE_EXPENSE)
3. `PersonalExpenses` (as PERSONAL_EXPENSE)
The unified ledger sorts these transactions chronologically and calculates the Net Balance.

### 4.6 No-follow-up reminder (FR-18)
A **scheduled Function** (Cloud Scheduler trigger, e.g. every 30 minutes) queries
`leads where assignedUserId != null and status not in (Closed/Won, Closed/Lost)`, checks whether
the lead's most recent `followUps` doc is older than the configurable monitoring window (or absent
entirely), and writes a `notifications/{id}` doc `{type: NO_FOLLOWUP}` — guard against duplicate
notifications for the same breach by checking for an existing unresolved notification for that
`leadId` before creating a new one.

### 4.7 Manual Reassignment
Admins can manually reassign leads to another active employee at any time via the Admin dashboard.
**Constraint**: Reassignment is strictly prohibited if the lead's status is terminal/closed (`CLOSED_WON`, `CLOSED_LOST`, or `NOT_INTERESTED`). Closed leads remain untouched.
Upon reassignment, the new employee is given a fresh 10-minute acceptance window, and an audit trail event (`MANUALLY_REASSIGNED`) is logged with the previous and new assignees.

---

## 5. Function Surface (representative, not exhaustive)

Reads (lists, detail views, dashboards) go straight from the Next.js app to Firestore via the
client SDK + Security Rules — no Function needed for those. Writes and anything privileged go
through callable Functions:

```
# Callable Functions (invoked from the Next.js app via the Firebase client SDK,
# auth token attached automatically)
createEmployee(input)              # Admin only
setEmployeePriority(uid, priority) # Admin only
disableEmployee(uid)               # Admin only
assignLead(leadId, uid)            # Admin only, within the 5-min window
acceptLead(leadId)                 # the assigned Employee, within the 10-min window
reassignLead(leadId, uid)          # Admin, manual override any time
setLeadStatus(leadId, status)      # assigned Employee or Admin
addFollowUp(leadId, input)         # assigned Employee or Admin — create only, ever
closeDeal(leadId, amountReceived, payableAmount)   # assigned Employee or Admin
createExpense(input)               # Admin only
getEmployeePerformance(uid?, range)
getCampaignPerformance(campaignId?, range)
getFinancialSummary(range)

# HTTPS Functions (not callable — hit by external systems)
onMetaLeadWebhook            # Meta Lead Ads → lead intake, signature-verified
onAssignDeadline             # Cloud Tasks target for the 5-min window
onAcceptDeadline             # Cloud Tasks target for the 10-min window

# Scheduled Functions (Cloud Scheduler)
noFollowUpReminderScan       # every 30 min, see §4.6
dailyRollup                  # optional, once reporting volume needs it
```

---

## 6. Background Jobs & Scheduling — why Cloud Tasks, not `setTimeout`

The 5-minute and 10-minute windows are compliance-critical (they *are* the product, per BR-4–BR-9).
An in-process timer dies on redeploy/cold-start and silently breaks the SLA — and Cloud Functions
instances are ephemeral by design, so in-memory timers are a non-starter here regardless. Cloud
Tasks persists the scheduled call server-side (backed by GCP, no infra for you to run) and retries
on failure. Make every task handler idempotent — check the lead's current `status` before acting,
since a task could in principle be delivered more than once (Cloud Tasks is at-least-once).

---

## 7. Security & RBAC

- **Firestore Security Rules** are the outer boundary: default-deny, then explicit `allow` per
  collection based on `request.auth.token.role` and, for leads/follow-ups, `assignedUserId`. This
  is what actually enforces BR-10 (employees only see their own leads) even if a Function has a bug
  — never rely on the client hiding data.
- **Callable Functions** re-check role/ownership server-side before any write — rules are the floor,
  not the only check, since Functions run with Admin SDK privileges that bypass rules.
- Firebase Authentication handles password hashing/sessions; custom claims carry `role` and are set
  via the Admin SDK only (never client-settable).
- The Meta webhook Function verifies Meta's signature header; reject unsigned/invalid payloads.
- Firebase Admin SDK service-account credentials (used by the Next.js app on Vercel for any
  server-side calls) live in **Vercel Environment Variables**, never in the repo — see `AGENTS.md`.
- All financial and follow-up writes logged to `leads/{id}/events` — see PRD §4.11.
- **Frontend Routing**: The login page requires credentials and a role selection. Post-login, users are routed to an intermediate `/home` route, which validates the selected role against the actual Firebase custom claim. Validated users are then redirected to their respective dashboards (`/admin` or `/employee`). Unauthorized access to any protected route (handled by the modular `useProtectedRoute` hook) redirects back to the login page.

---

## 8. File Reference

### Root Configuration
| File | Purpose |
|------|---------|
| `next.config.ts` | Next.js configuration |
| `tsconfig.json` | TypeScript configuration |
| `tailwind.config.ts` | Tailwind CSS configuration (not present - using Tailwind v4 with @theme inline, Light SaaS Theme) |
| `postcss.config.mjs` | PostCSS configuration |
| `eslint.config.mjs` | ESLint configuration |
| `.env.example` | Environment variables template |
| `.gitignore` | Git ignore patterns |
| `package.json` | Project dependencies and scripts |
| `firebase.json` | Firebase configuration |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Firestore composite indexes |
| `storage.rules` | Firebase Storage security rules |
| `vercel.json` | Vercel configuration |

### Source Files

#### App Entry Points & Layout
| File | Exports / Functions | Purpose |
|------|-------------------|---------|
| `src/app/layout.tsx` | `RootLayout` | Root layout with Firebase Auth provider, Poppins font, and metadata |
| `src/app/globals.css` | CSS Tokens, `@theme` | Global design tokens, gradients, animations, and theme styles |
| `src/app/page.tsx` | `LoginPage`, `describeSignInError` | Dual-role (Admin / Employee) login portal with credentials and demo bypass |
| `src/app/home/page.tsx` | `HomePage` | Central dashboard hub with KPI stat cards, sales visualizers, and quick nav |

#### Admin Pages
| File | Component / Functions | Purpose |
|------|----------------------|---------|
| `src/app/admin/page.tsx` | `AdminRedirect` | Redirect helper to `/home?role=admin` or `/admin/leads/new` |
| `src/app/admin/leads/new/page.tsx` | `AdminNewLeadsPage` | 5-minute unassigned lead queue with countdown and manual assign modal |
| `src/app/admin/leads/active/page.tsx` | `AdminActiveLeadsPage` | Real-time active leads pipeline with status badges and detail inspector |
| `src/app/admin/leads/closed/page.tsx` | `AdminClosedLeadsPage` | Closed/Won and Closed/Lost lead archive with deal summaries |
| `src/app/admin/leads/campaigns/page.tsx` | `CampaignsPage` | Real-time campaigns list view with date period filters, detail dossier, and historical campaign intake |
| `src/app/admin/employees/directory/page.tsx` | `EmployeeDirectoryPage` | Employee roster, account creation, activation/deactivation, and deletion |
| `src/app/admin/employees/priority/page.tsx` | `EmployeePriorityPage` | Priority ranking editor (1 to N) for 8-lead rotation distribution |
| `src/app/admin/financials/deals/page.tsx` | `AdminDealsPage` | Closed deals financial ledger (Amount Received, Payable, Net Profit) |
| `src/app/admin/financials/expenses/page.tsx` | `AdminExpensesPage` | Business expense tracking and categorization (Rent, Salaries, Marketing) |
| `src/app/admin/financials/reports/page.tsx` | `AdminReportsPage` | Multi-dimensional performance ranking for employees and campaigns |
| `src/app/admin/accounts/income-sheet/page.tsx` | `IncomeSheetPage` | Unified cash flow ledger combining deals, expenses, and personal draw |
| `src/app/admin/accounts/office-expenses/page.tsx` | `OfficeExpensesPage` | Categorized office operational expenditure module |
| `src/app/admin/accounts/personal-expense/page.tsx` | `PersonalExpensePage` | Personal expenses ledger and drawdown logs |
| `src/app/admin/accounts/committee/page.tsx` | `CommitteePage` | Committee / pooled funds contribution and distribution tracking |
| `src/app/admin/accounts/investment/page.tsx` | `InvestmentPage` | External and internal investment management ledger |
| `src/app/admin/accounts/capital-investments/page.tsx` | `CapitalInvestmentsPage` | Asset and capital expenditure accounting |
| `src/app/admin/accounts/receivable/page.tsx` | `ReceivablesPage` | Outstanding customer receivables, sizes, and collection status |
| `src/app/admin/search/page.tsx` | `AdminSearchPage` | Universal multi-criteria search engine across all leads and records |
| `src/app/admin/settings/page.tsx` | `AdminSettingsPage` | Integrations panel (Meta Lead Ads webhook token, WhatsApp config) |
| `src/app/admin/SelectPill.tsx` | `SelectPill`, `SelectOption` | Branded floating-label dropdown select pill |

#### Employee Pages
| File | Component / Functions | Purpose |
|------|----------------------|---------|
| `src/app/employee/page.tsx` | `EmployeeRedirect` | Redirect helper to `/employee/workspace/leads` |
| `src/app/employee/workspace/pending/page.tsx` | `EmployeePendingPage` | 10-minute acceptance queue with timer and one-click Accept |
| `src/app/employee/workspace/leads/page.tsx` | `EmployeeLeadsPage` | Main employee dashboard for active assigned leads pipeline |
| `src/app/employee/workspace/active/page.tsx` | `EmployeeActivePage` | In-progress contacted leads with quick WhatsApp and follow-up entry |
| `src/app/employee/workspace/closed/page.tsx` | `EmployeeClosedPage` | Employee converted clients archive and deal history |
| `src/app/employee/performance/stats/page.tsx` | `EmployeeStatsPage` | Personal KPI metrics, conversion ratios, and closed deal records |

#### API Routes
| File | Function | Purpose |
|------|----------|---------|
| `src/app/api/cron/process-deadlines/route.ts` | `GET`, `POST` | Sweeps 5-min assign timeouts, 10-min accept timeouts, and no-follow-up alerts |
| `src/app/api/webhooks/meta/route.ts` | `GET`, `POST` | Handles Meta Lead Ads webhook verification and automatic lead ingestion |

#### Server Actions (`src/app/actions/`)
| File | Functions | Purpose |
|------|-----------|---------|
| `leads.ts` | `assignLead`, `acceptLead`, `reassignLeadManual`, `setLeadStatus`, `createManualLead` | Core lead lifecycle operations, assignments, status transitions |
| `campaigns.ts` | `createCampaign` | Admin campaign creation and historical marketing archive records |
| `employees.ts` | `createEmployee`, `setEmployeePriority`, `disableEmployee`, `enableEmployee`, `deleteEmployee` | Admin employee provisioning, priority ranking, account status |
| `closedDeals.ts` | `closeDeal`, `getClosedDeals` | Immutable closed deal recording with automated profit calculation |
| `expenses.ts` | `addExpense`, `getExpenses` | Company expense entry and historical querying |
| `accounts.ts` | `createAccountRecord`, `getAccountRecords` | Multi-category accounting entries (Committee, Investments, Capital, Personal) |
| `receivables.ts` | `createReceivableRecord`, `getReceivableRecords` | Customer receivables and pending debt entries |
| `followUps.ts` | `addFollowUp` | Append-only immutable customer follow-up recording |
| `notifications.ts` | `markNotificationRead`, `markAllNotificationsRead` | Admin and employee alert acknowledgment |
| `whatsapp.ts` | `sendWhatsAppMessage` | Placeholder for future WhatsApp Business API integration |
| `config.ts` | `getIntegrationsConfig`, `updateIntegrationsConfig` | System integration configuration persistence |

#### Components
| File | Component / Functions | Purpose |
|------|----------------------|---------|
| `src/components/GlobalLayout.tsx` | `GlobalLayout` | Shared navigation shell with collapsible accordion sidebar, top nav, profile |
| `src/components/BrandLogo.tsx` | `BrandLogo` | Standardized SVG brand logo and typography header |
| `src/components/LeadCard.tsx` | `LeadCard` | Modern lead summary card with status badges, timer countdowns, and quick actions |
| `src/components/LeadDetailModal.tsx` | `LeadDetailModal` | Comprehensive lead dossier: call logs, immutable follow-ups, WhatsApp, Close Deal |
| `src/components/NotificationsPanel.tsx` | `NotificationsPanel` | Realtime notification bell flyout for red flags, assignments, reminders |
| `src/components/DemoBanner.tsx` | `DemoBanner` | Persistent banner indicating demo sandbox environment |
| `src/components/admin/AdminShared.tsx` | `ResponsiveTableWrapper`, `TableRow`, `TableCell`, `Banner`, `Kpi`, `LeadSection`, `LabelledInput`, `FullPageSpinner` | Shared modular table and layout primitives |
| `src/components/admin/AssignModal.tsx` | `AssignModal` | Manual assignment and reassignment popup dialog |

#### UI Components
| File | Component / Functions | Purpose |
|------|----------------------|---------|
| `src/components/ui/kinetic-grid.tsx` | `KineticGrid` | Canvas-based interactive physics-driven kinetic grid with pointer warping and ripple reactions |
| `src/components/ui/AdminTable.tsx` | `TablePanel`, `AdminTable`, `AdminThead`, `AdminTbody`, `AdminTh`, `AdminTd`, `AdminTr`, `EmployeeStatusBadge`, `TabSectionHeading`, `EmptyTableState` | Responsive table building blocks |
| `src/components/ui/Modal.tsx` | `Modal` | Reusable modal dialog container |

#### Hooks & Context
| File | Hook / Context | Purpose |
|------|----------------|---------|
| `src/context/AuthContext.tsx` | `AuthProvider`, `useAuth` | Global authentication state, Firebase / Demo session manager, sign in/out |
| `src/hooks/useLeads.ts` | `useLeads` | Real-time Firestore subscription for leads with role-based filtering |
| `src/hooks/useCampaigns.ts` | `useCampaigns` | Real-time campaigns subscription, auto-discovery from leads, and date range metric rollups |
| `src/hooks/useEmployees.ts` | `useEmployees` | Real-time employee roster, priorities, and status |
| `src/hooks/useFinancials.ts` | `useFinancials`, `useMyDeals` | Aggregates closed deals, expenses, gross and net profit calculations |
| `src/hooks/useIncomeSheet.ts` | `useIncomeSheet` | Real-time cash ledger combining revenue, office expenses, and personal draws |
| `src/hooks/useAccounts.ts` | `useAccounts` | Generic hook for accounts sub-ledgers (committee, investments, etc.) |
| `src/hooks/useReceivables.ts` | `useReceivables` | Real-time subscription to customer receivables records |
| `src/hooks/useProtectedRoute.ts` | `useProtectedRoute` | Route guard redirecting unauthenticated or wrong-role users |

#### Libraries & Utilities (`src/lib/`)
| File | Exports / Functions | Purpose |
|------|-------------------|---------|
| `src/lib/utils.ts` | `cn` | Class name combination helper |
| `src/lib/actionResult.ts` | `ok`, `err`, `ActionResult` | Typed standard return format for server actions |
| `src/lib/clientActions.ts` | Multiple action dispatchers | Client wrappers bridging Demo mode memory store and live Server Actions |
| `src/lib/dates.ts` | `resolveRange`, `formatBusinessDate`, `formatBusinessDateTime`, `RANGE_LABELS` | Date formatting and time range filter helpers |
| `src/lib/distribution.ts` | `resolveNextAssignee` | Priority-based 8-lead rotation distribution algorithm |
| `src/lib/leadStatus.ts` | `LEAD_STATUS_LABELS`, `TERMINAL_STATUSES`, `LeadStatus` | Lead pipeline status definitions and terminal status flags |
| `src/lib/meta.ts` | `parseMetaWebhookPayload`, `verifyMetaSignature` | Meta Lead Ads payload decoding and cryptographic HMAC verification |
| `src/lib/metrics.ts` | `buildEmployeeMetrics`, `buildCampaignMetrics`, `rankEmployees`, `RANKING_OPTIONS` | Performance, conversion rate, and revenue calculations |
| `src/lib/money.ts` | `formatMoney`, `formatNegativeMoney` | Pakistani Rupee currency formatting |
| `src/lib/phone.ts` | `formatPhone`, `buildWhatsAppUrl` | International phone formatting and WhatsApp click-to-chat URL builder |
| `src/lib/demo/store.ts` | `useDemoStore`, `signInDemo`, `signOutDemo`, `IS_DEMO` | In-memory reactive store simulating full CRM lifecycle without backend |
| `src/lib/firebase/client.ts` | `initFirebase`, `getFirebaseServices` | Client-side Firebase SDK initialization |
| `src/lib/firebase/config.ts` | `getFirebaseConfig` | Validated Firebase web configuration loader |
| `src/lib/firebase/server.ts` | `initAdminFirebase` | Firebase Admin SDK singleton for server-side execution |
| `src/lib/firebase/serverAuth.ts`| `requireAdmin`, `requireAuth` | Server Action token and role authorization verifier |
| `src/lib/constants/monitoring.ts` | `NO_FOLLOWUP_THRESHOLD_MS` | Configurable SLA threshold for no-follow-up alerts (24 hours) |

---

## 9. Environments & Deployment

- **Frontend:** Vercel, connected to the git repo (already configured) — every push to `main`
  deploys production, PRs get preview deployments automatically.
- **Backend:** Firebase — `firebase deploy --only functions,firestore:rules,firestore:indexes`.
  Recommended: a `firebase use` alias per environment (`staging`, `production`) mapping to separate
  Firebase projects, so schema/rule changes can be tested before they touch real leads.
- **Local dev:** Firebase Emulator Suite (`firebase emulators:start`) for Firestore/Auth/Functions/
  Tasks, `vercel dev` (or `next dev`) for the frontend pointed at the emulators.
- **Secrets:** Vercel Environment Variables for anything the Next.js app needs (Firebase web config
  is public by design; the Admin SDK service-account key, if the app needs server-side Admin access,
  is a Vercel secret env var, never committed). Cloud Functions get their own secrets via
  `firebase functions:secrets:set` (Meta app secret/verify token, and later the WhatsApp API key —
  see §10).

---

## 10. WhatsApp Integration Seam (credentials pending)

The client will provide WhatsApp Business API credentials later. Build the *shape* of the
integration now, switched off, so there's no rework when the keys arrive:

- `config/integrations` Firestore doc carries `whatsapp: { enabled: false, phoneNumberId: null }`.
- Add a `sendWhatsAppMessage(leadId, message)` function in `/functions/src/whatsapp.ts` now, with
  the real HTTP call stubbed behind an `if (!config.enabled) return { skipped: true }` guard, so
  future call sites can be wired up today without knowing the final API details.
- Reserve secret names `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` via
  `firebase functions:secrets:set` — leave unset until the client hands them over.
- When credentials arrive: set the two secrets, flip `config/integrations.whatsapp.enabled` to
  `true`, fill in the real fetch call. No schema change, no new call sites.
- Full detail: `docs/integrations/whatsapp-placeholder.md`.

---

## 11. UI Standards & Component Library

- **Modals**: Text contrast rules applied for labels and inputs (`src/components/ui/Modal.tsx`).
- **Date & Time Picker**: Custom modern date and time selection interface (`src/components/ui/DateTimePicker.tsx`) supporting single date and combined datetime modes with sleek calendar matrix, month/year navigation, 12-hour/AM/PM time steppers, and quick action presets. Integrated globally via `LabelledInput` (`AdminShared.tsx`), `LeadDetailModal.tsx`, and `admin/leads/new/page.tsx`.
- **Custom Select**: Modern dropdown component (`src/components/ui/CustomSelect.tsx`) featuring status badges, icons, subtext descriptions, check indicators, animated chevrons, and outside-click dismiss.
- **Tables**: Strict fluid width (`w-full`) to prevent horizontal scroll overflow on desktop.
- **Sidebar**: Implemented custom subtle vertical scroll (`overflow-y-auto`).

## 12. Frontend Theme Layer (2026-08-24)

- Scope: UI-only redesign with zero backend/integration changes.
- Global theme source: `src/app/globals.css` defines branded color tokens (Purple `#A05AFF`, Coral `#FE7096`, Teal `#1BCFB4`, Sky Blue `#4BCBEB`), typography (`Poppins`), and custom gradient utilities (`.card-coral-gradient`, `.card-blue-gradient`, `.card-teal-gradient`, `.card-purple-gradient`).
- Branding: `src/components/BrandLogo.tsx` is the shared logo mark/text entry point used in authenticated shell and auth screen.
- Layout: `src/components/GlobalLayout.tsx` provides the responsive sidebar with user profile snippet, active item indicators, top search navigation, notifications panel, and profile dropdown.
- Dashboard: `src/app/home/page.tsx` delivers the authentic Purple Admin experience with stat cards, visit & sales statistics visualizer, traffic sources doughnut chart, and Quick Access cards.
- Authentication: `src/app/page.tsx` offers animated drift background with interactive Admin/User toggle and clean form inputs.
- Shared UI propagation: visual changes are centralized in `GlobalLayout`, `AdminShared`, `AdminTable`, `LeadCard`, `LeadDetailModal`, `SelectPill`, `Modal`, `DateTimePicker`, `CustomSelect`, and `NotificationsPanel` to update all route surfaces consistently.
