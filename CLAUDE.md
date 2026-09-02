# CRM — Agent Context

Lead Management & CRM for Meta Ads intake, fair employee distribution, immutable follow-ups, and financial reporting. **Admin → Sub Admin → Employee** roles.

## Docs (read before building)

| File | Purpose |
|------|---------|
| `PRD.md` | Product requirements, roles, business rules (BR-1–BR-22), functional reqs |
| `architecture.md` | Tech stack, Firestore model, assignment/accept timers, security |
| `docs/implementation-notes.md` | **Shipped vs planned** — Server Actions + cron sweep instead of Cloud Functions/Tasks |
| `docs/deployment-runbook.md` | Deploy steps |
| `docs/integrations/whatsapp-placeholder.md` | WhatsApp API seam (Phase 1 = click-to-chat) |

## Stack

- **Frontend:** Next.js App Router on Vercel (`src/app/`)
- **Backend:** Firebase (Auth, Firestore, Storage) — privileged writes via Server Actions (`src/app/actions/`)
- **Timers:** Deadline timestamps + `/api/cron/process-deadlines` (not in-memory `setTimeout`)
- **Meta intake:** `/api/webhooks/meta`

## Key business rules (do not deviate without sign-off)

- New leads → Admin **5-min** manual assign window → auto-distribution (priority + **8-lead rotation**)
- Assigned employee → **5-min** accept window → cascade down the priority lane + red flag on miss
- The **last employee in the lane is force-accepted** — no window, cannot decline
- **Admin assign / reassign / create-with-assignee are force accepts** — straight to ACCEPTED, no timer
- Employee priority scale is **1–10** (1 = front of the lane)
- Follow-ups are append-only (no edit/delete)

## Lead Distribution & Acceptance Workflow

- **5-minute Admin Window**: New leads sit in the Admin Dashboard for exactly 5 minutes allowing for manual assignment.
- **Auto-Distribution**: If unassigned after 5 minutes, the system auto-assigns the lead to active employees using Priority sorting (1 -> 10) and an **8-lead rotation logic** (after 8 consecutive leads, the next employee is selected). Rotation governs incoming volume only.
- **5-minute Acceptance Window**: The assigned employee has 5 minutes to click "Accept". On a miss the lead cascades strictly down the priority lane, skipping anyone who already let it expire (`resolveCascadeAssignee`).
- **Forced accept floor**: when one candidate remains — or everyone has had a turn — that employee (the lowest active priority) takes the lead with **no window and no way to decline**. A lead cannot reach `UNASSIGNED_NO_CAPACITY` while an active roster exists.
- **Admin actions bypass the lane**: assign, reassign, and create-with-assignee write `ACCEPTED` immediately. Only automatic distribution offers a window.
- **Manual entry splits by date**: created today → joins the lane; backdated before the start of the Karachi business day → historical backfill, stays parked for the admin.
- **Red Flags**: If an employee misses the accept window, the system records a `missedLeadsCount` increment and sends a detailed `RED_FLAG` notification with the lead and employee details to the admin.
- **Manual Reassignment Rules**: Admins can manually reassign leads at any time via the Admin dashboard, provided the lead is not in a Closed status ("Closed Won", "Closed Lost", "Not Interested"). Closed leads cannot be reassigned.
- Follow-ups are append-only (no edit/delete)
- **Pipeline Status** is the formal state machine (`leadStatus.ts`); **Pipeline
  Stage** is the commercial read — **Cold → P3 → P2 → P1**, derived on read in
  `pipelineStage.ts`, overridable by hand. They are two different things and the
  UI names them apart.
- **KYC is the client record**, and **every field on it is optional**. Saving it
  rewrites the lead's name / phone / email / city and pre-fills Deal Entry
  (CNIC, address). See `lib/kyc.ts`.
- **The first entry on a lead is a Remark**, the rest are Follow-Ups — derived
  from position in `lib/followUpKind.ts`, never stored.
- **A Manager (Sub Admin) is not an employee**: own Add Manager form, no lane
  priority, no KPI targets, no leads of their own. Their analytics are their
  team's, summed on read (`lib/managerMetrics.ts`).
- **Lead source names the exact origin** — `Data Bank (Facile Town 2)` — from
  fields denormalised onto the lead, never a live join (`lib/leadSource.ts`).
- **Hierarchy:** an employee's manager is `users/{uid}.subAdminUid`; a folder's
  owner is `dataBankFolders/{id}.subAdminUid`; leads and deals carry a
  denormalised copy. Absent means "the admin, directly". Never a list on the
  manager — a Security Rule cannot prove a list query against a scope held in
  another document. Two levels deep only.
- **A closed deal waits for the admin to split its profit.** `dealDistributions`
  holds the whole split (admin only); `dealPayouts` holds one row per recipient
  (that person, their sub admin, the admin). Re-finalising supersedes, never
  overwrites.
- Employees see only their own leads; a sub admin sees only their team's
  (enforced in rules + server actions)
- Profit = received − payable; net profit = gross − expenses
- Login requires credentials and role selection; routes to `/home` before redirecting to specific dashboard based on auth. Unauthorized access to `/home` redirects to login.
- Use `/admin` and `/employee` structures with isolated pages based on categories and subcategories in the sidebar (e.g. `/admin/leads/all`).
- Refactored monolithic dashboard pages into dedicated isolated components for distinct features (Lead Management, Employee Hub, Financials, Performance).
- Global layout wrapper handles primary navigation, user profile, and notifications.

## Design system (2026-08-21)

Tokens live in `src/app/globals.css` (`:root` + `@theme inline` for Tailwind v4).

### Color Palette (Light SaaS Theme)

| Token | Theme Value | Usage |
|-------|-------------|-------|
| `--color-background` | Slate 50 `#F8FAFC` | Page background |
| `--color-surface` | White `#FFFFFF` | Cards, headers, surfaces, inputs |
| `--color-primary` | Indigo 600 `#4F46E5` | Active tab underline, primary buttons, focus rings |
| `--color-success` | Emerald 500 `#10B981` | Profit, closed-won |
| `--color-critical` | Red 500 `#EF4444` | Loss, closed-lost, red flags, sign out |
| `--color-text-primary` | Slate 900 `#0F172A` | Primary text on surfaces |
| `--color-text-secondary` | Slate 500 `#64748B` | Secondary text, labels, hints |

*Note: All legacy color mappings (`--color-warm-bone`, `--color-ink-navy`, `--color-gold`, etc.) have been fully removed from the project in favor of native Tailwind utility classes (e.g., `bg-white`, `text-slate-900`, `text-indigo-600`).*

### Hard UI rules

1. **Logo text**: "CRM Admin" / "My workspace" must not wrap to two lines above 360px width. Icon-only display below 480px.
2. **Nav tabs**: Must use `overflow-x: auto` with visible scrollbar affordance below 900px width. Never cut off or overlap other elements.
3. **Text contrast**: Any text on dark backgrounds MUST use Slate 50 (`#F8FAFC`) or light gray (`#94A3B8`) minimum for 4.5:1 contrast ratio.
4. **Visibility**: Nothing may render with 0 opacity or a color identical to its background.
5. **Grid layouts**: KPI cards: 1 / 2 / 5 columns. Lead cards: 1 / 2 / 3 columns (`sm` / `lg` breakpoints).
6. **Modals**: Text contrast rules applied for labels (`text-slate-700`) and inputs.
7. **Tables**: Strict fluid width (`w-full`) to prevent horizontal scroll overflow on desktop.
8. **Sidebar**: Implemented custom subtle vertical scroll (`overflow-y-auto`).

### Component structure

- **Global Layout**: `GlobalLayout` (`src/components/GlobalLayout.tsx`) — top header, left sidebar navigation, user profile, notifications. Shared across Admin and Employee routes.
- **Logo**: Text hidden below 480px.
- **Floating Labels**: All search and filter inputs use a clean white background with floating labels.

## UI structure

### Global Sidebar Layout — `src/components/GlobalLayout.tsx`

Sidebar (Left) for navigation uses an accordion dropdown style for categories (Lead Management, Financials, etc.). Header (Top) for Search, Notifications, Profile dropdown.

### Filter bar + KPI cards

Admin: search above pills until `lg`; 5 KPIs from `useFinancials`. Employee: Status + Period same visual pattern.

### Lead cards — `src/components/LeadCard.tsx`

- Fields/actions unchanged; status badges for all 12 `LeadStatus` values
- Section headings via admin `LeadSection`: **`text-ink-navy`**

### Admin data tables — `src/components/ui/AdminTable.tsx`

Shared primitives: `TablePanel` (contained `overflow-x-auto`, gold scrollbar), `AdminTable` (`table-fixed`), `AdminTd`/`AdminTh`, `EmployeeStatusBadge` (blue/amber), `TabSectionHeading`.

Four restyled tables in `admin/page.tsx` (columns/data/sort unchanged):
- **Deal entries** — closedDeals fields per architecture §4.5
- **Employees** — priority, handled/missed/closed, profit, ACTIVE/DISABLED badge
- **Expenses** — title, category, amount, description, date
- **Reports** — employee performance + campaign performance

**Table color rules:** profit ≥0 → `text-profit-green`; missed >0 / expense amounts → `text-alert-red`; counts/revenue/default → `text-ink-navy`. No emerald/indigo over-coloring.

**Mobile:** `max-w-full` scroll container per table — page never scrolls horizontally. Numeric cols right-aligned + `tabular-nums`.

### Pages (Isolated Routes)

- `/home` — Splash screen with entrance animations and quick access cards.
- `/admin/leads/active` — Active Leads Pipeline
- `/admin/leads/new` — New Leads Queue & Manual Lead Import
- `/admin/leads/closed` — Converted / Closed Leads Archive
- `/admin/leads/campaigns` — Campaigns Management (Active running & old campaigns, period filter, table list view, details modal, add old campaign form)
- `/admin/employees/directory` — Employee Roster & Priorities
- `/admin/financials/deals` — Closed Deals: the complete record of finalised
  deals (client + KYC, origin, employee + manager, money, split, history)
- `/admin/financials/distribution` — the queue of deals awaiting a profit split;
  finalising one moves it into Closed Deals
- `/admin/financials/expenses` — Expenses Ledger
- `/admin/financials/reports` — Performance Reports
- `/admin/accounts/*` — Accounts module (Committee, Investment, Capital Investments, Receivables, Personal Expense)
- `/admin/accounts/income-sheet` — Income Sheet Dashboard (Ledger aggregation of all revenue and expenses)
- `/employee/workspace/leads` — My Pipeline
- `/employee/performance/stats` — My Deals & Stats
- `/employee/earnings` — the employee's own commission, and nobody else's
- `/subadmin/leads` — their team's pipeline
- `/subadmin/team` — their team's performance (read-only dossier)
- `/subadmin/data-bank` — the folders assigned to them
- `/subadmin/earnings` — their own and their team's shares

## Repo map

See `files.md` for full tree.

## Session log

### 2026-08-20 — Pre-redesign audit (no code changes)

- Read `PRD.md`, `architecture.md`, `CLAUDE.md`; audited admin/employee pages; created `files.md`

### 2026-08-20 — Shared AppShell + design system

- Extracted duplicate headers into `AppShell`; nav scroll <900px; logo icon-only <480px
- Tokens + NotificationsPanel contrast; employee Deals stub fix
- Widths: 375 / 768 / 1280 — no nav overlap

### 2026-08-20 — Filter bar + KPI visual redesign

- No logic changes to filters/totals (architecture §4.5)
- Fixed `text-muted` on bone; KPI grid `1 → 2 → 5`
- Widths: 375 / 768 / 1280 — no filter/search overlap

### 2026-08-20 — Lead cards + section headings + timer states

- Consulted PRD BR-4/5/6/7 (5-min assign, 8-lead rotation, 10-min accept)
- **Found:** `LeadSection` used `text-white` on warm-bone — titles invisible, only count badge visible. **Fixed:** `text-ink-navy` + `text-slate` subtitle; verified headings render
- **Timer:** gold pill when `fractionRemaining ≥ 0.5`; alert-red when low/expired; text always `"M:SS left"` / `"Window closed"` (deadline math unchanged)
- **Status badges:** all 12 statuses from `leadStatus.ts`, consistent blue/amber (+ won/lost green/red)
- Card grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (admin + employee)
- Widths: **375** (1 col) · **768** (2 col) · **1280** (3 col) — no overflow/clip

### 2026-08-20 — Admin tables visual redesign

- Consulted `architecture.md` §4.5 / closedDeals model — **no column, data, or sort/filter logic changes**
- New `src/components/ui/AdminTable.tsx` shared table shell + cell helpers
- Restyled Deal entries, Employees, Expenses, Reports (+ campaign sub-table)
- **Found:** dark `bg-slate-900` tables + `text-white` headings invisible on warm-bone page. **Fixed:** warm-bone panels, ink-navy headings
- **Found:** emerald/indigo on counts/conversion (over-colored). **Fixed:** only profit green + loss red
- Employee ACTIVE/DISABLED → status-blue / status-amber badges (not profit colors)
- Expense category → status-blue badge
- Contained horizontal scroll below 768px (`.admin-table-scroll`); `table-fixed` + right-aligned `tabular-nums`
- Widths tested: **375** · **768** — scroll inside panel, no page horizontal overflow
- **Still open:** extract shared FilterBar; split tab panels out of page files

### 2026-08-21 — Design system update to Slate/Emerald/Crimson palette

- Updated AppShell to use new design system CSS variables (`bg-surface`, `text-text-primary`, `text-surface`, `bg-primary`, `text-critical`, `ring-primary`)
- Made `NavTabConfig` and `AppShellProps` interfaces non-exported (not used outside AppShell.tsx)
- Fixed `EmployeeStatusBadge` to accept optional `label` prop for expense category display
- Verified all hard rules: text contrast on dark backgrounds (Slate 50 minimum), logo text non-wrapping above 360px / icon-only below 480px, nav tabs scroll below 900px, no zero opacity or identical background colors
- Build: zero warnings

### 2026-08-21 — Filter bar + KPI cards redesign with semantic tokens

- Redesigned filter bar (search, Period/Status/Employee/Campaign dropdowns) using semantic tokens from globals.css
- Updated `bg-warm-bone` → `bg-surface`, `text-ink-navy` → `text-text-primary`, `text-slate` → `text-text-secondary`
- Updated `border-gold` → `border-primary`, `ring-gold` → `ring-primary`, `focus:border-gold` → `focus:border-primary`
- Redesigned 5 KPI cards (Revenue, Payable, Gross Profit, Expenses, Net Profit) with semantic tokens
- Updated `text-profit-green` → `text-success`, `text-alert-red` → `text-critical`, `bg-warm-bone` → `bg-surface`
- Updated `TableCell` component to use semantic tokens for tone classes
- Updated `SelectPill`, `Banner`, `LeadSection` components to use semantic tokens
- KPI grid remains `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` (1 col <640px, 2 cols 640-1024px, 5 cols >=1024px)
- Filter dropdowns use responsive grid: `grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:flex`
- All financial metrics use `tabular-nums` for consistent alignment
- 4.5:1 contrast maintained: `text-text-secondary` on `bg-surface` passes contrast requirements
- Tested widths: **375px**, **768px**, **1280px** — no overlap, no clipping, no horizontal overflow
- No new components created; reused existing `SelectPill`, `Kpi`, `TableCell`
- Build: zero warnings

### 2026-08-21 — Table layout conflict fixes

- **Found:** Deal entries "CONTACT" column phone/email/address overlapping. **Fixed:** added `flex flex-col gap-1 text-sm` wrapper with truncate on email.
- **Found:** Expenses Amount + Description columns colliding. **Fixed:** added `min-w-[120px]` to headers, `px-4` padding to cells, semantic token styling to category badge.
- **Found:** "Performance & campaigns" index/Employee name overlapping. **Fixed:** added `flex items-center gap-3` to employee cell with separate index number.
- **Found:** Expense category badges squashed. **Fixed:** added `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium` to badges.
- Build: zero warnings

### 2026-08-21 — Dark theme dropdowns and notification badges

- **Found:** Filter select dropdowns have white background with invisible text. **Fixed:** changed dropdown options to `bg-slate-900 text-slate-50` for dark theme consistency.
- **Found:** Notification bell badge looks like plain superscript. **Fixed:** styled as proper notification dot: `absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600`.
- **Found:** Alert cards in notification popover have dark text on dark backgrounds, poor contrast. **Fixed:** updated popover background to `bg-slate-800 border-slate-700`; alert cards now `text-slate-200` with `text-slate-400` timestamps.
- **Found:** Modal form inputs have dark navy backgrounds (warm-bone) with dark text, unreadable. **Fixed:** updated Modal to use `bg-surface` with light theme; inputs now `bg-white text-slate-900 placeholder:text-slate-400` (high contrast).
- Build: zero warnings

