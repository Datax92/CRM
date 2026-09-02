"use client";

import { useState } from "react";
import type { Lead } from "@/hooks/useLeads";
import type { useEmployees } from "@/hooks/useEmployees";
import { Modal } from "@/components/ui/Modal";
import { assignLead, reassignLeadManual } from "@/lib/clientActions";
import { formatPhone } from "@/lib/phone";
import type { RunAction } from "./AdminShared";

export function AssignModal({
  lead,
  employees,
  onClose,
  getIdToken,
  runAction,
}: {
  lead: Lead | null;
  employees: ReturnType<typeof useEmployees>["employees"];
  onClose: () => void;
  getIdToken: () => Promise<string>;
  runAction: RunAction;
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  if (!lead) return null;

  const active = employees.filter((e) => e.status === "ACTIVE");
  const isFirstAssignment = lead.status === "NEW" || lead.status === "UNASSIGNED_NO_CAPACITY";

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    const chosen = employees.find((e) => e.uid === selected);
    const ok = await runAction(
      async () => {
        const token = await getIdToken();
        return isFirstAssignment
          ? assignLead(token, lead.id, selected)
          : reassignLeadManual(token, lead.id, selected);
      },
      `${lead.name} assigned to ${chosen?.name ?? "employee"} and accepted on their behalf.`
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
          {active.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              There are no active employees. Add or re-enable someone first.
            </p>
          ) : (
            <select
              id="assignee"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            >
              <option value="" disabled>Choose an employee…</option>
              {active.map((emp) => (
                <option key={emp.uid} value={emp.uid}>{emp.name} — priority {emp.priority}</option>
              ))}
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
