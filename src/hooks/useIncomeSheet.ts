import { useMemo } from 'react';
import { useFinancials } from './useFinancials';
import { usePersonalExpenses, useCommitteeRecords, useInvestments, useCapitalInvestments } from './useAccounts';
import { useReceivables } from './useReceivables';
import { type DateRange } from '@/lib/dates';
import { type FirestoreTimestamp } from './useLeads';

export type LedgerType = 'OFFICE_EXPENSE' | 'PERSONAL_EXPENSE' | 'INCOME' | 'COMMITTEE' | 'INVESTMENT' | 'CAPITAL_INVESTMENT' | 'RECEIVABLE';

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  title: string;
  amount: number;
  date: FirestoreTimestamp | undefined;
  addedByUid: string;
}

export function useIncomeSheet(range: DateRange, enabled = true) {
  const { deals, expenses, loading: finLoading, error: finError } = useFinancials(range, enabled);
  const { records: personalExpenses, loading: peLoading, error: peError } = usePersonalExpenses(range, enabled);
  const { records: committeeRecords, loading: comLoading, error: comError } = useCommitteeRecords(range, enabled);
  const { records: investments, loading: invLoading, error: invError } = useInvestments(range, enabled);
  const { records: capitalInvestments, loading: capLoading, error: capError } = useCapitalInvestments(range, enabled);
  const { receivables, loading: recLoading, error: recError } = useReceivables(range, enabled);

  const ledger = useMemo(() => {
    const entries: LedgerEntry[] = [];

    if (expenses) {
      expenses.forEach(exp => {
        entries.push({
          id: `exp_${exp.id}`,
          type: 'OFFICE_EXPENSE',
          title: exp.title,
          amount: exp.amount,
          date: exp.date,
          addedByUid: exp.addedByUid,
        });
      });
    }

    if (personalExpenses) {
      personalExpenses.forEach(pe => {
        entries.push({
          id: `pe_${pe.id}`,
          type: 'PERSONAL_EXPENSE',
          title: pe.title,
          amount: pe.amount,
          date: pe.date,
          addedByUid: pe.addedByUid,
        });
      });
    }

    if (deals) {
      deals.forEach(deal => {
        entries.push({
          id: `deal_${deal.id}`,
          type: 'INCOME',
          title: deal.customer?.name ? `Deal: ${deal.customer.name}` : 'Closed Deal',
          amount: deal.amountReceived,
          date: deal.dealDate ?? deal.enteredAt,
          addedByUid: deal.userId,
        });
      });
    }

    if (committeeRecords) {
      committeeRecords.forEach(rec => {
        entries.push({
          id: `com_${rec.id}`,
          type: 'COMMITTEE',
          title: rec.title,
          amount: rec.amount,
          date: rec.date,
          addedByUid: rec.addedByUid,
        });
      });
    }

    if (investments) {
      investments.forEach(rec => {
        entries.push({
          id: `inv_${rec.id}`,
          type: 'INVESTMENT',
          title: rec.title,
          amount: rec.amount,
          date: rec.date,
          addedByUid: rec.addedByUid,
        });
      });
    }

    if (capitalInvestments) {
      capitalInvestments.forEach(rec => {
        entries.push({
          id: `cap_${rec.id}`,
          type: 'CAPITAL_INVESTMENT',
          title: rec.title,
          amount: rec.amount,
          date: rec.date,
          addedByUid: rec.addedByUid,
        });
      });
    }

    if (receivables) {
      receivables.forEach(rec => {
        entries.push({
          id: `rec_${rec.id}`,
          type: 'RECEIVABLE',
          title: rec.title,
          amount: rec.amount,
          date: rec.date,
          addedByUid: rec.addedByUid,
        });
      });
    }

    // Sort descending by date (newest first)
    entries.sort((a, b) => {
      const dateA = a.date?.toMillis?.() ?? 0;
      const dateB = b.date?.toMillis?.() ?? 0;
      return dateB - dateA;
    });

    return entries;
  }, [expenses, personalExpenses, deals, committeeRecords, investments, capitalInvestments, receivables]);

  const totals = useMemo(() => {
    let totalRevenue = 0;
    let totalOfficeExpenses = 0;
    let totalPersonalExpenses = 0;
    let totalCommittee = 0;
    let totalInvestments = 0;
    let totalCapitalInvestments = 0;
    let totalReceivables = 0;

    ledger.forEach(entry => {
      if (entry.type === 'INCOME') totalRevenue += entry.amount;
      else if (entry.type === 'RECEIVABLE') totalReceivables += entry.amount;
      else if (entry.type === 'OFFICE_EXPENSE') totalOfficeExpenses += entry.amount;
      else if (entry.type === 'PERSONAL_EXPENSE') totalPersonalExpenses += entry.amount;
      else if (entry.type === 'COMMITTEE') totalCommittee += entry.amount;
      else if (entry.type === 'INVESTMENT') totalInvestments += entry.amount;
      else if (entry.type === 'CAPITAL_INVESTMENT') totalCapitalInvestments += entry.amount;
    });

    const totalIncome = totalRevenue + totalReceivables;
    const totalExpenses = totalOfficeExpenses + totalPersonalExpenses + totalCommittee + totalInvestments + totalCapitalInvestments;

    return {
      totalRevenue,
      totalOfficeExpenses,
      totalPersonalExpenses,
      totalCommittee,
      totalInvestments,
      totalCapitalInvestments,
      totalReceivables,
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses
    };
  }, [ledger]);

  return {
    ledger,
    totals,
    loading: finLoading || peLoading || comLoading || invLoading || capLoading || recLoading,
    error: finError || peError || comError || invError || capError || recError
  };
}
