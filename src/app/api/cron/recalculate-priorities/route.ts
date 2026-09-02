import { NextResponse } from 'next/server';
import { recalculatePriorities } from '@/lib/server/recalcPriorities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly re-ranking of the lead-distribution lane from KPI performance.
 *
 * Kept separate from `process-deadlines` because the two have nothing in
 * common but a scheduler: that sweep runs against SLA windows measured in
 * minutes, this one against a month of performance. Folding them together
 * would mean a failure in either taking the other down with it.
 *
 * Runs the same `recalculatePriorities` the admin's button calls, so a manual
 * run and a scheduled one cannot produce different lanes. Idempotent — when
 * the order has not changed it writes only scores and timestamps.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[cron:recalculate-priorities] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json({ ok: false, error: 'Scheduler is not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await recalculatePriorities('system:cron');

    return NextResponse.json({
      ok: true,
      monthKey: result.monthKey,
      evaluated: result.evaluated,
      moved: result.changes.length,
      changes: result.changes,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[cron:recalculate-priorities]', error);
    return NextResponse.json({ ok: false, error: 'Recalculation failed' }, { status: 500 });
  }
}
