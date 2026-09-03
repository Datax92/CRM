'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { describeFirestoreError, type FirestoreTimestamp } from './useLeads';
import { IS_DEMO, useDemoState, demo } from '@/lib/demo/store';
import { karachiDayKey, karachiMonthKey } from '@/lib/dates';
import { punchAttendance } from '@/lib/clientActions';
import { withTimeout, ActionTimeout } from '@/lib/withTimeout';
import type { PunchKind } from '@/app/actions/attendance';
import {
  attendanceRate,
  deriveStatus,
  formatClock,
  NETWORK_LABELS,
  WEEKLY_OFF_DAY,
  workedMinutes,
  type AttendanceNetwork,
  type AttendanceStatus,
} from '@/lib/attendance';

/** One side of a correction — what the day said before, and after. */
export interface AttendanceAdjustmentSide {
  status?: AttendanceStatus | null;
  late?: boolean;
  checkIn?: string | null;
  checkOut?: string | null;
}

export interface AttendanceRecord {
  id: string;
  uid: string;
  dayKey: string;
  monthKey?: string;
  firstActionAt?: FirestoreTimestamp;
  lastActionAt?: FirestoreTimestamp;
  workedMinutes?: number;
  /** Set once the employee has pressed Check Out for that day. */
  checkedOut?: boolean;
  network?: AttendanceNetwork;
  lastIp?: string | null;
  overrideStatus?: AttendanceStatus;
  overrideNote?: string | null;
  /** Whether the check-in that opened the day was after the allowed time (§5). */
  late?: boolean;
  lateByMinutes?: number;
  /** The threshold as it stood at the punch, so a later policy cannot re-judge it. */
  lateAfter?: string;
  /** The address the day was opened from (§2), kept beside the last one. */
  checkInIp?: string | null;
  /** Set when an approved leave wrote this day (§7). */
  leaveType?: 'CASUAL' | 'MEDICAL';
  leaveRequestId?: string | null;
  /** `SYSTEM` when the absence sweep wrote it, rather than a person (§4). */
  markedAbsentBy?: string | null;
  absenceCutoff?: string;
  /**
   * A correction, stored **beside** the observed times rather than over them
   * (§11) — `HH:MM` in Karachi. Absent means nobody has corrected the day.
   */
  adjustedCheckIn?: string | null;
  adjustedCheckOut?: string | null;
  /** Who corrected this day, when, and what changed (§11). */
  adjustments?: Array<{
    at?: FirestoreTimestamp;
    byUid: string;
    byName?: string | null;
    from?: AttendanceAdjustmentSide;
    to?: AttendanceAdjustmentSide;
    note?: string | null;
  }>;
  adjustedAt?: FirestoreTimestamp;
  adjustedByUid?: string | null;
}

export interface AttendanceDay {
  day: number;
  dayKey: string;
  status: AttendanceStatus;
  network: AttendanceNetwork;
  minutes: number;
  firstAt: Date | null;
  lastAt: Date | null;
  isFuture: boolean;
  /**
   * The stored row, so clicking a date can show everything §3 asks for — the
   * IP, the late margin, the leave type, who adjusted it — without a second
   * read. Null on a day nothing was written for.
   */
  record: AttendanceRecord | null;
}

function toDate(value: FirestoreTimestamp | undefined): Date | null {
  const date = value?.toDate?.();
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Days in the given `YYYY-MM`, with the weekday each falls on.
 *
 * No timezone conversion: a calendar date's weekday is a property of the date
 * itself, so 2026-08-24 is a Monday everywhere. Reading it off a UTC date is
 * exact, and avoids the off-by-one a naive local-time construction would give.
 */
function monthDays(monthKey: string): { day: number; dayKey: string; weekday: number }[] {
  const [year, month] = monthKey.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    return {
      day,
      dayKey: `${monthKey}-${String(day).padStart(2, '0')}`,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    };
  });
}

/**
 * One employee's attendance for a month, plus their own Check In / Check Out.
 *
 * Attendance used to be *observed*: a heartbeat fired while the app was open
 * and the day's span was whatever it saw. That is gone at the owner's request —
 * the employee now presses Check In and Check Out, so the times are declared.
 * What the app still decides for itself is **where** the punch came from: the
 * server classifies the request's own IP, which a browser cannot forge.
 */
