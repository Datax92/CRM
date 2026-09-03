import { NextResponse } from 'next/server';
import { sweepAbsentees } from '@/app/actions/attendance';
import { readPolicy } from '@/app/actions/attendance';
import { pastAbsentCutoff } from '@/lib/attendancePolicy';
import { WEEKLY_OFF_DAY } from '@/lib/attendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Marks everyone who has not checked in by the configured cutoff as absent (§4).
 *
 * Scheduled a little after the cutoff rather than exactly on it, and it
 * **re-checks the clock itself** before doing anything: the cutoff is a
 * setting an admin can move, and a schedule fixed at noon would keep marking
 * people absent at noon after HR changed it to 1pm.
 *
 * Idempotent. The sweep skips any day that already has a record, so a retry, a
 * duplicate schedule or a manual run marks nobody twice — which is also §4's
 * "attendance records must never be duplicated for the same employee/date".
 *
 * Sunday is skipped: nobody was expected, so nobody is absent.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error('[cron:mark-absentees] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json({ ok: false, error: 'Scheduler is not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const now = new Date();

    // The weekly off, read in Karachi rather than from the server's own clock.
    const weekday = new Date(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi' }).format(now)
    ).getDay();
    if (weekday === WEEKLY_OFF_DAY) {
      return NextResponse.json({ ok: true, skipped: 'weekly-off' });
    }

    const policy = await readPolicy();
    if (!pastAbsentCutoff(now, policy)) {
      // Scheduled early, or the cutoff was moved later. Doing nothing is the
      // correct outcome — the next run will catch it.
      return NextResponse.json({ ok: true, skipped: 'before-cutoff', cutoff: policy.absentCutoff });
    }

    const result = await sweepAbsentees();

    return NextResponse.json({
      ok: true,
      ...result,
      cutoff: policy.absentCutoff,
      tookMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[cron:mark-absentees] failed after', Date.now() - startedAt, 'ms', error);
    return NextResponse.json({ ok: false, error: 'Sweep failed.' }, { status: 500 });
  }
}