### 2026-08-21 — Employee period filtering, reactive modal lead, auto follow-up timestamp & icon white text styling

- **Employee Period Filter:** Added `withinRange` filter to employee pipeline lead calculation so period dropdown works.
- **Reactive Modal Lead:** Updated LeadDetailModal calls in `employee/page.tsx` and `admin/page.tsx` to pass reactive live lead from `leads` array by ID match, ensuring status updates immediately update the modal view.
- **Select Option Dark Theme:** Added `colorScheme: "dark"` and inline option styling (`bg-slate-900 text-slate-50`) to modal select dropdowns.
- **Auto Follow-up Timestamp:** Removed manual datetime input from follow-up form and added automatic read-only current date-time display.
- **Icon White Text Styling:** Explicitly added `text-white shrink-0` to all Lucide icon components in `LeadDetailModal.tsx` and `LeadCard.tsx`, and wrapped link button text labels in `<span className="text-white font-medium">` to prevent global CSS link text color overrides.
- **Admin Employee Priority & Status:** Added explicit priority sorting (1..20, active first, name tie-break) and synchronous optimistic state (`localPriorities`, `localStatuses`) to `EmployeesTab` so changing priority or pausing/resuming an employee updates the UI with 0ms latency.
- **Admin Employee Filter:** Connected `employeeFilter` prop to `EmployeesTab` so selecting an employee in the global filter bar filters the employees table as well.
- **Employee Status Badge Fix:** Normalized status string evaluation in `EmployeeStatusBadge` to handle both lowercase and uppercase states, fixing the bug where active employees were incorrectly labeled as "Disabled".
- **Modal Fallback Keys:** Replaced shared `"none"` fallback keys in modal declarations with component-specific keys (`assign-modal-empty`, `lead-modal-empty`) to prevent React key collisions.
- **Admin File Structure Modularization:** Cleanly broke down the 1,190-line `src/app/admin/page.tsx` into modular components under `src/components/admin/` (`AdminShared.tsx`, `EmployeesTab.tsx`, `DealsTab.tsx`, `ExpensesTab.tsx`, `ReportsTab.tsx`, and `AssignModal.tsx`) with zero loss or alteration to application behavior or ranking computations.
- Build: zero warnings

### 2026-08-22 — Backend Auto-Reassignment & Red Flag implementation
- **8-Lead Rotation Bypass:** Added `bypassRotation` flag to `getNextAssigneeAndState` to determine next assignee purely by priority (without incrementing cycle state counts) during 10-minute accept window expirations.
- **Red Flag Alerts details:** Integrated lookup for the previous assignee's display name, incrementing the employee's `missedLeadsCount` persistently in Firestore, and creating detailed `RED_FLAG` notifications (containing employee name, lead name, time assigned, acceptance deadline, and reason).
- **TypeScript & Tests:** Resolved type mismatch errors in the newly created subpages and verified the entire auto-distribution suite passes.

### 2026-08-24 — Full UI skin redesign (frontend only)
- Replaced the global visual system in `src/app/globals.css` with a green Leadway theme, atmospheric gradients, modern typography (`Sora` + `Manrope`), and reusable motion utilities (`page-enter`, `stagger-in`, `card-lift`).
- Added `src/components/BrandLogo.tsx` and integrated branding into sidebar/header and login experience.
- Refreshed shared UI primitives used across all routes (`GlobalLayout`, `Modal`, `SelectPill`, `AdminShared`, `AdminTable`, `NotificationsPanel`, `LeadCard`, `LeadDetailModal`) so pages inherit the new design without touching backend/server actions.
- Added smoother transitions and form-control restyling (`crm-input`, `crm-select`, `crm-textarea`, `crm-btn`) while preserving all existing data wiring and integrations.

### 2026-08-24 — Authentic Purple & Logo Green Theme Integration & Live Firebase Setup
- **Primary Color Shift**: Updated primary theme color to match the **Leadway Green logo** (`#10B981` / `#15c58a` / `#0b7e5e`) across `globals.css`, `GlobalLayout.tsx`, and button/active state utilities.
- **Active / New / Closed Leads UI Redesign**: Overhauled `/admin/leads/*` with clean card wrappers, sleek search and period/status/assignee filter pills, structured SaaS tables with semantic status pill badges (Assigned = Blue, Negotiation = Amber, Interested = Emerald, etc.), and distinct action button styling (`View details`, `Reassign`).
- **Sidebar & Header Green Polish**: Updated sidebar active tabs, user profile badge gradients, and focus rings to the new brand emerald green.
- **Modal Alignment & Stacking Fixes**: Elevated `Modal` to `z-[70]`, widened `Modal` default layout for clean responsive forms, and fixed nested `AssignModal` layering.
- **Live Firebase Integration**: Connected live Firebase Web App and Service Account credentials for project `leadway-496cd`. Created initial administrator account (`chickenhead593@gmail.com`).

### 2026-08-24 — System Architecture Sync & Comprehensive Testing Specification
- Synchronized `architecture.md` file reference with all app routes, server actions, hooks, and accounting modules.
- Delivered exhaustive UI-driven end-to-end verification protocol covering all 22 core business rules.
- Documented Meta Ads webhook ingestion lifecycle, verification protocol, campaign attribution, and test script usage.

### 2026-08-25 — Live Dynamic Dashboard Stat Boxes Wiring
- Replaced static placeholder values in the top 3 cards on `/home` (`src/app/home/page.tsx`) with real live Firestore/Demo data streams.
- Admin view connected to **Total Revenue** (with deals count & profit), **Active Pipeline** (with new & pending accept counts), and **Conversion Rate** (won % against total leads).
- Employee view connected to **My Active Leads**, **My Closed Revenue**, and **My Win Rate**.
- Validated with Next.js production build (`npm run build` passed with 0 errors).