export function useAttendance(uid: string | undefined, getIdToken: () => Promise<string>, monthKey?: string) {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [punching, setPunching] = useState(false);
  const demoState = useDemoState();
  const month = monthKey ?? karachiMonthKey();

  /**
   * Check In / Check Out. Resolves to a message for the caller to show —
   * this hook has no opinion about where that is rendered.
   */
  const punch = useCallback(
    async (kind: PunchKind): Promise<{ ok: boolean; message: string }> => {
      if (!uid) return { ok: false, message: 'Not signed in.' };
      setPunching(true);
      try {
        const res = IS_DEMO
          ? demo.punchAttendance(uid, kind)
          : await withTimeout(punchAttendance(await getIdToken(), kind));

        if (!res.ok) return { ok: false, message: res.error };

        const where = NETWORK_LABELS[res.data.network as AttendanceNetwork];
        if (res.data.alreadyDone) {
          return {
            ok: true,
            message:
              kind === 'IN'
                ? 'You were already checked in today — the earlier time stands.'
                : 'You were already checked out today — the later time stands.',
          };
        }
        return {
          ok: true,
          message:
            kind === 'IN'
              ? `Checked in at ${formatClock(new Date(res.data.firstActionAt))} · ${where}`
              : `Checked out at ${formatClock(new Date(res.data.lastActionAt))} · ${where}`,
        };
      } catch (err) {
        return {
          ok: false,
          message:
            err instanceof ActionTimeout
              ? err.message
              : 'Could not reach the server. Nothing was recorded.',
        };
      } finally {
        setPunching(false);
      }
    },
    [uid, getIdToken]
  );

  useEffect(() => {
    if (IS_DEMO || !uid) return;

    const unsubscribe = onSnapshot(
      // Scoped by uid only, not by month. The phone layout shows a
      // year-to-date attendance figure beside the month-to-date one, and a
      // second month-scoped listener per year would be twelve listeners; one
      // employee's days are a few hundred small documents, so this is cheaper
      // and needs no composite index. `uid ==` is the clause the Security Rule
      // checks, so the query stays provable — see `scripts/rules.test.mjs`.
      query(collection(db, 'attendance'), where('uid', '==', uid)),
      (snap) => {
        setRecords(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as AttendanceRecord));
      },
      (err) => {
        console.error('[useAttendance]', err);
        setRecords([]);
        setError(describeFirestoreError(err));
      }
    );

    return () => unsubscribe();
  }, [uid, month]);

  const everything = useMemo<AttendanceRecord[]>(() => {
    if (IS_DEMO) return uid ? demoState.attendance.filter((r) => r.uid === uid) : [];
    return records ?? [];
  }, [records, demoState.attendance, uid]);

  const all = useMemo(
    () => everything.filter((r) => r.dayKey.startsWith(month)),
    [everything, month]
  );

  return useMemo(() => {
    const byDay = new Map(all.map((record) => [record.dayKey, record]));
    const todayKey = karachiDayKey();

    const days: AttendanceDay[] = monthDays(month).map(({ day, dayKey, weekday }) => {
      const record = byDay.get(dayKey);
      const firstAt = toDate(record?.firstActionAt);
      const lastAt = toDate(record?.lastActionAt);
      const minutes =
        record?.workedMinutes ?? workedMinutes(firstAt?.getTime(), lastAt?.getTime());

      let status: AttendanceStatus;
      if (record?.overrideStatus) {
        status = record.overrideStatus;
      } else if (record?.late) {
        // §3 — Late is its own colour on the calendar, and its own column in
        // the reports. An override still wins: HR excusing a late is exactly
        // the case a manual adjustment exists for.
        status = 'LATE';
      } else if (dayKey > todayKey) {
        status = 'UNRECORDED';
      } else if (weekday === WEEKLY_OFF_DAY) {
        status = record ? deriveStatus(minutes, true) : 'OFF';
      } else {
        status = deriveStatus(minutes, Boolean(record));
      }

      return {
        day,
        dayKey,
        status,
        network: record?.network ?? 'UNKNOWN',
        minutes,
        firstAt,
        lastAt,
        isFuture: dayKey > todayKey,
        record: record ?? null,
      };
    });

    const today = days.find((d) => d.dayKey === todayKey) ?? null;
    const elapsed = days.filter((d) => !d.isFuture);

    // Year to date. Every recorded day of this year that has already happened,
    // graded the same way a month's days are, so the two figures beside each
    // other on the phone dashboard mean the same thing.
    const year = todayKey.slice(0, 4);
    const yearStatuses = everything
      .filter((r) => r.dayKey.startsWith(year) && r.dayKey <= todayKey)
      .map((r) =>
        r.overrideStatus ??
        (r.late
          ? ('LATE' as AttendanceStatus)
          : deriveStatus(
              r.workedMinutes ??
                workedMinutes(toDate(r.firstActionAt)?.getTime(), toDate(r.lastActionAt)?.getTime()),
              true
            ))
      );

    return {
      days,
      today,
      rate: attendanceRate(elapsed.map((d) => d.status)),
      /** Same grading, across every recorded day of the year so far. */
      yearRate: attendanceRate(yearStatuses),
      loading: IS_DEMO ? false : Boolean(uid) && records === null,
      error: IS_DEMO ? null : error,
      punch,
      punching,
      /** True once today has been closed — the Check Out button then rests. */
      checkedOut: Boolean(all.find((r) => r.dayKey === karachiDayKey())?.checkedOut),
    };
  }, [all, everything, month, records, error, uid, punch, punching]);
}
