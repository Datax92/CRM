'use client';

/**
 * Mahziyar Group's figures for a year, month by month — the one computation
 * both group screens read.
 *
 * Group Expense shows one of these months; Group Income shows all twelve.
 * Because both call `computeGroupMonth` over the same live inputs, a month's
 * "made / spent / remaining" cannot read differently on the two screens.
 *
 * Inputs: the ledger (income), office and personal expenses (spending), the
 * sheet's fields, and the year's month documents (lines added by hand, edits,
 * closings). Every one is a shared live listener the Accounts screens already
 * hold, so opening the sheet costs no second read of anything.
 */

import { useMemo } from 'react';
import { useLedger } from './useLedger';
import { useOfficeExpenses } from './useOfficeExpenses';
import { usePersonalExpenses } from './useLedger';
import { useGroupConfig, useGroupMonths } from './useAccountSheets';
import {
  computeGroupMonth,
  displayedTotals,
  monthsOfYear,
  type GroupMonthDoc,
  type GroupMonthFigures,
  type LedgerRowInput,
} from '@/lib/groupFinance';

export interface GroupMonthView {
  monthKey: string;
  figures: GroupMonthFigures;
  doc: (GroupMonthDoc & { history: Array<Record<string, unknown>> }) | null;
  shown: ReturnType<typeof displayedTotals>;
}

export function useGroupFigures(year: number, enabled: boolean) {
  const ledger = useLedger(enabled);
  const { expenses: office, loading: officeLoading } = useOfficeExpenses(enabled, null);
  const { records: personal, loading: personalLoading } = usePersonalExpenses(enabled);
  const config = useGroupConfig(enabled);
  const { months: docs, loading: monthsLoading } = useGroupMonths(year, enabled);

  const accountNames = useMemo(
    () => new Map(ledger.accounts.map((account) => [account.id, account.name])),
    [ledger.accounts]
  );
  const officeRows = useMemo(
    () => office.map((expense) => ({ id: expense.id, dayKey: expense.dayKey, amount: expense.amount, status: expense.status })),
    [office]
  );
  const personalRows = useMemo(
    () =>
      personal.map((raw) => ({
        id: String(raw.id ?? ''),
        dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
        amount: Number(raw.amount) || 0,
      })),
    [personal]
  );

  const months = useMemo<GroupMonthView[]>(
    () =>
      monthsOfYear(year).map((monthKey) => {
        const doc = docs.get(monthKey) ?? null;
        const figures = computeGroupMonth({
          monthKey,
          transactions: ledger.transactions as unknown as LedgerRowInput[],
          accountNames,
          officeExpenses: officeRows,
          personalExpenses: personalRows,
          month: doc,
          fields: config.fields,
          labels: config.labels,
        });
        return { monthKey, figures, doc, shown: displayedTotals(figures, doc) };
      }),
    [year, docs, ledger.transactions, accountNames, officeRows, personalRows, config.fields, config.labels]
  );

  return {
    months,
    fields: config.fields,
    labels: config.labels,
    office,
    personal,
    accounts: ledger.accounts,
    loading: enabled && (ledger.loading || officeLoading || personalLoading || monthsLoading || config.loading),
    error: ledger.error ?? config.error ?? null,
  };
}
