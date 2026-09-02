```
CRM/
├── .claude/
│   └── settings.local.json
├── docs/
│   ├── deployment-runbook.md
│   ├── implementation-notes.md
│   └── integrations/
│       └── whatsapp-placeholder.md
├── public/
│   ├── file.svg
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
├── scripts/
│   ├── check-auth.mts
│   ├── purge-demo-data.mts
│   ├── seed-demo.mts
│   └── set-admin-role.mts
├── src/
│   ├── app/
│   │   ├── actions/
│   │   │   ├── closedDeals.ts
│   │   │   ├── config.ts
│   │   │   ├── employees.ts
│   │   │   ├── expenses.ts
│   │   │   ├── followUps.ts
│   │   │   ├── leads.ts
│   │   │   ├── notifications.ts
│   │   │   └── whatsapp.ts
│   │   ├── admin/
│   │   │   ├── employees/
│   │   │   │   ├── directory/page.tsx
│   │   │   │   └── priority/page.tsx
│   │   │   ├── financials/
│   │   │   │   ├── deals/page.tsx
│   │   │   │   ├── expenses/page.tsx
│   │   │   │   └── reports/page.tsx
│   │   │   ├── leads/
│   │   │   │   ├── all/page.tsx
│   │   │   │   └── pending/page.tsx
│   │   │   ├── page.tsx
│   │   │   └── SelectPill.tsx
│   │   ├── home/
│   │   │   └── page.tsx
│   │   ├── api/
│   │   │   ├── cron/
│   │   │   │   └── process-deadlines/
│   │   │   │       └── route.ts
│   │   │   └── webhooks/
│   │   │       └── meta/
│   │   │           └── route.ts
│   │   ├── employee/
│   │   │   ├── performance/
│   │   │   │   └── stats/page.tsx
│   │   │   ├── workspace/
│   │   │   │   ├── leads/page.tsx
│   │   │   │   └── pending/page.tsx
│   │   │   └── page.tsx
│   │   ├── favicon.ico
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── admin/
│   │   │   ├── AdminShared.tsx
│   │   │   └── AssignModal.tsx
│   │   ├── ui/
│   │   │   ├── AdminTable.tsx
│   │   │   └── Modal.tsx
│   │   ├── DemoBanner.tsx
│   │   ├── GlobalLayout.tsx
│   │   ├── LeadCard.tsx
│   │   ├── LeadDetailModal.tsx
│   │   └── NotificationsPanel.tsx
│   ├── context/
│   │   └── AuthContext.tsx
│   ├── hooks/
│   │   ├── useEmployees.ts
│   │   ├── useFinancials.ts
│   │   ├── useLeads.ts
│   │   └── useProtectedRoute.ts
│   └── lib/
│       ├── demo/
│       │   └── store.ts
│       ├── firebase/
│       │   ├── client.ts
│       │   ├── config.ts
│       │   ├── server.ts
│       │   └── serverAuth.ts
│       ├── actionResult.ts
│       ├── clientActions.ts
│       ├── dates.ts
│       ├── distribution.test.ts
│       ├── distribution.ts
│       ├── leadStatus.ts
│       ├── meta.ts
│       ├── metrics.ts
│       ├── money.test.ts
│       ├── money.ts
│       └── phone.ts
├── .env.example
├── .env.local
├── .firebaserc
├── .gitignore
├── architecture.md
├── CLAUDE.md
├── CRM System.pdf
├── eslint.config.mjs
├── files.md
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
├── next.config.ts
├── next-env.d.ts
├── package.json
├── package-lock.json
├── postcss.config.mjs
├── PRD.md
├── README.md
├── storage.rules
├── tsconfig.json
└── vercel.json
```
