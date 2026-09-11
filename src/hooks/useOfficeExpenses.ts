import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError } from './useLeads';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import {
  normalizeExpenseStatus,
  normalizePaymentStatus,
  readHistoryEntry,
  type OfficeExpense,
} from '@/lib/officeExpenses';

/**
 * The office expense ledger, live.
 *
 * A listener rather than a fetch: expenses are approved and rejected while
 * somebody is looking at the dashboard, and a pending count that only moved on
 * refresh would be the one number on the screen people stopped trusting.
 *
 * **Scoped, and the scope is not an optimisation.** The admin reads every
 * expense; an HR manager reads only the ones they recorded. Firestore checks a
 * *list* query against the rules **before** it runs, so an HR manager's query
 * has to carry `where('addedByUid','==',uid)` — without it the query is refused
 * outright rather than trimmed, and the screen renders with nothing in it,
 * which is this project's most-repeated symptom. The rule mirrors that clause
 * exactly.
 *
 * Employees and Sales managers are refused the whole query either way.
 */
export function useOfficeExpenses(
  enabled = true,
  /** An HR manager's own uid. Absent means the admin's unscoped read. */
  mineOnly?: string | null
) {
  const [state, setState] = useState<{ expenses: OfficeExpense[]; error: string | null } | null>(
    null
  );
  const demoState = useDemoState();

  useEffect(() => {
    if (IS_DEMO || !enabled) return;

    const unsubscribe = onSnapshot(
      mineOnly
        ? query(
            collection(db, 'expenses'),
            where('addedByUid', '==', mineOnly),
            orderBy('dayKey', 'desc'),
            limit(1000)
          )
        : query(collection(db, 'expenses'), orderBy('dayKey', 'desc'), limit(1000)),
      (snap) => {
        setState({
          expenses: snap.docs.map((doc) => mapExpense(doc.id, doc.data())),
          error: null,
        });
      },
      (err) => {
        console.error('[useOfficeExpenses]', err);
        setState({ expenses: [], error: describeFirestoreError(err) });
      }
    );

    return () => unsubscribe();
  }, [enabled, mineOnly]);

  const demoExpenses = useMemo(
    () => (demoState.expenses ?? []).map((row) => mapExpense(row.id, row as unknown as Record<string, unknown>)),
    [demoState.expenses]
  );

  if (IS_DEMO) {
    return { expenses: enabled ? demoExpenses : [], loading: false, error: null };
  }

  return {
    expenses: state?.expenses ?? [],
    loading: enabled && state === null,
    error: state?.error ?? null,
  };
}

/**
 * One stored document, made legible.
 *
 * A record written before this module has no `dayKey`, so it is derived from
 * the `date` timestamp it does have. Falling back to today instead would file
 * last year's rent under this month and quietly corrupt every trend on the
 * screen.
 */
function mapExpense(id: string, raw: Record<string, unknown>): OfficeExpense {
  const stamp = raw.date as { toDate?: () => Date } | undefined;
  const dayKey =
    typeof raw.dayKey === 'string' && raw.dayKey.length === 10
      ? raw.dayKey
      : karachiKeyOf(stamp?.toDate?.());

  return {
    id,
    title: String(raw.title ?? 'Untitled'),
    category: String(raw.category ?? 'Other'),
    amount: Number(raw.amount ?? 0),
    description: (raw.description as string) ?? null,
    status: normalizeExpenseStatus(raw.status),
    paidBy: (raw.paidBy as string) ?? null,
    paymentMethod: (raw.paymentMethod as string) ?? null,
    receiptUrl: (raw.receiptUrl as string) ?? null,
    receiptName: (raw.receiptName as string) ?? null,
    addedByUid: String(raw.addedByUid ?? ''),
    addedByEmail: (raw.addedByEmail as string) ?? null,
    dayKey,
    decidedByUid: (raw.decidedByUid as string) ?? null,
    decidedByName: (raw.decidedByName as string) ?? null,
    decisionNote: (raw.decisionNote as string) ?? null,
    // **These two were typed and never read**, which is this project's most
    // repeated bug and was the whole of "paying it does not cut the amount":
    // `payFromAccounts` wrote both correctly every time, and the screen was
    // handed a hard 0. So the button never left "Pay from…", the split panel
    // offered the full amount again after a part payment, and the only thing
    // that stopped a second full payment was the server's own guard — which
    // reads the stored figure, and refused. Check the mapper, not just the type.
    paidAmount: typeof raw.paidAmount === 'number' ? raw.paidAmount : 0,
    paymentStatus: normalizePaymentStatus(raw.paymentStatus),
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

/** `YYYY-MM-DD` in Karachi, the only timezone this business runs in. */
function karachiKeyOf(date: Date | undefined): string {
  const value = date ?? new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
