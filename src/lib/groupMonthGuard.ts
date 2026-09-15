/**
 * The closing's teeth: a closed month's spending cannot be changed underneath
 * it.
 *
 * Asked by every write that adds, edits, decides or deletes an office or a
 * personal expense. A closed month's figures are frozen on the month itself
 * (`lib/groupFinance`), so the numbers would survive an edit anyway — but a
 * record changed after the books were closed is exactly the thing somebody
 * closes a month to prevent. The refusal names the month and the way out.
 *
 * **Paying is deliberately not guarded.** Settling last month's bill this month
 * changes no obligation and no closed figure; refusing it would leave a real
 * debt unpayable until somebody reopened the books.
 *
 * A plain server module rather than a `"use server"` export, so it is not
 * itself callable from the browser.
 */

import { adminDb } from "@/lib/firebase/server";
import { UserFacingError } from "@/lib/actionResult";
import { monthLabel, monthOfDayKey } from "@/lib/groupFinance";

export const GROUP_MONTHS = "groupMonths";

export async function assertMonthOpen(...dayKeys: Array<string | null | undefined>): Promise<void> {
  const months = [...new Set(dayKeys.filter((key): key is string => typeof key === "string" && key.length >= 7).map(monthOfDayKey))];
  for (const monthKey of months) {
    const snap = await adminDb.collection(GROUP_MONTHS).doc(monthKey).get();
    if (snap.exists && snap.data()?.status === "CLOSED") {
      throw new UserFacingError(
        `${monthLabel(monthKey)} is closed in Group Expense, so its expenses cannot be changed. Reopen the month there first.`
      );
    }
  }
}