### 2026-08-25 — Historical Lead Import Form Overhaul & Validation
- Completely redesigned the **Historical Lead Import** modal form on [`src/app/admin/leads/new/page.tsx`](file:///c:/Users/Ammad/Downloads/crm-phase-2/crm/src/app/admin/leads/new/page.tsx):
  - Added grouped card sections: **Client Information**, **Pipeline State & Assignment**, **Historical Follow-ups & Notes**, and **Confirmed Deal Settlement**.
  - Built custom input fields with contextual icons (`User`, `Phone`, `Mail`, `MapPin`, `Calendar`, `DollarSign`, `Target`).
  - Added strict client-side validation rules (full name >= 2 chars, email pattern regex, phone digit length, deal settlement requirements, non-empty follow-up messages) with top error alert banners.
  - Implemented interactive follow-up note logger with phone call vs message toggle chips.
- Verified Next.js production build (`npm run build` passed with 0 errors).

### 2026-08-25 — Modern Custom DateTime & Date Picker Component
- **Custom `DateTimePicker` UI Primitives**: Created `src/components/ui/DateTimePicker.tsx` replacing clumsy native browser date-time pickers with a clean emerald-styled popover component.
  - Interactive calendar day grid with today indicator, selected state, and month navigation.
  - Time selector (12-hour, minutes, AM/PM toggle) for combined datetime modes.
  - Quick action bar with "Today / Set to Now", "Clear", and "Done" actions.
- **Global Integration**: Integrated `DateTimePicker` across `src/app/admin/leads/new/page.tsx` (creation date, follow-up timestamp, deal date), `src/components/admin/AdminShared.tsx` (`LabelledInput`), and `src/components/LeadDetailModal.tsx`.
- **Validation**: Verified TypeScript compilation with `npm run typecheck` passing with 0 errors.

### 2026-08-25 — Modern CustomSelect Dropdown Components & Lead Creation Direct Assignment Fix
- **`CustomSelect` UI Primitive**: Built `src/components/ui/CustomSelect.tsx` with floating backdrop popover, status pill badges, contextual icons, subtext descriptions, checkmark active states, and click-outside dismissal.
- **Form Integration**: Replaced native browser `<select>` elements for **Lead Status**, **Assign To Team Member**, and **Payment Method** on `src/app/admin/leads/new/page.tsx`.
- **Direct Lead Assignment Fix**: Fixed `createLead` in both `src/app/actions/leads.ts` and `src/lib/demo/store.ts` so when an employee is assigned at lead creation, the status automatically initializes to `ASSIGNED`, sets `distributionMethod: "MANUAL"`, initializes `acceptDeadlineAt`, and issues `NEW_LEAD_ASSIGNED` notifications rather than getting trapped in the unassigned `NEW` queue.
- **Validation**: `npm run typecheck` and `npm test` (31 unit tests) passed with 0 errors.

### 2026-08-25 — LeadDetailModal Portal Centering & Complete UI Redesign
- **Portal Rendering**: Moved `LeadDetailModal` to `createPortal(..., document.body)` with `document.body.style.overflow = "hidden"` lock, removing positioning/stacking context offset from table rows and navbar.
- **Modern Information Architecture**:
  - Redesigned top header with large avatar, status badge pill, lead source tags, WhatsApp/Call action buttons, and close button.
  - Added 4-card overview grid (Phone, Email, City/Area, Assignee + Reassign action) for instant legibility.
  - Integrated `CustomSelect` into the Pipeline Stage selector.
- **Validation**: `npm run typecheck` passed with 0 errors.

- **Validation**: `npm run typecheck` passed with 0 errors.

- **Validation**: `npm run typecheck` passed with 0 errors.

### 2026-08-25 — Direct Lead Creation Assignment & Review Timer Fix
- **Root Cause**: When a lead was created with an assignee from the import form, if `status` was not explicitly `"NEW"`, `effectiveStatus` remained non-`ASSIGNED` and `acceptDeadlineAt` was omitted. Because the employee dashboard filter strictly checks `status === "ASSIGNED"`, and `active/page.tsx` filters out non-accepted/new statuses, newly created leads were invisible to the employee until an admin manually clicked "Reassign".
- **Fix**:
  - In `src/app/actions/leads.ts` and `src/lib/demo/store.ts`: Enforced `effectiveStatus = "ASSIGNED"`, `acceptDeadlineAt = now + 10min`, `lastActivityAt = creationTime`, `distributionMethod = "MANUAL"`, `attemptedAssignees = [userId]`, `MANUALLY_ASSIGNED` event, and `NEW_LEAD_ASSIGNED` notifications for any non-terminal assigned lead.
  - In `src/app/admin/leads/new/page.tsx`: Synced assignee selection directly to `ASSIGNED` status.
- **Validation**: `npm run typecheck` and `npm test` (31 tests) passed with 0 errors.

### 2026-08-25 — Campaigns Option Under Lead Management & Lead Entry Campaign Selector
- **Campaigns Navigation**: Added "Campaigns" subitem under Lead Management in `src/components/GlobalLayout.tsx` (`path: "/admin/leads/campaigns"`, icon: `Megaphone`).
- **Campaigns Page (`/admin/leads/campaigns`)**:
  - Period filtering (`Today`, `This week`, `This month`, `All time`) using `SelectPill` and `resolveRange`.
  - Search input (by name, ID, platform, category) and status filter (`All`, `Active / Running`, `Completed / Old`, `Paused`, `Archived`).
  - Metric summary cards (Total Campaigns, Period Leads, Deals Won, Total Revenue, Net Profit, Avg Conversion Rate).
  - List view table displaying campaign metadata, timeline, period-filtered lead count, won deals, revenue, profit, and conversion rate.
  - **Campaign Details Dossier Modal**: Comprehensive modal showing full campaign metadata, high-level metrics, and interactive table of all attributed leads with one-click `LeadDetailModal` inspection.
  - **Add Old Campaign Modal**: Clean data entry form for historical marketing campaigns (name, platform, category, status, start/end dates, budget, historical aggregate leads count, historical revenue, and notes).
- **Lead Entry Campaign Selector**:
  - Added campaign dropdown selector (`CustomSelect`) to the Manual Lead Creation form on `/admin/leads/new` (`src/app/admin/leads/new/page.tsx`) to associate new/historical leads with running or archived campaigns.
  - Updated `createLead` across `src/app/actions/leads.ts`, `src/lib/demo/store.ts`, and `src/lib/clientActions.ts` to persist `campaignId` and `campaignName` to both lead documents and closed deals.
- **Hydration Warning Fix**:
  - Wrapped `<th>` children inside `<tr>` in `AdminThead` (`src/components/ui/AdminTable.tsx`) ensuring standard-compliant HTML table nesting.
- **Data Layer & Persistence**:
  - Created `src/app/actions/campaigns.ts` with `createCampaign` Server Action (Admin protected).
  - Created `src/hooks/useCampaigns.ts` with realtime Firestore listener + Demo store fallback and auto-discovery from `leads`.
  - Updated `src/lib/demo/store.ts` with seeded campaigns and `createCampaign` in-memory mutation.
  - Updated `src/lib/clientActions.ts` with `createCampaign` dispatcher.
- **Validation**: `npm run typecheck` (0 errors) and `npm test` (31 tests passing).
### 2026-08-27 — Unified Leads workspace + teal CRM theme

**Unified workspace** — `/admin/leads` replaces the Active / New / Closed routes with one
two-pane screen built to the approved teal design.
- `src/components/leads/LeadsWorkspace.tsx` — 372px list panel (search, All/Today/New/Active/Closed
  chips, Add Lead) + detail pane. Below `lg` the detail takes over the frame with a back arrow.
- `src/components/leads/LeadDetailPane.tsx` — sticky teal identity header, 4-cell facts strip,
  pipeline stage bar with a 6-segment track, and Follow-ups / Audit Trail / Deal Entry tabs.
  Only the tab body scrolls. Calls the **same** client actions as `LeadDetailModal` with identical
  payloads; that modal is untouched because 9 other routes still render it.
- `src/components/leads/AddLeadModal.tsx` — teal rebuild of the retired `/admin/leads/new` import
  form. All six validation rules and the full `createLead` payload preserved; the settlement block
  unfolds when status is Closed / Won, so deal-at-creation still works.
- `src/lib/leadBuckets.ts` — chip predicates shared by the chips, the counts and the redirects.
  Buckets are disjoint: `UNASSIGNED_NO_CAPACITY` sits in NEW (it needs the same manual-assign
  action) rather than in ACTIVE where the old page counted it.
- `src/lib/leadDisplay.ts` — avatar initials + status ring colour.
- `/admin/leads/{active,new,closed}` are now `redirect()` stubs into `?filter=…`; `/home` tiles
  link straight to the filtered URL. The chip lives in the URL and is derived, never mirrored
  into state.

**Theme** — the app's accent ran through `emerald-*`, so the emerald ramp itself is redefined to
the design's teal in `@theme` (`500 #4f9c99`, `600 #3f8f8a`, `700 #2f7d78`). Every page inherits
it without a 60-file sweep. Login page `blue-*` remapped to the same ramp. Font is now Poppins.

**Two pre-existing CSS bugs fixed (root cause of the "invisible UI" reports):**
1. Element defaults (`body`, `h1`–`h6`, `a`, `input`) were declared **unlayered**. Tailwind v4 emits
   utilities inside `@layer utilities`, and unlayered rules beat layered ones regardless of
   specificity — so `h1 { font-size: 2.25rem }` silently overrode `class="text-base"` and
   `a { color: teal }` overrode `class="text-white"`, making link icons invisible on teal. Now
   wrapped in `@layer base`.
2. The global focus rule read `outline: none; ring: 2px; …`. `ring` is a Tailwind utility name, not
   a CSS property, so only `outline: none` applied — removing the focus indicator app-wide.
   Rewritten with real `outline` properties.

**Motion** — `lead-pane-in` (detail slides in left→right, replayed per lead via `key`),
staggered `lead-row-in`, `lead-tab-in` crossfade, `stage-dot-in`. All 220–420ms, transform/opacity
only, and fully disabled under `prefers-reduced-motion`.

- **Validation**: `npm run typecheck` (0 errors), `npm test` (31 pass), `npm run build` (31 routes),
  `eslint src` unchanged at 11 pre-existing errors (0 new). Verified in a real browser at
  1440 / 768 / 390 — no horizontal overflow; create-lead, follow-up, and stage-change round-trips
  all confirmed against the demo store.

### 2026-08-27 — Priority lanes: 5-min cascade + forced accept

**Signed off with the owner**, replacing the BR-7 10-minute window and the 1..20 scale.

- `src/lib/constants/distribution.ts` — one definition of both windows (5 min admin assign,
  5 min accept), the 1–10 priority scale, and the minute figures used in user-facing copy, so
  the words can never drift from the clock. Five files used to redeclare these.
- `resolveCascadeAssignee()` in `src/lib/distribution.ts` — the lane. On a lapsed accept window
  the lead steps strictly down the priority order, skipping anyone who already let it expire.
  **The lane has a floor:** when one candidate remains they are `forced` — assigned with no
  window and no way to decline. If everyone has had a turn, the lowest-priority active employee
  is the backstop on the same terms. A lead can no longer fall out into
  `UNASSIGNED_NO_CAPACITY` while an active roster exists. 9 new unit tests.
- **Rotation is unchanged for incoming volume.** Priority sets who starts each cycle and the
  cascade order; the 8-lead turn still spreads leads so P1 does not absorb everything. The
  cascade deliberately does not read or advance rotation counters — cleaning up a colleague's
  miss must not consume your turn.
- **Admin actions are force accepts.** `assignLead`, `reassignLeadManual` and `createLead` with
  an assignee now write `ACCEPTED` + `acceptedAt` and delete `acceptDeadlineAt`. An admin
  handing out a lead is a decision, not an offer. Only the automatic lane gives a window.
  Admin's button in the detail pane reads "Force Accept".
- **Manual entry splits by date.** A lead typed in today joins the lane like a Meta lead (admin
  window, then auto-distribution); one stamped before the start of the Karachi business day is a
  historical backfill and stays parked, because putting a 5-minute clock on a months-old record
  helps nobody. `isBackdated` in `leads.ts` and the demo store.
- The 5-minute admin assign window is retained (BR-4 unchanged).
- `FORCE_ACCEPTED` audit event added, labelled in both detail views.

**Found, pre-existing, not fixed** (outside this change, flagged to the owner): in demo mode
`AuthContext` hardcodes `loading: false` while the session restores through
`useSyncExternalStore` after hydration, so `useProtectedRoute` sees `user: null` on a hard page
load and bounces to `/home`. Soft navigation works. Real Firebase mode starts `loading: true`
and is unaffected.

- **Validation**: `typecheck` 0 errors, `test` 40/40 (31 → 40), `build` 32 routes, `eslint src`
  unchanged at 11 pre-existing errors. Verified in Chromium: admin assign takes a NEW lead to
  ACCEPTED with no accept banner; an auto-assigned lead shows "5 minutes to accept" with a Force
  Accept button; priority dropdown renders 1–10.

### 2026-08-28 — Employee Directory rebuilt to the teal design

Three screens rebuilt pixel-to-reference: the directory list, Add Employee, and the
employee performance dossier.

- `src/components/employees/employeeChrome.tsx` — shared `TealHeader`, `StatStrip`,
  `WonLost`, `LeadStatusPill`, `EmployeeStatePill`. All three screens render the same
  teal bar and figure strip, so they cannot drift. `StatStrip` has a `dense` variant:
  six figures in a modal drop to 21px rather than letting "Rs 1,650,000" ellipsise
  into a wrong number.
- `src/components/employees/AddEmployeeModal.tsx` — teal header, Generate button
  (crypto random, unambiguous alphabet), show/hide password, Role select, Active /
  Inactive segmented control, lane priority.
- `src/components/employees/EmployeeDetailModal.tsx` — identity header with status +
  priority pills and `email · role · joined`, 6-figure strip, and Assigned Leads /
  Deals Closed / Activity tabs.
- Directory page is full-bleed with a search + All/Active/Inactive segmented filter.
  Headline totals describe the whole roster, not the filter — a number that moved on
  clicking "Inactive" would read as the team having shrunk.

**Schema:** employees gained `jobTitle` (`src/lib/constants/roles.ts`), distinct from the
auth `role` field on the same document — it carries no permissions. Threaded through
`createEmployee` / `updateEmployee`, the hook, metrics, clientActions and the demo store.
`createEmployee` also accepts a starting `status`, so an employee can be created paused.

**Activity tab** is reconstructed from each lead's own counters and timestamps. A true
per-action feed would mean reading every lead's `events` subcollection — a read per lead
on a modal opened from a table row.

- **Validation**: `typecheck` 0 errors, `test` 40/40, `build` 32 routes, `eslint src`
  unchanged at 11 pre-existing errors. Verified in Chromium at 1440 — no horizontal
  overflow, all three screens against the reference.

### 2026-08-28 — Day End Report dashboard + the KPI module

**What a KPI is here**, because the client asked and the code now depends on it:
MTD = month-to-date (the 1st until now), YTD = year-to-date (1 Jan until now), and a
KPI percentage is simply **actual ÷ target**. Every figure on the dashboard is that
one ratio, which is why `lib/kpi.ts` takes `actual` and `target` everywhere rather
than a pre-computed percentage.

Three metrics, each a count plus a target an admin sets:

| KPI | Counted from | Target |
|-----|--------------|--------|
| Connects | follow-ups with a typed call duration ≥ **1:10** | per employee, per month |
| Client Registration | closed deals (lead reaches CLOSED_WON) | per employee, per month |
| Meeting | follow-ups with the new "Meeting held" box ticked | per employee, per month |

Company defaults are 200 / 8 / 20 a month (`DEFAULT_KPI_TARGETS`), overridable per
person in the directory's Edit form. **YTD target = monthly target × months elapsed**,
so January is judged against one month and December against twelve.

**The connect rule (≥ 70s).** `CONNECT_MIN_SECONDS = 70`. There is no telephony
integration, so the employee types the duration into the follow-up form (minutes +
seconds) and the `connect` flag is computed **server-side** from it — never read from
the client payload, so the KPI cannot be inflated by a crafted request. `callMade`
without a duration is rejected. The form shows live whether the current figure will
count, and the saved banner says which way it went.

**One follow-up per lead per day.** Enforced in the `addFollowUp` transaction by an
indexed equality read on a new `dayKey` field (`YYYY-MM-DD` in Karachi, derived from
`occurredAt`), so it is a single-document lookup rather than a subcollection scan.
**Admins are exempt** — an admin correcting or back-filling a record is a different
act from an employee padding their activity count. The UI disables "Add Note" with a
"Logged Today" label rather than letting the write fail.

**Counters, not scans.** Follow-ups and deals increment
`users/{uid}/kpiMonths/{YYYY-MM}` inside the *same transaction* as the work they
count, so the figures cannot drift, and reading a year costs one small query instead
of a collection-group scan across every lead the employee ever touched. Counters are
credited to `lead.assignedUserId`, not the author — an admin filing on someone's
behalf must not move their own numbers, matching how `closeDeal` credits revenue.
Historical imports count in the month the work actually happened, so a backfilled
March deal lands in March instead of distorting this month.

**Automatic priority.** `kpiScore` weights the three attainments 40/40/20 with each
capped at 150% first — without the cap one runaway metric (788% on meetings) would
mask two failing ones. `recalculatePriorities` ranks the active roster by this month's
score and assigns lane priorities 1..N, best first. **Employees an admin has pinned
keep their priority**: setting one by hand sets `autoPriority: false`, otherwise the
next run would silently undo the admin's decision. Ties break on uid so repeated runs
do not shuffle the lane. Shared by the admin's "Recalculate Priority" button and a new
nightly cron (`/api/cron/recalculate-priorities`, 00:30 Karachi) so a manual run and a
scheduled one cannot produce different lanes.

**Deal category.** Deals now carry Rental / Installment / Investment
(`lib/constants/deals.ts`), captured at the point of sale because it cannot be
inferred afterwards from the amounts. Feeds "Current Portfolio (YTD)".

**The dashboard** (`/home`) is rebuilt as the Day End Report: "Hi {name}" — the real
name from the user's own profile document, falling back to a title-cased email local
part — a five-figure strip, Attendance, KPI (MTD) donuts, KPI (YTD) bars with a target
rule, Target Achieved (YTD), and the portfolio split. Admin sees the team summed
(targets add up too); an employee sees only their own. `components/dashboard/` holds
the primitives: a donut clamps its *arc* at 100% but prints the real number, because a
ring that wrapped twice would be indistinguishable from 100%.

**Attendance is layout only, by instruction.** Nothing reads or writes, no figure is
derived from lead data, and the panel says so on its face. The month grid is generated
from the calendar; when the backend lands, the only change is passing a real `days`
array — the shape is already a day record's shape.

**Found and fixed (from the previous round, caught by this round's browser test):**
opening Edit from the employee dossier put the edit form at `z-100` behind the
dossier's own `z-110` backdrop, so nothing in the form could be clicked. The dossier
now closes when Edit opens.

**Also fixed:** `useTeamKpi`'s per-employee listeners were being returned from inside
an `onSnapshot` callback, where the return value is discarded — that leaked a listener
per roster update. They are now held outside and torn down explicitly.

**Not built, deliberately:** the Add Employee form does not set targets (new employees
take the company defaults; the admin edits after). Historical imports never count as
Connects — the threshold cannot be verified after the fact.

- **Validation**: `typecheck` 0 errors, `test` 67/67 (40 → 67; 27 new covering the
  70-second boundary, the attainment cap, rank stability and month keys), `build` 33
  routes, `eslint src` down to 7 pre-existing errors (from 11; the two `any` in
  `employees.ts` went with the rewrite). Verified in Chromium at 1440 / 390: a call at
  1:05 reads "Not a connect", at 1:10 "Counts as a connect", the saved entry carries a
  Connect badge, a second same-day follow-up is refused, and cutting an employee's
  targets and recalculating moved two people in the lane.

### 2026-08-29 — Day End Report to the reference + attendance made real

**The dashboard is now the approved design**, not an approximation of it:
"Hi {name}" over "Day End Report", the teal Attendance bar with Check In /
Check Out / Total Working hr, MTD and YTD attainment tiles beside it, KPI–MTD
donuts, a grouped KPI–YTD chart with a legend and year pill, Target Achieved,
and Current Portfolio with letter badges and a total. `components/dashboard/
dayEndChrome.tsx` holds the primitives; every colour in `TEAL` is sampled from
the reference rather than guessed.

Two display rules worth keeping:
- A donut clamps its **arc** at one full circle but prints the real number, so
  310% reads 310% over a complete ring. A ring that wrapped twice would be
  indistinguishable from 100%.
- The bar chart's y-axis rounds to a "nice" ceiling (0 / 125 / 250), reserves
  14px of headroom so the top label is not clipped, and runs Jan–Dec always —
  a chart that grew a column each month would rescale itself every four weeks.

`formatCompactMoney` (`PKR 5.9M`) is used on the portfolio rows only; the exact
figure would crowd out the bar it labels and lives on the deals ledger anyway.

**Attendance is now real, and is not a "Mark Present" button.** That was the
explicit design constraint: a self-service check-in can be tapped from bed, so
the feature would have been theatre.

- **Presence is derived.** A heartbeat (`recordAttendancePing`, on load then
  every 5 minutes) opens the day on first activity and moves the closing time.
  Check In, Check Out and total hours are therefore *observed*. There is no
  control to press and nothing to falsify except by actually being at work.
- **Location comes from the network, checked server-side.** The office's public
  IP is compared against the request's own address in the Server Action. A
  browser-side check would be bypassed in seconds. `x-forwarded-for` is read
  **first-entry-first** — the last hop is the platform proxy, identical for
  every employee, so using it would make every day read the same.
- **Unconfigured is not the same as remote.** An empty allow-list reports
  `UNKNOWN` ("Unverified"), because a month of "Remote" must be
  distinguishable from a setting nobody has filled in.
- **Admin sets it in Settings → Office network**, with a "Use my current IP"
  button (the server reports what it sees), several addresses for a backup
  line, and validation that rejects `256.x`, leading zeros and text.
- Half days count as **half** in the attendance rate; counting them whole would
  let a month of two-hour appearances read as perfect attendance.
- `setAttendanceOverride` lets an admin correct a day (leave, client visit).
  The override is stored **beside** the observed times, never over them.

Firestore: `attendance/{uid}_{YYYY-MM-DD}`, read-scoped to self or admin,
server-write only.

**Schema:** `KpiTargets` gained `revenue` (monthly, default PKR 3,000,000) —
the denominator of Target Achieved. It is deliberately outside `KPI_METRICS`:
the three metrics measure activity and carry the score weights, this measures
the money they produced. `normalizeTargets` needed a per-field ceiling as a
result; one shared 100,000 cap silently clamped every money target.

**Fixed while building:** the demo attendance seed keyed off UTC days, so
between 19:00 and midnight UTC the "today" the app asks for did not exist in
the seed and the card rendered empty. Now keyed off the Karachi calendar, with
neither end of a day allowed to fall in the future.

- **Validation**: `typecheck` 0 errors, `test` 97/97 (67 → 97; 30 new covering
  proxy-header parsing, the IPv4-mapped IPv6 form, unconfigured-vs-remote,
  half-day weighting and the hours arithmetic), `build` 33 routes, `eslint src`
  unchanged at 7 pre-existing errors. Verified in Chromium at 1600: no
  horizontal overflow, zero console errors, the attendance card renders
  observed times with an Office badge, an invalid office IP is rejected and a
  valid one saves.

### 2026-08-29 — Day End Report rebuilt with inline styles (renders anywhere)

**Reported:** on the owner's machine the Attendance bar rendered with no teal
ground, white text turned dark, and the MTD/YTD tiles dropped below it.

**Cause:** the card's colours were Tailwind *arbitrary values*
(`bg-[#3d8b85]`, `text-white`, `rounded-[18px]`). Tailwind v4 only emits an
arbitrary value if its content scanner saw that exact string in a file it was
watching. A stale cache, a partial file copy, or a build that ran before these
components existed drops the rule silently — the element then has no
background, the heading falls back to the global `h1–h6 { color }` rule, and
the `lg:` grid never applies so the row collapses to one column. That is
exactly the reported symptom, and it is invisible in review because the code
looks correct.

**Fix:** the whole screen is now **inline-styled** — colours, sizes, radii,
gaps, borders. Inline styles cannot be missed by a scanner, so the dashboard
renders identically on any machine regardless of what the Tailwind build saw.
The only exception is the two responsive row rules, which cannot be expressed
inline; they are plain CSS (`.dayend-row-attendance`, `.dayend-row-split`) in
`globals.css`, not utilities. `T` in `dayEndChrome.tsx` is the single source
for every colour on the screen.

This is a deliberate departure from the app's Tailwind convention, justified by
the requirement that this one screen be exact on machines we do not control.

**Also reported:** every figure read 0% with
`FirebaseError: Missing or insufficient permissions` from `useAttendance` and
`useTeamKpi`. `attendance` and `users/{uid}/kpiMonths` are new collections whose
Security Rules had been written but **not deployed** — the live project was
still enforcing the previous ruleset. Resolved by `npm run deploy:rules`.

To stop that class of problem reading as real data, the dashboard now shows a
red banner naming the error and pointing at `npm run deploy:rules` whenever a
KPI or attendance read is denied. A wall of honest-looking zeros hiding a
permissions failure is worse than an error message.

- **Validation**: `typecheck` 0 errors, `test` 97/97, `build` 33 routes,
  `eslint src` unchanged at 7 pre-existing errors. Verified in Chromium at
  1500x1250 @2x for both roles: zero console errors, no horizontal overflow,
  and the Attendance section's *computed* background asserted as
  `rgb(61, 139, 133)` rather than trusted from a screenshot.

### 2026-08-29 — Dashboard layout driven by measured width, animated background removed

**Reported (second time):** the Attendance bar and the MTD/YTD tiles were still
stacking on the owner's machine, at a viewport of roughly 1835px — far past the
1120px media query that was supposed to put them side by side.

**Cause:** the previous round moved the card *colours* to inline styles but left
the two responsive rows as classes backed by rules in `globals.css`. Those rules
were not in the owner's compiled stylesheet, so the breakpoint never fired and
the page rendered its narrow layout on a wide screen. Same failure mode as the
arbitrary-value problem before it: a build artefact that silently lacks a rule.

**Fix:** the layout no longer reads any stylesheet. `useElementWidth` measures
the dashboard's own container with a `ResizeObserver` and the grid columns are
set inline from that number. Two consequences worth keeping:

- It cannot be broken by a stale or partial CSS build.
- It measures the **container**, not the viewport, so the split is correct
  whatever width the sidebar is taking — a viewport media query cannot know
  that.

The dead `.dayend-row-*` rules were removed from `globals.css`.

**Proportions:** the attendance bar and the tile pair now split 1.6 : 1, sampled
from the reference (1165px against 730px). The earlier `1fr auto` gave the tiles
22% of the row where the design gives them 37%.

**Animated background removed** from `/home` at the owner's request —
`<CursorGrid />` and its import are gone from `GlobalLayout`. It still renders on
the login page, which was not in scope. Asserted in the browser as
`document.querySelectorAll('canvas').length === 0` on the dashboard.

**Not done:** the owner supplied a Claude Design MCP link to the authoritative
`Day End Dashboard.dc.html`. `DesignSync` refused — design-system authorization
cannot be granted from a non-interactive session. Everything above is still
measured from the reference image, not the source file. To close that gap the
owner needs to run `/design-login` once from an interactive Claude Code session,
or attach the `.dc.html` directly.

- **Validation**: `typecheck` 0 errors, `test` 97/97, `build` 33 routes,
  `eslint src` unchanged at 7 pre-existing errors. Verified in Chromium at
  1835 / 1400 / 1100 / 900px: side-by-side down to a 900px container, stacked
  below, attendance background asserted `rgb(61, 139, 133)` at every width, zero
  canvases, zero console errors, no horizontal overflow.

### 2026-08-29 — Dashboard rebuilt from the design file itself

The owner supplied `Day End Dashboard.dc.html` directly (kept at
`docs/design/`). Everything before this was measured off a screenshot; this
round takes the values from the source. What that changed:

| | was (estimated) | design file |
|---|---|---|
| Typeface | Poppins | **Plus Jakarta Sans** |
| Greeting / subtitle | 40px / 28px | **30px / 25px**, weight 800 / 700 |
| Card radius | 18px | **12px** |
| Attendance ground | flat `#3d8b85` | **gradient** `#2f7d78 → #3f8f8a` + shadow |
| MTD / YTD tiles | nested flex beside attendance | **two separate grid columns**, `minmax(150px,212px)`, own gradients |
| Card surface | `#ffffff` | **`#fbfdfd`** with a `#dceae8` border |
| Chart scale | rounded to the data's peak | **fixed 0 / 500 / 1000**, bars 7px, plot 184px |
| Portfolio badge | circle | **34px rounded square, radius 9** |
| Portfolio bar | share of the total | **share of the largest category** |
| Card icons | Lucide | the design's **own SVG paths** |

**Fonts are per-design-file, not app-wide.** `Active Leads.dc.html` specifies
Poppins; `Day End Dashboard.dc.html` specifies Plus Jakarta Sans. Both are
authoritative for their own screens, so Jakarta is loaded as a second variable
(`--font-dashboard`) and applied only by the dashboard root. Swapping the global
face would have silently restyled every leads screen.

**The rings keep the design's own trick:** the arc is clamped to one full circle
while the printed number is not — the design's Connects gauge literally carries
`pct: 100, value: "310%"`. A ring that wrapped twice would be indistinguishable
from 100%.

**The chart's fixed 1000 ceiling is deliberate** and is what the design does. A
chart that rescaled to its own peak each month would make two months impossible
to compare.

**Colour is state-derived, matching the design's sample:** a KPI ring under
target is amber `#e0b44f`, at or over target it is the metric's teal; a Target
Achieved ring under target is `#c0574a`, at or over it is teal. The design shows
63% amber and 1.33% / 44.33% red, which those rules reproduce.

The floating call button from the design is wired rather than decorative — it
dials the lead currently waiting to be accepted, and is absent when there is
none.

- **Validation**: `typecheck` 0 errors, `test` 97/97, `build` 33 routes,
  `eslint src` unchanged at 7 pre-existing errors. Verified in Chromium at the
  design's own 1440px preview width, asserting the *computed* values rather than
  trusting a screenshot: attendance gradient `linear-gradient(135deg,
  rgb(47,125,120) 0%, rgb(63,143,138))`, radius `12px`, greeting `30px`,
  font-family `Plus Jakarta Sans`, 0 canvases, 0 overflow, 0 console errors.

### 2026-08-29 — Read-state shading + Hot / Cold leads

**Row shading by read state.** The lead list now has three tones on one teal
ramp: **unopened** `#e2f0ee` (mid), **opened** `#fbfdfd` (nearly the panel's
own white), **selected** `#c6e0dc` (deepest). Dark-to-light in that order so
the eye lands on new work first and on the current row instantly, with
everything already handled receding. A teal dot and screen-reader text ride
along with the shade — colour is never the only signal.

"Opened" is **per-browser, not a field on the lead** (`hooks/useOpenedLeads`).
It is a reading state, not a business fact: it changes on every click, differs
per person and nobody audits it. Storing it on the lead would mean a write per
row click, a rules change letting employees write to `leads` at all, and a
per-user map on a document five people share. Cost: a new browser or a cleared
cache shows everything unopened again — the failure that over-reports work
rather than hiding a lead nobody has seen. Served through
`useSyncExternalStore` (empty server snapshot, so hydration matches) rather
than an effect that seeds state.

**Hot / Cold.** `lib/leadTemperature.ts` — derived on read, nothing stored:

| | rule |
|---|---|
| **Hot** | stage is Interested or Negotiation — the closing stages |
| **Cold** | **10** follow-ups (`COLD_FOLLOW_UP_THRESHOLD`) without the stage reaching Interested |
| neither | anything else; most leads are simply being worked |

Deriving rather than denormalising means the tenth follow-up turns a lead cold
on the next render — no sweep, no cron, and every lead that already exists is
classified from the moment this ships. A lead that reached Interested or
Negotiation is **never** cold however many calls it took; fifteen calls that
ended in a negotiation is the opposite of a dead lead. Closed and unworked
intake leads carry no temperature at all.

`setLeadTemperature` writes only the **exception** — a Hot/Cold pin from the
detail pane's three-state control (Hot / Cold / **Auto**), for the rep who has
had a call the follow-up count knows nothing about. Clearing it deletes the
field rather than writing `null`, so a lead back under the rule leaves no
tombstone reading as "someone decided this". A closed lead ignores its pin,
otherwise one pinned Hot and then lost would sit in the Hot filter forever.
Audit event `TEMPERATURE_CHANGED`.

**Chips.** Hot and Cold added after Closed on both roles — they cut across the
pipeline rather than continuing it, so placing them among the stage chips would
suggest a lead moves *into* Hot the way it moves into Negotiation. An active
Hot/Cold chip wears its own colour, not the shared teal, to say which kind of
cut is in force. `matchesLeadFilter` answers them before `bucketOf`, since a
hot lead is also an active one.

**The admin's New chip is removed**, at the owner's request. Unassigned intake
is still first in All (the default chip, newest first), the notification bell
still fires on it, and `?filter=new` stays a valid deep link via
`parsableFiltersFor` — so `/admin/leads/new` and the /home tile keep working.
`urgentFilterFor('admin')` is now `null`: the red badge marked the intake
bucket, and moving it to a chip that does not mean "needs you" would be worse
than having none. **The employee's Pending chip stays** — it is the 5-minute
accept window, and hiding it would cost people leads.

Colours here are inline, not Tailwind arbitrary values, for the reason recorded
on 2026-08-29 above: a build whose scanner never saw the string renders the
element with no background at all.

**Demo seed:** `lead_1007` (Kamran Butt, No Response) chased to 12 follow-ups,
so the Cold filter has its archetype to show.

- **Validation**: `typecheck` 0 errors, `test` 118/118 (97 → 118; 21 new
  covering the threshold boundary, responsive-lead immunity, pinned-then-closed,
  a junk override value and never-both-temperatures), `build` 33 routes,
  `eslint src` unchanged at 7 pre-existing errors. Verified in Chromium at
  1500×1000 @2x against *computed* styles: unopened `rgb(226,240,238)`, opened
  `rgb(251,253,253)`, selected `rgb(198,224,220)` with a `rgb(63,143,138)`
  border; chips read All/Today/Active/Closed/Hot/Cold; Hot returned the
  Negotiation and Interested leads, Cold returned only the 12-follow-up one;
  pinning a Negotiation lead Cold moved it into the Cold filter. No horizontal
  overflow, zero console errors.

### 2026-08-29 — Notification bell fixed (employee `permission-denied`) + wording

**Reported:** `[useNotifications] FirebaseError: Missing or insufficient
permissions` from `useFinancials.ts:284`.

**Cause.** The hook read the *whole* unread `notifications` collection and
narrowed it in JavaScript — the code even said so: "Filter locally to avoid
requiring composite indexes for targetRole/targetUid". That cannot work.
Firestore checks a **list** query against the rules *before* running it and
rejects the whole query unless the query's own constraints prove every document
it could return is readable. With no `targetUid` / `targetRole` constraint there
is no such proof, so an employee's bell was denied outright and showed nothing.
An admin was unaffected — `isAdmin()` passes for every document, so the
unconstrained query *was* provable for them, which is why this only ever broke
on one side and went unnoticed.

**Fix.** The query is scoped to the reader, mirroring a clause of the rule:
admins `where('targetRole','==','admin')`, employees
`where('targetUid','==',uid)`. Two composite indexes added
(`targetRole|readAt|createdAt`, `targetUid|readAt|createdAt`) — the indexes the
original comment was avoiding, which is what made the shortcut look attractive.
The effect's dependency list was also wrong (`[enabled]` only), so it never
re-subscribed when uid/role arrived after auth resolved; it is now keyed on the
reader.

**Security fix in the same place.** The rule allowed any employee to read any
document with `targetRole == 'employee'`, so one employee could read another's
alerts and the lead names inside them. Every employee notification the server
writes also carries `targetUid`, so that clause is dropped: an employee now
reads only what is addressed to them. **Requires `npm run deploy:rules`.**
Demo mode was scoped identically — it was demonstrating the leak.

**Wording.** The Hot/Cold hint read "Cold after 10 unanswered follow-ups", which
claims knowledge the app does not have: there is no telephony or inbox
integration, so nothing can observe whether a client answered. The only
response signal is the one the rep already gives — moving the pipeline stage.
Copy now says "Cold after 10 follow-ups with no progress", and the explanation
names the actual test: "12 follow-ups and the stage never reached Interested".
A unit test asserts the string never says "unanswered" or "no response" again.

- **Validation**: `typecheck` 0 errors, `test` 118/118, `eslint src` unchanged
  at 7 pre-existing errors (one warning fewer — the bad dependency list).
  Verified in Chromium across three demo sign-ins: admin sees the two admin
  alerts, Ayesha sees only her own assignment alert, Bilal sees none, zero
  console errors. The rules and index changes cannot be exercised without a
  live project — deploy and confirm the bell on a real employee account.

### 2026-08-29 — Notification indexes: equality fields go in alphabetical order

**Reported:** after deploying, `The query requires an index` on
`notifications`, with a console link asking for
`readAt, targetRole, createdAt`.

**Cause — mine, from the previous entry.** I declared the two indexes in the
order the `where` clauses are written in the hook
(`targetRole, readAt, createdAt`). Firestore normalises a query's **equality**
fields alphabetically when matching it to an index, so it was looking for
`readAt, targetRole, createdAt` and never found it. The indexes deployed
successfully and were simply never used — which is why this failed *after* a
clean deploy rather than before one.

**The rule, for anything added here later:** equality fields first in
**alphabetical** order, then any range/inequality field, then the `orderBy`
field. The other twelve indexes in the file were already correct — every one
is a single equality plus an `orderBy`, an equality plus a range, or
`assignedUserId, status` which happens to be alphabetical already.

The two wrongly-ordered indexes are still live on the project doing nothing;
`firebase deploy` creates but never deletes, so they need removing by hand in
the console if the clutter matters.

**Also worth knowing:** `.firebaserc` is gitignored, so `npm run deploy:rules`
targets whatever project `firebase use` has selected. The runtime project (from
the error token) is `leadway-crm`, while `src/lib/firebase/server.ts` still
carries a hardcoded fallback of `leadway-496cd` for when
`FIREBASE_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_PROJECT_ID` are unset — a silent
wrong-project failure waiting to happen. Flagged, not changed: it affects
deployment config rather than this bug.

- **Validation**: `typecheck` 0 errors, `test` 118/118, `eslint src` unchanged
  at 7 pre-existing errors. The index definitions were checked against the
  console's own generated token, decoded field by field
  (`readAt ASC, targetRole ASC, createdAt DESC, __name__ DESC`), rather than
  reasoned about — the previous round's mistake was exactly a plausible-looking
  guess at this.

### 2026-08-29 — Employee KPI round-trip verified; call button no longer covers the total

Asked whether the employee dashboard actually works, so it was exercised rather
than reasoned about. One follow-up logged on an accepted lead (1:15 call +
Meeting Held), figures read before and after via soft navigation:

| | before | after | expected |
|---|---|---|---|
| Connects MTD | 125% | **126%** | +1 of 200 = +0.5% |
| Meeting MTD | 125% | **130%** | +1 of 20 = +5% |
| Client Registration | 138% | 138% | unchanged — no deal closed |
| MTD headline | 130.2% | **131.4%** | weighted 40/40/20 |
| Target Achieved | 155.83% | 155.83% | unchanged — no revenue |

Exactly the right figures moved and the right ones did not. Attendance
Check Out advanced during the session, confirming the heartbeat is live.

**Testing note for anyone repeating this:** demo state is module memory, so a
`page.goto` re-seeds the store and silently discards the write. The first two
attempts read unchanged figures for that reason, not because the increment was
broken. Navigate in-app.

**Found and fixed:** the floating call button is `position: fixed` at the
viewport's bottom-right, and at some scroll positions it landed exactly on the
"Total Portfolio" figure and hid it. The total row now reserves the button's
footprint — but only when the button is rendered, since padding it
unconditionally would leave every other user's total short of the card edge.
Asserted by bounding box: total ends at x=1389, button starts at x=1394.

**The thing that will look like a bug on the live project and is not:** there is
no backfill. `users/{uid}/kpiMonths/{YYYY-MM}` counters are incremented inside
the follow-up and deal transactions, so they only count work logged *since the
KPI module shipped*. Every follow-up and deal recorded before that was never
counted and no script exists to replay them. A real employee's dashboard
therefore starts at or near 0% and climbs only as new work is logged. A
backfill would mean walking every lead's `followUps` subcollection and every
`closedDeals` document, bucketing by Karachi month and crediting
`assignedUserId` — deliberately not written without a decision on whether
historical calls, whose duration was never recorded, may count as Connects.
They cannot be verified after the fact.

- **Validation**: `typecheck` 0 errors, `eslint src` unchanged at 7 pre-existing
  errors. Verified in Chromium at 1500×1400 @2x as an employee: zero console
  errors, every panel populated, KPI deltas as tabulated above.

### 2026-08-29 — Security Rules now have tests; `closedDeals` get fixed

**Reported:** `[useDealForLead] FirebaseError: Missing or insufficient
permissions`, alongside the two index errors (those are the previous entry's
fix, not yet deployed — the console tokens decode to exactly the definitions now
in `firestore.indexes.json`).

**Cause — a different failure mode from the last two.** `useDealForLead` reads
`closedDeals/{leadId}` as a single document, so the list-proof rule does not
apply. The problem is that **on a `get` of a document that does not exist,
`resource` is null**, so `resource.data.userId` errors, and Firestore reports an
errored condition to the client as `permission-denied` rather than as an empty
snapshot. Every employee opening the Deal Entry tab on a lead that has not been
closed hit it. Admins never did — `isAdmin()` short-circuits first.

`read` is now split into `get` (allows the null-resource case) and `list`
(unchanged, and provable because `useMyDeals` carries `where('userId','==',uid)`).
Allowing the missing document discloses nothing: the client can already see the
lead is not closed.

**Rules are now tested.** Three bugs of this family have shipped, and none of
them is catchable by typecheck, lint, unit tests or clicking around — the rules
only execute inside Firestore. `scripts/rules.test.mjs` runs 26 assertions
against the emulator via `npm run test:rules`, covering both failure modes and
the cross-employee boundaries:

- the unscoped notification query fails; the `targetUid`-scoped one succeeds
- an employee cannot sweep `targetRole == 'employee'` (the leak closed earlier)
- a missing deal returns an **empty snapshot**, not a denial
- an employee cannot read a colleague's deal, lead, attendance or KPI counters
- the unscoped lead and ledger lists fail; the scoped ones succeed
- attendance, leads and deals reject every client write

The suite was checked against the *old* rule to confirm it has teeth: reverting
the `closedDeals` change fails exactly one test — "a lead with no deal returns
an empty snapshot for its owner" — and nothing else.

`test:rules` is separate from `npm run check` because it needs Java and the
Firebase CLI. `firebase-tools` is deliberately **not** a devDependency (it pulls
~460 packages and the CLI is already installed for deploys);
`@firebase/rules-unit-testing` is.

**Audit done at the same time:** every client query was checked against its rule.
All the admin-only reads (`useFinancials`, `useEmployees`, `useTeamKpi`,
accounts, campaigns, expenses) are gated by an `isAdmin` flag at the call site,
and the employee-scoped ones (`useLeads`, `useMyDeals`, `useAttendance`,
`useKpi`) all carry the constraint their rule requires. `closedDeals` was the
only remaining mismatch.

- **Validation**: `test:rules` 26/26 against the emulator, `typecheck` 0 errors,
  `test` 118/118, `eslint src` unchanged at 7 pre-existing errors.

### 2026-08-30 — Phone layout: a separate product, not a narrowed one

**Yes, it was possible.** Below 820px the app now renders the two screens the
owner supplied as design files — `Day End Dashboard Mobile.dc.html` and
`Active Leads Mobile.dc.html` — rather than the desktop tree reflowed.

**The switch is a JS measurement, not a media query.** `hooks/useIsMobile`
serves `window.innerWidth < 820` through `useSyncExternalStore`, with a server
snapshot of `false` so the hydration pass matches the server exactly and React
swaps to the real value before paint. Two rounds were lost earlier to layouts
that depended on a compiled rule the owner's build silently lacked; a width
read in JavaScript cannot be dropped by a bundler. The listener is shared and
the snapshot is a boolean, so dragging a desktop window re-renders nothing
until the breakpoint is actually crossed.

820 rather than 768: the desktop leads workspace needs its 372px list *plus* a
readable detail pane and starts to crush at about 810, so tablets in portrait
get the phone layout — which is a complete product, not a degraded one.

**What was built** (`components/mobile/`):

| | |
|---|---|
| `mobileChrome.tsx` | `M` tokens lifted from the two design files, `MobileHeader`, `MobileCard`, `Segmented`, `Meter`, `dash` |
| `MobileShell.tsx` | 100dvh column, the tab bar, and the keyframes |
| `MobileTabBar.tsx` | the five-slot bar with the raised 52px centre |
| `MobileDashboard.tsx` | the Day End Report |
| `MobileLeads.tsx` | pipeline list |
| `MobileLeadDetail.tsx` | detail overlay, follow-up sheet, deal form |
| `MobileAddLead.tsx` | the Add Lead sheet |
| `MobileBell.tsx` | the header bell + alerts sheet |

**The mockups' phone frame is deliberately not reproduced.** The `.dc.html`
files draw a 390×844 rounded rectangle with a 9:41 clock, signal bars and a
home indicator, because that is how a design file depicts a phone. Rendering
those in a real app puts a second, permanently-wrong status bar under the
device's own. They are replaced by the real equivalent —
`env(safe-area-inset-top/bottom)` padding — so the teal header flows under the
notch and the tab bar clears the home indicator on actual hardware.

`100dvh`, not `100vh`: `vh` is the *largest* viewport on mobile browsers, so a
`vh`-tall column hides its own tab bar behind the URL bar until you scroll.

**The centre button is contextual, as both files show it** — a phone on the
dashboard (dials the lead on the acceptance clock) and a plus on the leads
screen (adds a lead). Neither is decoration: with nothing to dial, or for an
employee who may not create leads, the slot falls back to the other action
rather than offering a dead button.

**Every field the web view has is on the phone.** The mockup's lead detail
carries four facts; this carries eight (email, source, campaign and created
join phone/city/assignee/stage), plus the accept window, the intake warning,
the stage select, the Hot/Cold control, the complete follow-up form (call
count, duration with the live connect verdict, meeting, WhatsApp note) and the
complete deal form. Writes call the same `clientActions` with the same
payloads, so the two surfaces cannot drift.

**Departures, each deliberate:**
- The design's four chips (All/Today/Done/Overdue) are the app's real buckets
  from `lib/leadBuckets` instead. A second chip set would mean two definitions
  of "done" that could drift apart.
- The facts grid scrolls with the tab body rather than sitting pinned between
  the header and the tabs. Pinned, four rows of facts pushed the sticky action
  off the bottom of a 390px frame — caught in the browser, not in review.
- The list date drops the year unless it is not the current one. The design
  prints it in full, but its sample names are short ("newLead"); with a real
  name the `48px 1fr auto` grid gave the date what it asked for and ellipsised
  "Imran Qureshi" to three characters.
- `useAttendance` now queries by uid alone rather than uid + month, because the
  phone shows a year-to-date attendance figure beside the month-to-date one.
  One listener and a few hundred small documents beats twelve listeners, and
  `uid ==` is still the clause the Security Rule checks.

**Performance.** Every animation is transform/opacity only, so none of them
touch layout: `mob-rise`, `mob-sheet`, `mob-fade`, `mob-slide-in`, and a
`scale(0.975)` press. Row entrance is staggered for the first eight only —
beyond that the delay outlasts the scroll and the list reads as laggy. All of
it collapses under `prefers-reduced-motion`. The keyframes ship inside the
component tree as a `<style>` element rather than in `globals.css`, so they
arrive with the component or not at all. Lists render a skeleton rather than a
spinner, so the screen does not jump when data lands.

- **Validation**: `typecheck` 0 errors, `test` 118/118, `build` 33 routes,
  `eslint src` unchanged at 7 pre-existing errors (none in the new files).
  Driven in Chromium at an emulated iPhone 13 (390×664, DPR 3) for both roles:
  no desktop sidebar, no horizontal overflow on any screen, zero console
  errors. Employee — the tab bar's centre reads "Call the lead waiting to be
  accepted", chips carry the Pending badge, all eight facts render, the
  follow-up sheet opens. Admin — bell reads "2 unread" and opens the alerts
  sheet, chips are All/Today/Active/Closed/Hot/Cold, centre is "+", and the Add
  Lead sheet carries all eight fields.

### 2026-08-31 — Employee Directory rebuilt from both design files

`Employee Directory.dc.html` and `Employee Directory Mobile.dc.html` are kept at
`docs/design/`. Everything below is transcribed from those files, not measured
off a picture.

**Typeface:** both files specify **Manrope** with `letter-spacing:-0.01em` on a
`#eef4f3` ground — a third type system alongside Poppins (leads) and Plus
Jakarta Sans (dashboard). Loaded as `--font-directory` and applied by the
directory roots only, so swapping it cannot restyle another screen. The two
`<h1>`s set `font-family` **inline**: `@layer base` sets a family on `h1`–`h6`,
and an element rule beats a family inherited from the container.

| | |
|---|---|
| `components/employees/directoryChrome.tsx` | the `E` token set, `HeroRings`, `Card`, `Bar`, `ringDash`, `compactRupees`, `buildDirectoryStats`, `buildDirectoryAnalytics`, `buildActivity` |
| `components/employees/AnalyticsPanels.tsx` | the four analytics panels + the activity feed, one implementation at two sizes |
| `app/admin/employees/directory/page.tsx` | gradient hero, four stat cards, the roster card |
| `components/employees/EmployeeDetailModal.tsx` | the dossier — gradient header, six-figure strip, four tabs |
| `components/employees/EmployeeFormModal.tsx` | New / Edit Employee (one component, so the two paths cannot drift) |
| `components/mobile/MobileEmployees.tsx` | the phone directory, profile overlay and add/edit sheet |

`AddEmployeeModal.tsx` and `employeeChrome.tsx` are gone — replaced, and
nothing else imported them.

**The analytics are derived once and drawn twice.** The desktop dossier and the
phone overlay both call `buildDirectoryAnalytics`, so a win rate on one surface
cannot disagree with the other. The two design files draw the same four panels
at different sizes (62px rings against 56px, a 172px plot against 132px), so
the geometry is a `variant` prop rather than a second component.

**Nothing on the screen is decorative sample data.** The design file's stat
cards carry hard-coded sparkline arrays and delta pills; `buildDirectoryStats`
replaces them with seven real monthly readings ending on the current month and
a delta measured against last month. A trend line that means nothing is worse
than none — it invites a decision from a shape.

**The rings are transcribed per file, not generalised.** The first attempt
derived each circle as a fraction of its viewBox from the desktop file. The
mobile file uses different radii (74/116/56 in a 390×220 box, not 0.43/0.65/0.30
of the height), so the phone header's rings came out ~28% too large. `RING_SETS`
now holds all three sets verbatim — `hero`, `modal`, `phone`.

**Three fields the design does not draw**, added in its own idiom because the
feature does not work without them: a **password** (Firebase Auth cannot create
a user without one — required on create, blank keeps the current on edit), the
**lane priority** (1–10, BR-6), and the **monthly KPI targets** (the
denominators behind every Day End Report percentage). The design's "Monthly
Target (PKR)" is `targets.revenue`; its "Lead Assignment" select is
`autoAssign`.

**`autoAssign`.** "Manual assignment only" takes an employee out of automatic
distribution *and* out of the cascade, while leaving them able to receive a
lead an admin hands them. Absent means in the lane, so adding the field cannot
empty the rotation for records that predate it (`lib/distribution`, 4 new
tests).

**Found and fixed:** `useEmployees` typed `phone`, `joinedAt`, `notes` and
`autoAssign` on `EmployeeData` but never read them out of the snapshot — the
directory would have written them and then shown them empty for every real
(non-demo) account. The mapper now reads all four.

**Compact money where a figure does not fit.** "Rs 4,850,000 of Rs 3,000,000"
ellipsised inside the design's 200px KPI card and became a different, wrong
number; it now reads `Rs 4.8M of Rs 3M`. Only used where the exact amount is on
the same screen or in the ledger.

**Departures, each deliberate:**
- The phone's add/edit is a bottom sheet carrying **every** field the desktop
  form has, not the design's six. An admin on a phone must be able to create a
  usable account, not a half-configured one.
- The phone's password field is not masked — the admin is reading it aloud to
  the new employee, and there is no room for a reveal button beside it.
- Status is saved through `disableEmployee` / `enableEmployee` rather than
  `updateEmployee`, because disabling reports how many open leads the employee
  was still holding.
- The mockup's phone frame (9:41 clock, signal bars, home indicator) is again
  not reproduced — `env(safe-area-inset-*)` instead.

- **Validation**: `typecheck` 0 errors, `test` 122/122, `build` 32 routes,
  `eslint src` unchanged at 7 pre-existing errors (none in the new files).
  Driven in Chromium at 1440×1000 @2x and an emulated iPhone 13 (390×700),
  asserting *computed* values rather than trusting screenshots: hero gradient
  `linear-gradient(115deg, rgb(31,92,88) 0%, rgb(63,143,138) 62%, rgb(79,163,156) 100%)`,
  heading family `Manrope`, row grid `420.5 / 175.2 / 175.2 / 175.2 / 227.8px`
  (the design's `minmax(240px,2.4fr) 1fr 1fr 1fr 1.3fr`), Won `rgb(47,125,120)`
  / Lost `rgb(192,87,74)`, stat radius 16px with a `rgb(63,143,138)` stripe.
  Round-trips on **both** surfaces: create added a row and banner, edit changed
  the role and the card re-rendered with it, Inactive filtered 5 → 1, search
  filtered 5 → 1. Zero console errors, zero horizontal overflow on either.

### 2026-08-31 — Add Lead parity on the phone, an account sheet, dossier filters, pagination

Four changes, all four driven in a real browser rather than reasoned about.

**1. The phone's Add Lead now matches the desktop field for field.** It carried
eight fields against the desktop's twenty-one, so a lead typed on a phone was a
thinner record than the same lead typed on a laptop. It now carries:

| was missing | now |
|---|---|
| Original creation date | `datetime-local` with a "Now" shortcut and a `max` of now |
| Pipeline status | the **full 12-status list**, not a shortlist of three chips |
| Settlement | the whole Confirmed Deal block, unfolding when the status is Closed / Won — description, received, payable, method, date, portfolio category, notes |
| History | any number of backdated notes, each with its own channel and date |

Validation is the desktop's rules **in the desktop's order with the desktop's
messages**, and the same `createLead` payload is sent, so the two surfaces
cannot accept different records.

**2. The phone had no way to sign out.** `MobileAccount.tsx` puts an
`AccountButton` in all three phone headers (dashboard, leads, directory); it
opens a sheet with the signed-in identity, a role pill, the destinations the
five-slot tab bar has no room for, and **Sign out** at the bottom in red.
Sign-out `replace()`s rather than pushes, so a back gesture cannot land on a
signed-in screen from the bfcache. Destinations are role-split the same way as
`GlobalLayout`'s sidebar; they are listed flat here rather than imported,
because the sidebar's shape is a nested accordion and sharing it would mean
flattening the tree on every open.

**3. The employee dossier has filters on both surfaces.** A period select
(Today / This week / This month / All time) and, on the Leads tab, the same
All / Active / Closed / **Hot** / **Cold** cuts the leads workspace uses.

The cut calls `matchesLeadFilter` rather than restating what "active" or "hot"
means — a second definition here would drift from the one the workspace
enforces and the two screens would disagree about the same lead. The period is
measured on `createdAt` for leads (matching `buildEmployeeMetrics`) and on the
settlement date for deals; filtering leads on last touch would move a lead
between periods every time somebody rang it.

**The filters cut the tab bodies only.** The six-figure strip and the Analytics
tab keep describing the employee's whole record — a headline that moved when
you clicked "Today" would read as their career having shrunk. The Deals and
Activity tabs hide the Hot/Cold chips: a deal has no stage and no temperature,
so offering them there is a control that silently does nothing.

**4. Pagination**, via `hooks/usePagination` + a shared `Pager`:

| list | page size |
|---|---|
| web roster table | 10 |
| web leads list panel | 15 |
| phone roster | 8 |
| phone leads list | 12 |
| dossier Leads / Deals / Activity (both surfaces) | 6 |

Deliberately **not** a Firestore cursor: every list here is derived from
documents the page already loaded for its rollups, so a server cursor would
fetch twice and make the totals disagree with the pages.

Two rules worth keeping:
- The pager is **hidden entirely** when everything fits on one page. A control
  that can only ever say "1 of 1" is noise.
- The page resets to 1 when the list **shrinks**, not whenever it changes.
  Shrinking is a search or filter, and being left on an empty page 4 reads as
  "the search found nothing"; growing is almost always a live Firestore update,
  and being yanked back to page 1 because a colleague logged a lead would be
  worse than a stale page. Reading is clamped either way.

The reset happens **during render**, not in an effect — this project's lint
rule rejects `setState` inside an effect, and an effect would paint one frame
of the wrong page first.

**Also fixed:** two icons in the account sheet. "Closed Deals" was a bag
outline that read as a padlock at 18px, and "Office Expenses" was a lined
document indistinguishable from "Reports".

- **Validation**: `typecheck` 0 errors, `test` 122/122, `build` 32 routes,
  `eslint src` unchanged at 7 pre-existing errors. Driven in Chromium at
  1440×1000 @2x and an emulated iPhone 13:
  - Add Lead: 12 status options, settlement block unfolds on Closed / Won,
    15 controls, History section present.
  - Account sheet: identity + ADMIN pill + 8 destinations + Sign out.
  - Dossier: desktop "3 of 3 leads" → Hot → **"1 of 3 leads"**; phone Closed
    cut 3 → 1, and the Today period fell through to the "No leads match this
    filter" state rather than an empty list.
  - Pagination proven by temporarily setting a page size of 2: page 1 showed
    `1–2 of 4`, page 2 showed `3–4 of 4` with the correct two names, and
    searching narrowed to one row and **removed the pager**. Page sizes
    restored afterwards.
  - Zero console errors and zero horizontal overflow throughout.

### 2026-09-01 — The Data Bank: cold lists, per-source fields, CSV import

Cold lead lists now live apart from the pipeline, organised into folders by
source, each folder carrying its own field list because every source's
spreadsheet has different columns.

**Why separate collections.** `leads` is a small live working set five people
share. A Capital Smart City export is 20,000 cold rows. Mixing them would slow
every pipeline query and make "how is the pipeline doing" meaningless.

| | |
|---|---|
| `lib/dataBank.ts` | fields, phone keys, the CSV parser, column mapping, import preparation |
| `lib/dataBank.test.ts` | 38 tests over the parts that silently corrupt data |
| `app/actions/dataBank.ts` | folders, records, batched import, promotion |
| `hooks/useDataBank.ts` | live folders; **cursor-paged** records |
| `components/dataBank/` | folder form, importer, folder workspace, record form |
| `app/admin/data-bank/` | the folder grid and `[folderId]` |

**Fields are per folder, and two of them are load-bearing.** Labels are the
source's own words — "Member Name", "Form Number". One field is designated the
name and one the phone, because without knowing which column holds the number
the app cannot dial it, cannot spot a duplicate, and cannot promote the row
into a lead. **Keys are generated and permanent; only labels are editable** —
storing rows against the label would orphan every record the moment somebody
fixed a typo in a column name.

**Column mapping, not exact-name matching.** The owner's original plan was for
folder fields to match the CSV headers exactly. That breaks the first time
Excel exports `Contact No` instead of `Contact Number`. The importer instead
shows every header beside the field it will land in, pre-matched, and
**remembers the corrections on the folder** so the second import is one click.

`suggestColumnMap` matches word by word after expanding abbreviations. The
first attempt used prefix matching alone and failed on the motivating example:
**`No` is not a prefix of `Number`** — "number" begins "nu"; `No` is the
conventional short form of *numero*. There is a small explicit table
(`no/num → number`, `addr → address`, `amt`, `qty`, `ph`, `mob`) because there
are only a handful that matter and guessing at them is worse than listing them.

**Phone keys do the deduping.** `0300 1234567`, `+92 300 1234567` and Excel's
`3001234567` (leading zero eaten by number formatting) all reduce to one key.
Junk yields `""`, and an empty key never matches — two rows with no number are
not duplicates of each other.

**No CSV dependency.** The npm build of SheetJS is pinned at 0.18.5 with two
unpatched advisories (prototype pollution, ReDoS) and the vendor's patched
build is off-registry. CSV is a small enough grammar to own: quoted fields,
embedded commas and newlines, `""` escapes, CRLF, and Excel's UTF-8 BOM — which
otherwise turns the first header into `﻿Member Name` and matches nothing.
**Excel files are not yet parsed**; the importer says so and points at Save As
→ CSV.

**Nothing is dropped silently.** `prepareImport` reports rows with no name, no
usable number, or a number repeated earlier in the file — by line number. A
test asserts every row of a sheet is accounted for exactly once. An importer
that quietly discards 300 of 1,200 rows and reports success is how a calling
list ends up mysteriously short.

**Imports are chunked at 500** (Firestore's batch cap) with a progress bar, and
**existing numbers are skipped, never overwritten** — re-importing last month's
sheet must not wipe the statuses somebody set all week.

**Records are cursor-paged, not loaded whole.** This is the one list that can
hold 20,000 documents; loading it would cost 20,000 reads per open. That is why
this list has next/previous rather than the numbered `Pager` — Firestore has no
offset, and faking one costs a read per skipped row. Search is served by the
index: a phone-shaped query is an exact match on the dedupe key, anything else
is a name prefix.

**Promotion writes straight to ACCEPTED** — an admin handing out a lead is a
decision, not an offer, matching `assignLead`. Every source column travels onto
the lead's `customFields` under its own label, so the address and form number
follow it into the pipeline. **The row then leaves the folder**, by the owner's
decision; the cost, stated at the time, is that per-source conversion rate is
no longer derivable.

**Admin-only, both collections.** An employee gets one of these rows when an
admin promotes it to them. Readable by employees, this would hand every one of
them an exportable copy of every number the business has bought.

**Not done, awaiting the owner:**
- **Leads is not yet restricted to Meta Ads.** Taken literally it cannot be —
  promoted leads must appear in the pipeline, and the browser test confirms
  they do (source `DATA_BANK`). What that leaves is whether to remove **Add
  Lead** from the leads screen now that manual entry belongs here. Removing a
  working control on an ambiguous instruction is the owner's call.
- **No records were deleted.** "They are mocked, remove those and employees as
  well" is a destructive live-data operation and the scope was never confirmed.

- **Validation**: `typecheck` 0 errors, `test` 156/156 (122 → 156), `build` 35
  routes. **`eslint src` initially rose to 10 errors and this entry first
  claimed otherwise — corrected the same day**: a ref mutated during render in
  `FolderFormModal`, and two `setState`-in-effect reports in `useDataBank`.
  All three are fixed (uid derived inside the state updater; the cursor reset
  moved inside the async fetch), leaving one narrow, justified suppression
  where the rule cannot see that the updates land in a microtask. Back to the
  7 pre-existing errors. Driven in Chromium
  at 1440×1000 @2x against a deliberately messy CSV — quoted commas, a mixed
  phone format, a junk number, a cross-format duplicate:
  - created a folder with five custom fields and the two roles set;
  - the mapper guessed all five columns, including **`Contact No` →
    `Contact Number (phone)`**;
  - 6 rows → **4 imported**: `n/a` rejected, and `03001112223` recognised as
    the same line as `0300 1112223`;
  - `"Ahsan, Jr."` and `"Multan, Cantt"` survived as single fields;
  - the detail pane rendered all five fields in the source's own words;
  - promoting dropped the folder 4 → 3 and the lead appeared in the pipeline as
    **ACCEPTED · Source: DATA BANK**, assigned to Ayesha Khan with the phone
    carried across.
  - Zero console errors, zero horizontal overflow.

### 2026-09-01 — Manual lead entry moves to the Data Bank

Signed off with the owner. The pipeline is now inbound work only: Meta Ads
intake, plus anything promoted out of a cold list. Nothing seeds it by hand.

- **`Add Lead` is gone from `/admin/leads`**, replaced by a link to the Data
  Bank so the path to manual entry stays one click away rather than becoming
  folklore.
- **The phone's centre button no longer adds a lead.** Both roles now get the
  same action — dial whoever is on the acceptance clock — and an empty slot
  when there is nobody, which beats a button that no longer belongs on the
  screen.
- `useCampaigns` was dropped from both leads surfaces; the Add Lead form was
  its only consumer there, and it was opening a listener for nothing.

**`AddLeadModal.tsx` and `MobileAddLead.tsx` are deliberately kept**, unused.
They are complete, tested, full-parity forms, and the likeliest follow-up
request is a one-off referral that is neither a Meta lead nor cold list data.
Re-enabling either is restoring one import, one `useState` and one render
block. Delete them only once that possibility is genuinely closed out.

**Leads is not filtered by source.** The rule the owner asked for — "Leads is
Meta Ads only" — cannot be literal, because a promoted record has to appear in
the pipeline, and does (`source: DATA_BANK`, verified in the browser). What
"Meta only" actually meant was *no manual seeding*, which is what shipped.

- **Validation**: `typecheck` 0 errors, `test` 156/156, `build` 35 routes,
  `eslint src` back to the 7 pre-existing errors. Verified in Chromium at
  1440×1000 and an emulated iPhone 13: Add Lead absent on both surfaces
  (desktop button count 0, phone add-action count 0), the Data Bank link
  present, the pipeline still listing 16 rows, and the phone's centre button
  now the call action. The Data Bank was re-checked after the hook rewrite —
  4 records, search "Nadia" narrowing to 1 and resetting paging. Zero console
  errors, zero horizontal overflow.

### 2026-09-01 — `purge-all-data`: a script to empty the live project

"Delete all the records" cannot be done from the assistant's sandbox and was
not attempted. `.env.local` carries only the `NEXT_PUBLIC_*` client config;
there is no service-account key in the repo, and the client keys cannot delete
anything because Security Rules set `allow write: if false` on every collection
this app owns. Deleting live data also needs a decision about scope that a
script can state and a person can approve. So the deliverable is the script,
run locally by the owner.

`scripts/purge-all-data.mts` — `npm run purge-all-data`, dry run by default.

**Four groups**, deleted in this order so a half-finished run leaves employees
without leads rather than leads assigned to people who no longer exist:

| group | collections |
|---|---|
| `leads` | `leads` (+ its `events` / `followUps` subcollections), `closedDeals`, `notifications`, `campaigns` |
| `employees` | non-admin `users/*` (+ `kpiMonths`), all `attendance`, and their Auth accounts |
| `financials` | `expenses`, `committee`, `investments`, `capitalInvestments`, `receivables`, `personalExpenses` |
| `data-bank` | `dataBankFolders`, `dataBankRecords` |

`--only=` / `--skip=` select groups. Both are value-form flags, so a typo is
rejected rather than quietly meaning "all".

**Administrators are preserved, with no flag to override.** Deleting the
account you are signed in with locks you out of the app *and* out of running
this script again; re-creating one means going back to `set-admin-role`. If no
`users/*` document has `role: "admin"`, the script says so before the prompt —
otherwise a clean-slate wipe produces a database nobody can sign into, which
looks like a bug days later.

**`config/*` is preserved by default.** The office-network allow-list lives
there, and losing it silently turns every attendance day into "Unverified".
`--include-config` for a genuine factory reset.

**Auth accounts go with the profile.** An Auth account with no `users/{uid}`
document can still sign in and lands in a broken session, so leaving them is
worse than removing them. `--keep-auth` keeps sign-ins. A profile with no Auth
account (a seed leftover) is stepped over rather than aborting the run.

**Two gates, not one.** `--confirm` only gets you to a prompt that states the
real document count and requires the **project id typed back**. The flag is
easy to copy out of a README into the wrong terminal; the project id is not.
Everything is counted before anything is deleted so that prompt can say
"deletes 4,182 documents" rather than "deletes everything".

`recursiveDelete` rather than a batch loop: `leads/*/events` and
`leads/*/followUps` would otherwise survive their parent, unreachable and still
billing storage.

- **Validation**: driven end-to-end against the Firestore + Auth emulators on a
  seeded database (2 leads with both subcollections, 3 employees + 1 admin, a
  profile with no Auth account, all 13 collections, `config/office`), asserting
  the resulting database rather than the script's own output — **23/23**:
  every targeted collection empty, `config` intact, the admin the only
  surviving user with their `kpiMonths`, both employee Auth accounts gone and
  the admin's kept, both lead subcollections gone. The dry run and a
  mistyped-project-id run each left all 19 documents in place. Project checks
  unchanged: `typecheck` 0 errors, `test` 156/156, `eslint src` at the 7
  pre-existing errors.

### 2026-09-01 — Data Bank: leads-parity UI, 40k imports, a real phone screen

Five changes, all driven in a browser against computed values rather than
reasoned about.

**1. The folder workspace now matches the leads workspace.** It was the same
two-pane idea drawn slightly differently, which reads as two products. The
list panel is now the pipeline's list panel: the `leads-shell` height, the
78px teal band, the search row **with the filter square beside it**, the same
chip geometry (`px-2.5 py-2`, `#cfe2e0` border), and rows on the same
`grid-cols-[44px_1fr_auto]` with a 44px ringed avatar, the staggered
`animate-lead-row` entrance, the date on the right, and **read-state shading**
from the same `useOpenedLeads` store — a record you have opened recedes
exactly as a lead does.

`components/leads/WorkspaceEmpty.tsx` — the "nothing selected" illustration,
extracted so both screens render literally the same SVG instead of one of them
carrying a plain paragraph. It takes an optional `hint` line.

`CursorPager` (in `DossierControls`) gives the cursor-paged record list the
`Pager`'s visual language — same `Step` arrows, same count line — **without
page numbers or a total**, because a Firestore cursor cannot jump to page 7
and counting a 40,000-row folder on every page turn is a whole extra
aggregation. Numbers that only ever step by one would promise otherwise.

**Header names wrap rather than truncate.** "Capital Smart City" was rendering
as "CAPITAL SM…" — the pipeline's "ALL LEADS" is a fixed label that always
fits, but a folder name is the one thing on that bar that has to be readable.
Clamped to two lines inline, not with a utility class.

**2. The record pane reads like a record, not a wall.** A facts strip
(Status / Source / Added / *n* of *n* fields filled) over a **two-column**
field grid; a value longer than 46 characters takes the full width back so an
address is never squeezed into half a pane. The two role fields wear `name` /
`phone` chips — they are what makes the row dialable and dedupable.

**3. Imports are no longer capped at 20,000 rows.** Two separate things were
wrong:

- `MAX_IMPORT_ROWS` was a flat 20,000. It is now **200,000** — a guard against
  a mis-picked file, not a capability limit, since rows are sent in chunks and
  a big file costs time, not correctness.
- **The real bug was payload size, and it would have bitten at any row count.**
  Chunks were a flat 500 rows. Next's default Server Action body limit is 1 MB,
  and a 500-row chunk of a 40-column transfer sheet serialises to **1.93 MB**
  (measured, not estimated) — so a wide import died partway with an opaque
  error after writing half the file. `chunkRowsByPayload` now closes a chunk on
  **whichever ceiling it reaches first**, rows or bytes; `next.config.ts` raises
  `serverActions.bodySizeLimit` to 4mb as headroom above the 1 MB chunk cap.
  Raise the two together or not at all.

Also: a **Reading…** step, because parsing 40,000 rows takes a moment on the
main thread and without one the tab simply appears frozen; a remaining-time
estimate computed where progress is set (not during render — `Date.now()` in a
render body is impure and the lint rule is right about it), withheld until a
tenth of the file is through so the first chunk's connection setup does not
produce a wild figure that then collapses; and failure messages that name how
many rows are already saved and that re-running skips them.

Chunks stay **sequential on purpose**: each chunk's duplicate check reads what
the previous ones committed.

**4. The phone gets a real Data Bank** (`components/mobile/MobileDataBank.tsx`)
rather than the desktop two-pane grid squeezed into 390px, which is what made
it unusable. A sources screen with header stats and folder cards, a folder
screen with the search pill, chips and rows in the phone leads idiom, and a
full-screen record overlay with Call / WhatsApp / Edit at thumb height. Import
and the two forms reuse the desktop modals. `MobileShell.hasOwnChrome` now
covers both routes. Reads are gated on which surface is actually rendering —
this is the one list that costs a page of Firestore reads to open, so letting
both subscribe would double it.

**5. The admin's bottom-bar centre is the Data Bank, on every screen.** A
destination, not a contextual action: it is where an admin's manual work lives
now that the pipeline has no Add Lead, and a five-slot bar has no room for a
sixth tab. **Cost, stated:** an admin loses the contextual "call whoever is on
the acceptance clock" button that used to sit there. Employees keep the
contextual centre unchanged.

**Found and fixed in the browser, invisible in review:** the phone folder
cards' own Edit / Delete row was being clipped off the bottom. Flex items in a
column container shrink below their content by default; the cards needed
`flexShrink: 0`. Confirmed by measurement (215px content in a 217px box after
the fix), not by looking at a screenshot.

- **Validation**: `typecheck` 0 errors, `test` 162/162 (156 → 162; 6 new over
  the chunker — whole batches, nothing lost or reordered, a wide sheet closing
  on size, a real-JSON ceiling assertion, an oversized single row, an empty
  sheet), `build` 34 routes, `eslint src` back to the 7 pre-existing errors.
  Driven in Chromium at 1440×1000 @2x and an emulated iPhone 13 — **32
  assertions, all against computed values**: the Data Bank row's grid template,
  gap, padding, radius and 44px avatar all equal the leads row's; unopened
  `rgb(226,240,238)` → selected `rgb(198,224,220)` → opened `rgb(251,253,253)`
  on click; the folder name renders complete and unclipped; the shared
  illustration present on both; the admin's centre slot is the Data Bank and
  lands on it; no horizontal overflow on any of the five screens.
  **A real 40,000-row × 4-column CSV (5.4 MB, `Contact No` header) was imported
  end to end**: parsed in 0.4s, auto-mapped all four columns including
  `Contact No → Contact Number (phone)`, 40,000 of 40,000 ready, folder 4 →
  40,004, zero console errors. Chunking checked against real serialised
  payloads: 80 chunks at 104 KB for that file; a 40-column sheet splits into
  87-row chunks at 352 KB where a naive 500-row chunk would have been 1.93 MB.

  The only console error in any run is `apis.google.com/js/api.js`
  (Firebase Auth's iframe) failing through the sandbox proxy — environmental,
  present before these changes.

**Still open:** Excel (.xlsx) is still not parsed — the importer detects it and
points at Save As → CSV.

### 2026-09-01 — Promotion latency + feedback; attendance becomes a manual punch

Three reports. The first two turned out to be one root cause and one genuine
bug; **the pipeline itself was never broken**, which I established by running
the real code path against the Firestore + Auth emulators rather than reading
it.

**What the repro actually showed.** Promoting a Data Bank record wrote the lead
correctly every time: the row left the folder, the admin's pipeline listed it as
`Accepted`, and the **employee's own pipeline listed it too**. So "it doesn't
move to the lead section" was not a write that failed. Two things made it look
like one:

**1. The success confirmation was rendered inside the component that gets
destroyed.** `afterWrite` set a banner, but the banner was only rendered inside
`RecordPane` — and `onRemoved` calls `setSelectedId(null)` first, unmounting
that pane in the same tick. Asserted in the browser: after a successful
promotion `paneOpen: false` and no banner text anywhere on the screen. The row
silently vanished and nothing else happened, so from the admin's side the
promotion had simply disappeared. The banner now lives in the **list panel**,
which is always mounted, and carries a **link into the pipeline** — a promoted
record leaves this screen entirely, so "it worked" is not enough on its own.

**2. Promotion made seven sequential round trips.** That is the "sometimes it
works, sometimes it doesn't":

| was | now |
|---|---|
| `verifyIdToken(token, true)` — `checkRevoked` forces a network call to the Auth backend, not a local JWT verify | unchanged, and deliberately so: FR-3 needs a disabled employee blocked immediately |
| `users/{uid}` get, then record get, then employee get — **three sequential trips** | one `Promise.all` |
| `loadFolder()` get, then **`folder.ref.get()` again** for the name alone | `loadFolder` returns the name; the second read is gone |
| `runTransaction` (begin + commit, with retry machinery) | a `WriteBatch` — nothing is read inside the critical section, so the transaction was paying for guarantees it never used |

Seven sequential steps become three. Measured end to end on the emulator at
**0.5–1.3s**; the win on a real project is larger because every one of those
trips is a real network hop.

**3. `withTimeout` (`lib/withTimeout.ts`).** A Server Action that never returns
left the button reading "Working…" with no way to tell whether the write
happened. Promotion is now bounded at 25s on both surfaces and says plainly
that the work *may* have gone through — which is honest, since the timeout
cannot cancel the request. Every operation behind it is safe to retry.

**Attendance is now a manual Check In / Check Out**, at the owner's request.
The activity heartbeat is gone from `useAttendance`.

The trade is worth stating because it reverses an earlier decision: presence is
now **declared**, not observed, so the times are whatever the employee says.
What has *not* changed is the part that could never be faked from a browser —
**the network is still classified server-side from the request's own IP**.
Verified in the browser rather than assumed: with `127.0.0.1` in the allow-list
the check-in came back `Checked in at 3:59 PM · Office`, and with an empty list
the same punch read `Unverified`.

- **A punch off the office network is recorded, not refused.** Blocking would
  be actively harmful in the two commonest cases: the allow-list starts empty,
  which would lock the whole company out of attendance until Settings is filled
  in, and field staff genuinely work away from the office. The day is stamped
  Office / Remote / Unverified and the admin can still override it.
- **Both directions only move outward.** A second Check In keeps the earlier
  time; a Check Out never rewinds an existing one. A stray tap cannot shorten a
  day already recorded.
- **Both buttons stay on screen** rather than one swapping for the other — a
  control that disappears after use leaves no way to see what state you are in,
  and Check Out has to be reachable all day.
- `checkedOut` is a new field: with nothing writing in the background,
  "lastActionAt is set" no longer means the day was closed.
- `deriveStatus(0, true)` is `HALF_DAY`, so a day checked in but not out is
  never graded absent — worth a test, because `workedMinutes` is now 0 all
  morning where the heartbeat used to keep it climbing.
- `recordAttendancePing` is **kept but no longer called**: it is the only
  writer that can reconstruct a day from observed activity, which is what an
  auto-close sweep would need.

**A testing note that cost time here.** The first punch run failed with
`TypeError: Cannot read properties of undefined (reading 'apply')` and a 500 on
the Server Action. It was not a bug: a dev server from an earlier aborted run
still held the port, so `next dev` printed `EADDRINUSE` and the test drove a
server whose Server Action manifest predated the new action. The harness now
fails loudly if the port is taken and clears `.next` first. Worth remembering
before "fixing" a phantom.

- **Validation**: `typecheck` 0 errors, `test` 168/168 (162 → 168; 6 new over
  the punch invariants — opening a day, a second check-in not rewinding, a
  later check-out extending, an earlier one not shortening, the minute
  arithmetic, and never grading an open day absent), `build` compiles,
  `eslint src` at the 7 pre-existing errors.
  **13 assertions driven against the Firestore + Auth emulators** on the real
  (non-demo) code path, seeded with an admin, one employee and a two-record
  folder: promotion finished in 1.3s with the button released, the confirmation
  shown, the pipeline link present, and the lead visible to **both** the admin
  and the employee; Check In reported `3:59 PM · Office`, the state flipped to
  "You are checked in", Check Out flipped it to "Day closed", and a second
  Check In was refused with "the earlier time stands". Zero console errors on
  either role. Re-checked in demo mode as well.

### 2026-09-01 — Admin punch buttons; auth verification made local

Two corrections to the previous entry, both reported by the owner as "nothing
changed".

**1. The Check In / Check Out buttons were hidden from admins — my error.**
I gated them `onPunch={isAdmin ? undefined : …}` on the reasoning that an admin
is not on the roster's clock. The owner *is* the admin, is the account most
often signed in, and had just asked for the button. Removing a requested
feature for a role on my own judgement was the wrong call. Both roles get the
buttons now, on both surfaces. `onPunch` stays optional so a caller can still
render the strip read-only; nothing does.

**2. `checkRevoked` is gone from token verification — this was the slowness.**
`verifyIdToken(token, true)` does not verify locally: the `true` forces a
**network round trip to the Auth backend**, and it is the first thing every
Server Action does, before any work starts. It is also the first call that has
to resolve Admin SDK credentials. On a slow link that single flag was the
dominant cost of every write in the app, and it is the most likely reason
promotion was still hitting the 25-second timeout on the owner's project after
the round-trip count had already come down from seven to three.

**Dropping it does not weaken FR-3.** A disabled employee is still blocked on
their very next request, by the check that was always there:
`disableEmployee` writes `status: 'DISABLED'` onto `users/{uid}`, and
`verifyAuth` reads that document on every call anyway and rejects it. It also
calls `updateUser({disabled:true})` and `revokeRefreshTokens`, so the account
cannot mint a fresh token either. `checkRevoked` was a third belt on the same
braces, paid for on every single action.

**3. Timing is now observable instead of guessed at.** "The app is slow" was
unanswerable from here: the symptom is a spinner in a browser and the cause is
a round trip on a machine I cannot see.

- `runAction` prints `[action:<name>] took Nms` for anything over 2s, and
  includes the elapsed time on failures.
- `promoteDataBankRecord` prints a phase breakdown when it is slow:
  `[promote] 8421ms — auth+reads 8100ms, folder 190ms, commit 131ms`. Three
  phases with very different causes; one line says which to look at.
- The timeout message now points at the terminal.

**Worth knowing for whoever reads this next.** `.env.local` as committed to the
repo carries only `NEXT_PUBLIC_*` keys — no `FIREBASE_CLIENT_EMAIL` or
`FIREBASE_PRIVATE_KEY`. `getAdminApp()` falls through to
`initializeApp({ projectId })`, i.e. Application Default Credentials. On a
machine with no ADC configured the Admin SDK probes the GCE metadata server and
retries before giving up, which is its own multi-second stall on every call. If
the new `[promote]` line shows the time in `auth+reads`, check those two
variables first.

- **Validation**: `typecheck` 0 errors, `test` 168/168, `build` compiles,
  `eslint src` at the 7 pre-existing errors. **16 assertions against the
  Firestore + Auth emulators**, up from 13: everything from the previous entry
  still passes, plus **the admin sees both buttons and checked in at
  `4:30 PM · Office`** — the case that was broken. Zero console errors on
  either role.

### 2026-09-01 — Promotion stops waiting on the Server Action's response

Fourth report of the same symptom, and the previous three fixes each addressed
something real without addressing *this*. The decisive evidence came from the
owner's screenshot, not from reading the code: the folder header read **49
records** where it had read 51. **The write was committing every time.** Records
were leaving the folder, the counter was moving — and the browser still sat on
"Working…" until the 25-second timeout.

So the failure was never in the write. It was in the acknowledgement.

**Two theories tested and discarded first**, because guessing again was not
acceptable:

- *Missing Admin SDK credentials causing an ADC/metadata stall.* Reproduced
  directly: with no credentials the Admin SDK throws
  `Could not load the default credentials` **immediately**. It fails fast, it
  does not hang — and the owner's writes were committing, which they could not
  do without working credentials. Theory dead.
- *Latency inside the action.* Already cut from seven sequential round trips to
  three, and the emulator measures the whole action at 0.5–1.3s. Not 25s.

**The fix: treat Firestore as the answer, not the function's return value.**

`lib/watchGone.ts` opens a document listener on the record being promoted.
`promote` then races two independent signals:

| signal | arrives over | tells you |
|---|---|---|
| the action's `ActionResult` | the Server Action's HTTP response | *why* something was refused |
| the record's deletion | Firestore's realtime channel, already open | that the write **actually landed** |

Whichever answers first wins. The action is still awaited and its error still
surfaces, because only it can explain a refusal — this is a second answer, not
a replacement. But a promotion that commits is now reported as successful even
if the HTTP response never comes back at all, which is exactly the owner's
case.

This is the right shape independently of the bug: the database is the source of
truth for whether a write happened. An HTTP response is a claim about it.

**Proven by reproducing the failure rather than describing it.** The browser
test intercepts the Server Action POST, lets it reach the server so the write
genuinely commits, then **holds the response back for 40 seconds** — longer
than the client's 25s ceiling. That is the reported bug, manufactured on
demand. Before this change it produced the timeout message; now:

- the button released after **0.6s**, from the realtime channel;
- it reported success, not a timeout;
- the lead appeared in the admin's pipeline **and** the employee's.

**Also in this round** (from the previous report):

- **Check In / Check Out were hidden from admins — my error.** I gated them
  `isAdmin ? undefined : …` reasoning that an admin is not on the roster's
  clock. The owner *is* the admin and had just asked for the button. Both roles
  get it now.
- **`checkRevoked` dropped from `verifyIdToken`.** The `true` argument turns
  local signature verification into a **network round trip to the Auth
  backend**, first thing in every Server Action. FR-3 is unaffected:
  `disableEmployee` writes `status: 'DISABLED'` onto `users/{uid}`, which
  `verifyAuth` reads on every call anyway, *and* disables the Auth account and
  revokes refresh tokens. `checkRevoked` was a third lock on the same door,
  paid for on every action.
- **Timing is observable.** `runAction` logs anything over 2s;
  `promoteDataBankRecord` logs a phase breakdown
  (`auth+reads / folder / commit`) so the slow phase names itself instead of
  being guessed at.

- **Validation**: `typecheck` 0 errors, `test` 168/168, `build` compiles,
  `eslint src` at the 7 pre-existing errors. **12 assertions against the
  Firestore + Auth emulators** on the real non-demo path: normal promotion
  1.1s with confirmation and pipeline link; admin Check In `4:46 PM · Office`;
  **the response held back 40s and promotion still completing in 0.6s with a
  success message and no timeout**; and the employee seeing both promoted
  leads. The only console errors in the run come from section 3's deliberately
  mangled response stream — Next's client reacting to the test, not the app.

### 2026-09-01 — The real root cause: the project's daily Firestore quota

Fifth report of the same symptom. This one came with the answer attached: a
screenshot of the Firebase console's usage page, showing the project's **no-cost
limits exceeded** — **Writes 20,000 of 20,000. Deletes 20,000 of 20,000.**
Reads 25,000 of 50,000.

Those are not approximate numbers. 20,000 writes and 20,000 deletes per project
per day are the Spark (free) plan's exact ceilings. The project was sitting on
both of them.

**Why this presented as a timeout instead of an error.** Past the ceiling,
Firestore refuses writes with `RESOURCE_EXHAUSTED`. Neither SDK treats that as a
failure — **both retry it with backoff**. So the error never reached any of the
app's error paths. The request simply outlived the 25-second client ceiling and
surfaced as "The server did not answer in time." Every observed detail follows
from this and from nothing else:

| observed | explained by |
|---|---|
| assignment hangs ~25s, then times out | writes retried past the client ceiling |
| "sometimes it works, sometimes it doesn't" | quota is a per-day budget being consumed in real time — before it is spent, everything works |
| the browser still lists folders and leads instantly | reads sat at 25,000 of 50,000, nowhere near their limit |
| it began the afternoon of the big import | a 40,000-row import is 40,000 writes — **twice the entire daily allowance in one operation** |

The import feature built earlier that same day is what spent the budget. The
20,000-row cap it replaced had been holding the project inside the free tier by
accident.

**The four earlier fixes were not wasted, but none of them was this.** The
success banner surviving its own pane, seven round trips cut to three, racing
the realtime channel against the HTTP response, dropping `checkRevoked` — each
addressed something genuinely wrong. None could have fixed a database that was
refusing to accept writes at all. `watchGone` in particular could not help here:
its signal is the record's *deletion*, and the deletion is the write being
refused.

**The fix is not in the code.** It is the Blaze pay-as-you-go plan (that
40,000-row import costs about seven cents at $0.18 per 100,000 writes) or
waiting for the reset at midnight US/Pacific. What the code owed the owner was
to *say* that, instead of blaming the network for a fifth time.

**So this round makes the condition name itself**, in `lib/quotaError.ts`:

- `isQuotaExhausted()` catches all three shapes the same condition arrives in —
  the browser SDK's `'resource-exhausted'`, the Admin SDK's gRPC status `8`, and
  an HTTP `429` from the REST transport — with message matching as a backstop,
  since the SDKs sometimes carry the status only in the text.
- `describeFirestoreError` (every `hooks/use*.ts` listener) and `runAction`
  (every Server Action) both route it to one message naming both ways out.
  `runAction` logs it as a quota event rather than dumping a stack, because it
  is neither a bug nor an outage.
- `ActionTimeout`'s message now points at Firebase console → Usage and billing
  first. The timeout is the shape this failure *usually* takes, precisely
  because the error is retried rather than raised.
- **The import modal warns before the button is pressed**, once a file exceeds
  20,000 rows: how many writes it is, what the free plan allows, what happens if
  it is exceeded, and what it costs on Blaze. The 40,000-row import is supported
  — it just should not be a surprise.

**Also delivered this round** (built for the previous report, not yet handed
over):

- **`preferRest` support in `lib/firebase/server.ts`, opt-in and off by
  default.** The Admin SDK speaks gRPC/HTTP2 while the browser speaks
  long-polling, and gRPC is the fragile one in the wild — a real suspect for a
  server-only stall. But it is unverifiable from here: the gRPC path honours
  `FIRESTORE_EMULATOR_HOST` and skips credentials, while REST still demands a
  real token, so REST cannot be exercised against the emulator at all. Turning
  it on as the default regressed the suite to 3/9. It ships as
  `FIREBASE_PREFER_REST=true`, not as an assumption.
- **`npm run diagnose`** times auth, a gRPC write and a REST write against the
  real project and prints a verdict. It answers "why is this machine slow?"
  with measurements instead of theories.

**Validation**: `typecheck` 0 errors, `test` **175/175** (7 new, covering each
error shape and — as importantly — that `permission-denied`,
`failed-precondition` and `unavailable` are *not* misread as quota failures and
sent to the billing page), `build` compiles, `eslint src` at the 7 pre-existing
errors.

### 2026-09-01 — What an import costs, counted honestly

Follow-up question from the owner: can the import use fewer reads and writes?
They have many files of thousands of rows each.

**Measured rather than guessed.** For a 40,000-row import:

| | count | share |
|---|---|---|
| record documents | 40,000 writes | |
| folder counter (one per 500-row chunk) | 80 writes | |
| duplicate check (`phoneKey in [30]`, one read minimum per query) | ~1,360 reads | **3%** |

**The writes are a floor, not a setting.** Firestore bills per document, one
record is one document, so 40,000 records cannot cost fewer than 40,000 writes.
The reads are already batched 30 numbers at a time — 17 reads per 500-row chunk
rather than one per row — and a duplicate row costs a read instead of a write,
so re-importing an overlapping sheet is nearly free. There is no tuning left in
this path worth the risk of touching it.

Optimising the 3% was considered and rejected: skipping the duplicate query on
an empty folder only helps the first chunk (chunk 2 sees a non-zero count), and
deterministic `folderId__phoneKey` document ids with optimistic `create()`
would reach zero read cost but needs a data-model flag, a fallback path, and a
bet on how failed batches are billed — real risk added to the one feature that
had just caused an outage, to save about a tenth of a cent.

**The only lever that would actually move the number is a different data model**
— packing ~200 records into one bucket document, which would cut import writes
by 200× *and* list reads by 8×, at the cost of server-side search and status
filtering (both become client-side scans), plus write contention when two admins
touch the same bucket. That is a rewrite of the Data Bank's storage layer, not a
tuning change, so it is the owner's call and has not been made.

**What did change: `estimateImportCost()` in `lib/dataBank.ts`**, counting
writes, reads and Blaze dollars exactly the way the import path spends them,
shown in the import modal for anything over 1,000 rows — as a plain line when it
fits inside a day's free allowance, amber when it does not. The number that
decides whether an import stalls the whole project is now on screen before the
button is pressed.

**Validation**: `typecheck` 0 errors, `test` **180/180** (5 new on the estimator,
including that the counter overhead is exactly one write per chunk and that
reads stay under 5% of writes), `build` compiles, `eslint src` at the 7
pre-existing errors. The modal panel itself is checked by build and by the
arithmetic behind it, not by a browser run.

### 2026-09-02 — Promotion: the delete quota, and why gRPC hid it

**Reported for the fifth time:** promoting a Data Bank record to an employee
(Aroosa Abbass) spins for 25 seconds and returns the timeout message. This
round the cause was measured against the live project rather than reasoned
about, and it is not the one the previous rounds assumed.

**The measurement.** Against `leadway-crm` with real service-account
credentials, timing each primitive separately:

| operation | gRPC (the default) | REST |
|---|---|---|
| `set` | ok, 1,796 ms | ok, 1,745 ms |
| `delete` | **still retrying at 170 s** | **`429 RESOURCE_EXHAUSTED` in 293 ms** |
| batch containing a delete | **hangs** | refused immediately |

So **writes are fine and deletes are refused.** Firestore's free plan meters
reads, writes and deletes as three separate daily allowances, and this project
has spent its deletes (20,000/day). A 40,000-row folder cleanup does that in one
action.

**Two failures compounded, and both are now fixed:**

1. **Promotion needed a delete it did not need.** The batch created the lead,
   its event and its notification — and deleted the source row. One refused
   delete failed the whole batch, so the lead was never created either.
   Promotion had become hostage to a quota that has nothing to do with creating
   leads. The row is now **moved** to a reserved folder id
   (`PROMOTED_FOLDER_ID`) inside that batch, which is a write; the document is
   deleted immediately afterwards, outside the batch, where failing costs
   nothing. Every records query is `where("folderId", "==", …)`, so the row
   leaves its folder exactly as visibly as before — no new status, no query
   change, no index. A `promotedLeadId` guard stops a surviving tombstone being
   promoted twice, and `deleteDataBankFolder` sweeps tombstones by
   `promotedFromFolderId` so they cannot become unreachable.

2. **gRPC never reported the refusal.** The Admin SDK treats
   `RESOURCE_EXHAUSTED` as retryable and backs off indefinitely, so the error
   reached neither `runAction` nor `isQuotaExhausted` — the request simply
   outlived the 25-second client ceiling and the user was told the network was
   at fault. Over REST the same condition surfaces in 293 ms as HTTP 429, which
   `isQuotaExhausted` already recognises. **`preferRest` now defaults to on**
   (`FIREBASE_PREFER_REST=false` opts out; the emulator forces gRPC, since the
   REST path cannot talk to it). This is the switch the previous round shipped
   as unverifiable — it is verified now, against the live project, including
   reads, `in` queries and batch commits.

`watchGone` takes an optional predicate, because the record it watches is no
longer necessarily deleted; promotion treats a changed `folderId` as gone.

**What the code cannot fix.** The quota itself. Until it resets at midnight
US/Pacific, or the project moves to Blaze pay-as-you-go, deletes will keep being
refused — the difference is that promotion now works anyway, and anything that
genuinely needs a delete says so in under a second instead of stalling.

- **Validation**: `typecheck` 0 errors, `test` 180/180, `build` compiles,
  `eslint src` at the 7 pre-existing errors. The transport and quota
  measurements above are live-project readings, not emulator ones.

### 2026-09-02 — Hierarchy, KYC, Pipeline Stage, profit distribution

Twenty-seven numbered requirements, delivered as one workflow rather than as
isolated features. What follows is what changed and, where a decision was
forced, why it went the way it did.

**1 · Lead source is now the exact origin.** `lib/leadSource.ts` renders
`Data Bank (Facile Town 2)`, `Meta Ads (Ramadan Offer)`, `Manual Entry` — the
kind plus the specific list it came out of. Read from fields denormalised onto
the lead at creation (`dataBankFolderName`, `campaignName`), never by joining
back to the folder: a folder can be renamed or deleted, and a lead's recorded
origin must not change when it is. On the list row, the detail pane, the phone
and the distribution queue.

**2–3 · KYC.** A tab beside Follow-ups on both surfaces, twelve fields, and one
write that does three things atomically: store the record, mirror
name/phone/email/city onto the lead, append an audit event. A partial version of
that — KYC saved but the list still showing the ad form's misspelling — is the
exact inconsistency the feature exists to remove, so it is a transaction.
Deal Entry pre-fills from it (`dealCustomerFromKyc`), and `closeDeal` falls back
to the KYC server-side for anything the form left blank, so the CNIC is typed
once and only once. Only the name is required: an incomplete KYC saved on the
first call is the normal case, and refusing it would push people back to not
filling it in at all.

**4–5 · Pipeline Status vs Pipeline Stage.** The formal state machine is now
called **Status** everywhere; **Stage** is the new commercial read that replaces
Hot/Cold: **Cold → P3 → P2 → P1**. Derived on read like the temperature it
replaces (`lib/pipelineStage.ts`), so every existing lead is classified the
moment this ships and no backfill exists to go stale — P1 is Negotiation, P2 is
Interested *or* a held meeting, Cold is ten follow-ups with the status never
reaching Interested, P3 is everything else being worked. A person can pin a
stage; a closed lead ignores its pin. `leadTemperature.ts` and
`TemperatureChrome.tsx` are deleted, and `readStageOverride` still resolves the
retired `HOT`/`COLD` values so old pins survive.

**A follow-up that records a meeting now sets `meetingHeld: true` on the lead**,
one-way. The stage rule asks a yes/no question and reading a counter to answer
it would mean every consumer repeating the same `> 0`; a meeting that happened
stays happened.

**6–11 · The Sub Admin role.** A third auth role (`lib/constants/hierarchy.ts`),
created from the same Add Employee form — the access level is a field on it, so
there is no second creation path to drift.

**The link is stored on the subordinate, never as a list on the manager.** An
employee carries `subAdminUid`; a Data Bank folder carries `subAdminUid`; leads
and closed deals carry a denormalised copy. That is not a style choice:
Firestore checks a *list* query against the rules **before** running it and can
only allow it when the query's own constraints prove every document it could
return is readable. A scope living in another document proves nothing. So every
sub admin query is `where('subAdminUid','==',me)` and every rule mirrors it
exactly — the same discipline that fixed the notification bell.

The hierarchy is **two levels deep on purpose**: a sub admin never reports to a
sub admin. A chain of them would turn "whose team is this" into a graph walk,
and that walk would have to run inside Security Rules, which cannot do it.

Moving somebody between teams re-stamps their leads and deals in paged batches
(`reassignTeamOwnership`) — deliberately not a transaction, because it can span
thousands of documents, and a half-finished run leaves some leads with the old
manager rather than corrupting anything. Re-running finishes the job.

Sub admin routes: `/subadmin/leads`, `/subadmin/team`, `/subadmin/earnings`,
and the admin's own Data Bank pages, which now accept both roles rather than
being copied.

**12–21 · Profit distribution.** Closing a deal writes
`distributionStatus: 'PENDING'` and notifies the admin; the notification carries
a **Finalize Profit Distribution** button straight to
`/admin/financials/distribution`. The screen splits net profit four ways —
employee, their sub admin, optionally a second sub admin, company base — with
every amount recomputed from the percentage **on the keystroke**.
`calculateDistribution` is called straight from the render body: the arithmetic
is four multiplications, and memoising it could show a stale rupee figure beside
a fresh percentage.

Over-allocation is **refused, not clamped** — shares totalling 105% cannot be
silently reduced to figures nobody chose, so the entered numbers survive and
Finalize stays disabled. The remainder is the company's (§20) and is reported as
its own line *and* inside the company total, because "the company got 4%" and
"the company kept the 91% nobody allocated" are different facts.

**22 · Financial privacy is the collection split, not a filter.** The complete
split lands in `dealDistributions` (**admin only**) and each recipient's own
number in `dealPayouts` (readable by that person, their sub admin, the admin).
Firestore grants a whole document or none of it, so a single document holding
all four lines could not satisfy §22 however carefully the UI was written. The
company's share is never written to `dealPayouts` at all.

**24 · Nothing is overwritten.** Re-finalising marks the previous distribution
and its payouts `current: false` with a `supersededAt` and writes a fresh set;
Reopen puts a deal back in the queue without destroying what was approved
before it.

**Deliberate omissions, each with a reason:**
- A sub admin's *team's* attendance is not exposed. Attendance documents carry
  the employee's uid but no team field, so a rule for it would need a lookup per
  day per employee; the admin, who owns the attendance policy, still sees
  everyone.
- `dataBankRecords` are scoped by a `get()` on their folder rather than by a
  denormalised field, because a folder can hold 40,000 rows and reassigning one
  must not mean 40,000 writes. Rules cache identical `get()`s within an
  evaluation and a page comes from one folder, so a page costs one extra lookup.
- The sub admin's team dossier is read-only: creating employees, setting
  priorities and moving people are the admin's decisions, the Server Actions
  refuse them for this role, and offering the buttons would only produce errors.

**Indexes:** twelve added. Equality fields are declared in **alphabetical**
order, then any range field, then the `orderBy` — the rule this project already
learned the hard way, when indexes declared in the query's own order were
created successfully and then never used.

- **Validation**: `typecheck` 0 errors, `test` **200/200** (221 → 200 after the
  21 temperature tests were replaced by 34 new ones across pipeline stage, KYC,
  lead source and the distribution arithmetic — including the owner's own
  worked example to the rupee, the over-allocation refusal and the
  remaining-never-negative invariant), `build` compiles with all new routes,
  `eslint src` back at the 7 pre-existing errors and 34 pre-existing warnings.

  **`npm run test:rules` was written but not run here** — 20 new assertions
  covering the sub admin scopes and the two payout collections — because this
  machine has neither Java nor the Firebase CLI, which the emulator needs. The
  file is syntax-checked. Run it before deploying, and **deploy the rules and
  indexes** (`npm run deploy:rules`): every sub admin screen depends on rules
  that are not live until then.

### 2026-09-02 — Corrections round: KYC fields, Remark, Manager, redesigns

Seven changes to what shipped this morning. Everything else stands.

**1 · KYC gained the commercial half, and nothing is required any more.**
Country, Project, Interest, Investment, Budget and Trust join the existing
twelve (Name, City, Phone were already there and were not duplicated). They are
free text on purpose: a fixed project list is wrong within a month, and budgets
are quoted in ranges and instalment plans as often as in a single figure.

`required` is gone from the field type entirely, so no surface can mark a field
mandatory. **An empty KYC is now a valid save** — a rep opens this mid-call and
fills in what they have, and requiring anything pushes people back to not
filling it in at all, which is the state the feature exists to end. Validation
now only objects to a malformed value in a field somebody actually typed in.
KYC → Lead and KYC → Deal synchronisation are untouched.

**2 · The first entry on a lead is a Remark; the rest are Follow-Ups.**
`lib/followUpKind.ts`, derived from position rather than stored: every lead that
already exists gets the right label immediately, with no backfill to run and no
second copy of a fact the ordering already encodes. The tab, the button, the
form heading, the save confirmation and each row's badge all follow it, on both
surfaces.

Nothing downstream changed — a Remark still increments `followUpCount`, still
counts toward the ten that turn a lead Cold, still counts as a Connect if the
call was long enough. It is the same act of contact; this is what the sales team
call it.

**3 · "Auto" is gone from the Pipeline Stage control, and the automation is
not.** Auto was never a stage — it is the *absence* of a manual pin — and
sitting in a row of four real stages it read as a fifth. The rule in
`lib/pipelineStage` keeps running underneath exactly as before: a lead still
goes Cold on its tenth fruitless follow-up, still lifts to P2 on a held meeting.
The way back to automatic is now to press the stage that is already lit, which
clears the pin; a pinned stage carries a dot so "a person decided this" stays
distinguishable from "the rule did".

**Also fixed here:** the phone's status select was still labelled "Pipeline
Stage" — the exact confusion the rename existed to remove.

**4 · A Manager is not an employee.** Separate `ManagerFormModal` (Add Manager),
reached from the Managers panel; the access-level dropdown is gone from Add
Employee, so that form makes employees and only employees. What the manager form
does *not* ask for is the point: no lane priority, no KPI targets, no
auto-assign, no job title. The server matches — a manager's document is written
without `targets`, with `autoAssign: false` and `autoPriority: false`, so they
never appear in the distribution lane or in a KPI ranking as a person with zero
connects.

Their team is assigned in the same submit, so a manager is never created in a
half state where they exist and manage nobody.

**Their lead view is read-only for lead work.** A manager reads the whole
history and moves leads between their own people, but the follow-up form and
the deal entry form are not offered to them — the server books both against the
*assigned employee*, so a manager logging a call would silently credit somebody
else's KPI.

**5 · A manager's analytics are their team's, summed.**
`lib/managerMetrics.ts` — `buildManagerMetrics` / `buildAllManagerMetrics`,
bucketed by `subAdminUid` in one pass. Derived, never stored: adding, removing
or reassigning an employee moves the manager's figures on the next render with
nothing to recalculate and no job to run. Conversion is team-wide (won ÷
handled) rather than an average of per-person rates, which would let a rep with
one lead and one win drag a ten-person team to 50%. The Managers panel now shows
team size, leads, deals won, revenue and conversion; the manager's own dashboard
and `/subadmin/team` were already aggregating.

Kept out of `metrics.ts` deliberately — that module imports `./dates`, and the
raw `--experimental-strip-types` test loader cannot resolve an extensionless
import.

**6 · Profit Distribution rebuilt** in the newer form language (gradient header,
sectioned cards on a soft ground, one column on a phone and two above it):
recipient rows with avatars, a live allocation bar, and a summary that stays
beside the inputs. **The arithmetic is untouched** — same
`lib/profitDistribution`, same server action, still recalculating on the
keystroke, still refusing over-allocation rather than clamping it, still showing
the remainder as its own line *and* inside the company total.

**7 · Closed Deals is the historical record.** A deal reaches it when its split
is finalised; before that it sits in the distribution queue. The two screens
divide by state, not by data — they read the same collection — and the filter
defaults to Settled with **Awaiting split and All one click away**, because a
closed-but-unsplit deal is real money and a screen that simply omitted it would
look like the record had lost something.

Opening a row gives the complete record, assembled rather than copied:
`ClosedDealRecord` reads the frozen facts from the deal (customer as captured at
the point of sale, amounts), the live ones from the lead it points at (KYC,
origin, assignment provenance, final status), the split from
`dealDistributions`, and the history from the lead's own follow-ups. A KYC
corrected next month therefore shows corrected here; a snapshot of all of it
would have been a second copy to drift. `useLeadById` is the new single-document
read behind that.

Reopen deliberately stays on the distribution page, beside the thing it undoes —
a button that rewrites history does not belong on the historical record.

- **Validation**: `typecheck` 0 errors, `test` **219/219** (200 → 219: 8 on the
  Remark rule including "exactly one entry in any list is the Remark", 6 on
  manager aggregation including the conversion-rate trap and reassignment, and
  5 more on the KYC changes — an empty save, the new fields, no field marked
  required, no duplicate keys, every field placed in exactly one section),
  `build` compiles, `eslint src` unchanged at the 7 pre-existing errors and 34
  pre-existing warnings. The four changed routes were smoke-tested against the
  running dev server (200 each); the screens themselves were not driven in a
  browser — no automation is available in this session.
