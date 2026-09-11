"use client";

import { useState } from "react";
import type { Lead } from "@/hooks/useLeads";
import type { useEmployees } from "@/hooks/useEmployees";
import { Modal } from "@/components/ui/Modal";
import { assignLead, reassignLeadManual } from "@/lib/clientActions";
import { formatPhone } from "@/lib/phone";
import { MANAGER_KIND_LABELS, normalizeManagerKind } from "@/lib/constants/hierarchy";
import type { RunAction } from "./AdminShared";

export function AssignModal({
  lead,
  employees,
  managers = [],
  onClose,
  getIdToken,
  runAction,
}: {
  lead: Lead | null;
  employees: ReturnType<typeof useEmployees>["employees"];
  /**
   * **Managers who may also be given this lead** — passed only by a caller
   * whose actor is the admin or HR, because only they may hand one sideways.
   *
   * Empty for a Sales manager, so the group simply does not appear rather than
   * offering a choice the server would refuse. A control that lists an option
   * whose only outcome is an error is worse than one that does not list it.
   */
  managers?: ReturnType<typeof useEmployees>["employees"];
  onClose: () => void;
  getIdToken: () => Promise<string>;
  runAction: RunAction;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  if (!lead) return null;

  const active = employees.filter((e) => e.status === "ACTIVE");
  const activeManagers = managers.filter((manager) => manager.status === "ACTIVE");
  const everyone = [...activeManagers, ...active];
  const isFirstAssignment = lead.status === "NEW" || lead.status === "UNASSIGNED_NO_CAPACITY";

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    const chosen = everyone.find((person) => person.uid === selected);
    const ok = await runAction(
      async () => {
        const token = await getIdToken();
        return isFirstAssignment
          ? assignLead(token, lead.id, selected)
          : reassignLeadManual(token, lead.id, selected);
      },
      `${lead.name} assigned to ${chosen?.name ?? "them"} and accepted on their behalf.`
    );
    if (ok) onClose();
    setBusy(false);
  };

  return (
    <Modal isOpen onClose={onClose} title={isFirstAssignment ? "Assign lead" : "Reassign lead"}>
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Lead</p>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-3">
            <p className="font-bold text-slate-900">{lead.name}</p>
            {lead.phone && <p className="text-xs tabular-nums text-slate-500">{formatPhone(lead.phone)}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="assignee" className="block text-xs font-semibold text-slate-700">Assign to</label>
          {everyone.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              There is nobody active to assign this to. Add or re-enable someone first.
            </p>
          ) : (
            <select
              id="assignee"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            >
              <option value="" disabled>Choose who works this…</option>
              {/*
                **Managers first, then employees.** Two groups rather than one
                mixed list, because they are different decisions: giving a lead
                to a manager is handing it to somebody who will work it
                themselves, and it lands in their own pipeline.
              */}
              {activeManagers.length > 0 && (
                <optgroup label="Managers">
                  {activeManagers.map((manager) => (
                    <option key={manager.uid} value={manager.uid}>
                      {manager.name} — {MANAGER_KIND_LABELS[normalizeManagerKind(manager.managerKind)]}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* The job title is on the option because the list is no longer
                  always one team: an HR manager assigns across the whole
                  company, and "which of these is a Sales Executive" is the
                  question they are answering at this select. */}
              {active.length > 0 && (
                <optgroup label="Employees">
                  {active.map((emp) => (
                    <option key={emp.uid} value={emp.uid}>
                      {emp.name} — {emp.jobTitle} · priority {emp.priority}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </div>

        <button
          disabled={!selected || busy}
          onClick={submit}
          className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 transition-all hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-emerald-600/20"
        >
          {busy ? "Assigning…" : "Confirm assignment"}
        </button>
      </div>
    </Modal>
  );
}
