'use client';

/**
 * Mahziyar Group's figures for a year, month by month — the one computation
 * both group screens read.
 *
 * Group Expense shows one of these months; Group Income shows all twelve.
 * Because both call `computeGroupMonth` over the same live inputs, a month's
 * "made / spent / remaining" cannot read differently on the two screens.
 *
 * Inputs: the ledger (income, and spending straight out of an account), closed
 * deals (deal profit), office and personal expenses (spending), the sheet's
 * fields, and the year's month documents (lines added by hand, edits,
 * closings). Every one is a shared live listener the Accounts screens already
 * hold, so opening the sheet costs no second read of anything.
 */

import { useMemo } from 'react';
import { useLedger } from './useLedger';
import { useOfficeExpenses } from './useOfficeExpenses';
import { usePersonalExpenses } from './useLedger';
import { useGroupConfig, useGroupMonths } from './useAccountSheets';
import { useFinancials } from './useFinancials';
import { karachiDayKey, resolveRange, timestampMillis } from '@/lib/dates';
import { readPayoutSource } from '@/lib/dealAmounts';
import {
  computeGroupMonth,
  displayedTotals,
  monthsOfYear,
  type GroupMonthDoc,
  readDealRow,
  type DealRowInput,
  type GroupMonthFigures,
  type LedgerRowInput,
} from '@/lib/groupFinance';

const ALL_TIME = resolveRange('ALL');

/** The day a deal is dated: its deal date, else when it was entered. */
function dealDayKey(raw: Record<string, unknown>): string | null {
  const at = timestampMillis(raw.dealDate) ?? timestampMillis(raw.enteredAt);
  return at === null ? null : karachiDayKey(new Date(at));
}

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
  const { allDeals, loading: dealsLoading } = useFinancials(ALL_TIME, enabled);

  const accountNames = useMemo(
    () => new Map(ledger.accounts.map((account) => [account.id, account.name])),
    [ledger.accounts]
  );
  const accountKinds = useMemo(
    () => new Map(ledger.accounts.map((account) => [account.id, String(account.kind ?? '')])),
    [ledger.accounts]
  );
  const officeRows = useMemo(
    () =>
      office.map((expense) => ({
        id: expense.id, dayKey: expense.dayKey, amount: expense.amount, status: expense.status,
        label: expense.title, category: expense.category,
      })),
    [office]
  );
  const dealRows = useMemo(
    () => allDeals.map((deal) => {
        const raw = deal as unknown as Record<string, unknown>;
        return readDealRow(raw, dealDayKey(raw), readPayoutSource(deal));
      }).filter((row): row is DealRowInput => row !== null),
    [allDeals]
  );
  const personalRows = useMemo(
    () =>
      personal.map((raw) => ({
        id: String(raw.id ?? ''),
        dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
        amount: Number(raw.amount) || 0,
        label: typeof raw.title === 'string' ? raw.title : null,
        category: typeof raw.category === 'string' ? raw.category : null,
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
          accountKinds,
          officeExpenses: officeRows,
          personalExpenses: personalRows,
          deals: dealRows,
          month: doc,
          fields: config.fields,
          labels: config.labels,
        });
        return { monthKey, figures, doc, shown: displayedTotals(figures, doc) };
      }),
    [year, docs, ledger.transactions, accountNames, accountKinds, officeRows, personalRows, dealRows, config.fields, config.labels]
  );

  return {
    months,
    fields: config.fields,
    labels: config.labels,
    office,
    personal,
    accounts: ledger.accounts,
    loading: enabled && (ledger.loading || officeLoading || personalLoading || monthsLoading || config.loading || dealsLoading),
    error: ledger.error ?? config.error ?? null,
  };
}
