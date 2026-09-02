import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp, type Lead } from './useLeads';
import { withinRange, type DateRange, type RangeKey, resolveRange } from '@/lib/dates';
import { IS_DEMO, useDemoState } from '@/lib/demo/store';
import type { DealRecord } from './useFinancials';

export interface CampaignRecord {
  id: string;
  name: string;
  externalId?: string | null;
  platform: string;
  category?: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED';
  startDate?: FirestoreTimestamp | null;
  endDate?: FirestoreTimestamp | null;
  budget?: number;
  description?: string | null;
  notes?: string | null;
  historicalLeadsCount?: number;
  historicalRevenue?: number;
  addedByUid?: string;
  addedByEmail?: string | null;
  createdAt?: FirestoreTimestamp;
}

export interface CampaignSummary {
  id: string;
  name: string;
  externalId: string | null;
  platform: string;
  category: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED';
  startDate: FirestoreTimestamp | null;
  endDate: FirestoreTimestamp | null;
  budget: number;
  description: string | null;
  notes: string | null;
  createdAt: FirestoreTimestamp | null;
  
  // Computed metrics (period-scoped)
  leadsCount: number;
  activeLeads: number;
  closedWon: number;
  closedLost: number;
  otherStatusCount: number;
  revenue: number;
  payable: number;
  profit: number;
  conversionRate: number;
  valuePerLead: number;
  
  // Historical additions
  historicalLeadsCount: number;
  historicalRevenue: number;

  // Attributed leads list
  leads: Lead[];
}

export function useCampaigns(
  leads: Lead[] = [],
  deals: DealRecord[] = [],
  rangeKey: RangeKey = 'ALL',
  enabled = true
) {
  const [records, setRecords] = useState<CampaignRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useDemoState();
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  useEffect(() => {
    if (IS_DEMO || !enabled) {
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, 'campaigns'), orderBy('createdAt', 'desc'), limit(500)),
      (snap) => {
        setRecords(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })) as CampaignRecord[]
        );
      },
      (err) => {
        console.error('[useCampaigns]', err);
        setRecords([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => unsub();
  }, [enabled]);

  const rawCampaigns: CampaignRecord[] = useMemo(() => {
    if (!enabled) return [];
    if (IS_DEMO) {
      return demoState.campaigns || [];
    }
    return records ?? [];
  }, [enabled, records, demoState.campaigns]);

  // Combine campaigns from the explicit collection with any campaigns discovered in the leads pool
  const allCampaigns = useMemo(() => {
    const map = new Map<string, CampaignRecord>();

    // 1. Add explicitly registered campaigns
    for (const c of rawCampaigns) {
      map.set(c.id, c);
      if (c.externalId) {
        map.set(c.externalId, c);
      }
    }

    // 2. Discover running campaigns from leads
    for (const lead of leads) {
      if (lead.campaignId && !map.has(lead.campaignId)) {
        const discovered: CampaignRecord = {
          id: lead.campaignId,
          name: lead.campaignName || `Campaign ${lead.campaignId}`,
          externalId: lead.campaignId,
          platform: lead.source === 'META_ADS' ? 'Meta Ads' : 'Manual / Other',
          category: 'Digital Ads',
          status: 'ACTIVE',
          startDate: lead.createdAt || null,
          endDate: null,
          budget: 0,
          description: `Auto-discovered running campaign (${lead.source || 'Meta Ads'})`,
          historicalLeadsCount: 0,
          historicalRevenue: 0,
        };
        map.set(lead.campaignId, discovered);
      }
    }

    // Return unique items
    const unique = new Set<CampaignRecord>();
    for (const item of map.values()) {
      unique.add(item);
    }
    return Array.from(unique);
  }, [rawCampaigns, leads]);

  // Compute period-scoped summaries
  const campaignSummaries: CampaignSummary[] = useMemo(() => {
    const leadsInRange = leads.filter((l) => withinRange(l.createdAt, range));

    return allCampaigns.map((camp) => {
      // Find leads attributed to this campaign (by id or externalId or name match)
      const matchedLeads = leadsInRange.filter(
        (l) =>
          l.campaignId === camp.id ||
          (camp.externalId && l.campaignId === camp.externalId) ||
          (l.campaignName && l.campaignName.toLowerCase() === camp.name.toLowerCase())
      );

      const matchedDeals = deals.filter(
        (d) =>
          d.campaignId === camp.id ||
          (camp.externalId && d.campaignId === camp.externalId) ||
          (d.campaignName && d.campaignName.toLowerCase() === camp.name.toLowerCase()) ||
          matchedLeads.some((l) => l.id === d.leadId)
      );

      const closedWon = matchedLeads.filter((l) => l.status === 'CLOSED_WON').length;
      const closedLost = matchedLeads.filter((l) => l.status === 'CLOSED_LOST' || l.status === 'NOT_INTERESTED').length;
      const activeLeads = matchedLeads.filter(
        (l) => !['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED', 'NEW'].includes(l.status)
      ).length;
      const otherStatusCount = matchedLeads.length - closedWon - closedLost;

      const liveRevenue = matchedDeals.reduce((sum, d) => sum + (Number(d.amountReceived) || 0), 0);
      const livePayable = matchedDeals.reduce((sum, d) => sum + (Number(d.payableAmount) || 0), 0);
      const liveProfit = matchedDeals.reduce((sum, d) => sum + (Number(d.profit) || 0), 0);

      const totalLeads = matchedLeads.length + (rangeKey === 'ALL' ? (camp.historicalLeadsCount || 0) : 0);
      const totalRevenue = liveRevenue + (rangeKey === 'ALL' ? (camp.historicalRevenue || 0) : 0);
      const totalProfit = liveProfit + (rangeKey === 'ALL' ? (camp.historicalRevenue || 0) : 0);

      const conversionRate = totalLeads > 0 ? (closedWon / totalLeads) * 100 : 0;
      const valuePerLead = totalLeads > 0 ? totalRevenue / totalLeads : 0;

      return {
        id: camp.id,
        name: camp.name,
        externalId: camp.externalId ?? null,
        platform: camp.platform || 'Meta Ads',
        category: camp.category ?? null,
        status: camp.status || 'COMPLETED',
        startDate: camp.startDate ?? null,
        endDate: camp.endDate ?? null,
        budget: camp.budget || 0,
        description: camp.description ?? null,
        notes: camp.notes ?? null,
        createdAt: camp.createdAt ?? null,
        leadsCount: totalLeads,
        activeLeads,
        closedWon,
        closedLost,
        otherStatusCount,
        revenue: totalRevenue,
        payable: livePayable,
        profit: totalProfit,
        conversionRate,
        valuePerLead,
        historicalLeadsCount: camp.historicalLeadsCount || 0,
        historicalRevenue: camp.historicalRevenue || 0,
        leads: matchedLeads,
      };
    });
  }, [allCampaigns, leads, deals, range, rangeKey]);

  return {
    campaigns: campaignSummaries,
    rawCampaigns,
    loading: IS_DEMO ? false : enabled && records === null,
    error: IS_DEMO ? null : enabled ? error : null,
  };
}
