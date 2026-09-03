import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getTeamAttendance } from '@/lib/clientActions';
import type { TeamAttendanceResult } from '@/app/actions/attendance';

/**
 * A date range of attendance for everyone the signed-in user may see.
 *
 * A fetch rather than a listener, deliberately. The Security Rule can prove
 * two cases on its own — the admin, and a person's own days — but a Sales
 * manager's team is a property of each *employee's* profile, not of the
 * attendance row, so a rule for it would cost a document read per day per
 * employee. The Server Action checks the roster once instead.
 *
 * It is also the right shape for the screens that use it: a report with a
 * From/To and a set of filters is a query somebody runs, not a feed that
 * should stream. `reload()` re-runs it after a correction.
 */
export function useTeamAttendance(
  from: string,
  to: string,
  options: { uid?: string; enabled?: boolean } = {}
) {
  const { getIdToken } = useAuth();
  const { uid, enabled = true } = options;

  const [data, setData] = useState<TeamAttendanceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled || !from || !to) return;
    let cancelled = false;

    (async () => {
      // The first statement is an await, so this never sets state
      // synchronously inside the effect.
      const token = await getIdToken().catch(() => '');
      if (cancelled) return;
      if (!token) {
        setError('Your session has ended. Please sign in again.');
        return;
      }

      setLoading(true);
      const result = await getTeamAttendance(token, { from, to, uid });
      if (cancelled) return;

      setLoading(false);
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [from, to, uid, enabled, getIdToken, nonce]);

  return {
    rows: data?.rows ?? [],
    policy: data?.policy ?? null,
    companyWide: data?.companyWide ?? false,
    loading,
    error,
    reload,
  };
}
