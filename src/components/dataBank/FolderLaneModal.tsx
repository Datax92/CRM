"use client";

/**
 * "Who gets these leads" — one folder's own lane.
 *
 * **The case it answers.** A client runs ads for one project and wants every
 * lead from it on one desk. The campaign already has its own folder, created by
 * the first lead that arrived; this says who that folder's leads are offered
 * to. Everything else about the offer is unchanged — priority order, each
 * person's turn size, the five-minute window, Accept and Pass on, and the loop
 * back to the first person when everybody has had a turn — so what is chosen
 * here narrows the lane rather than replacing it.
 *
 * **Nothing chosen is the absence of a rule**, not a rule that nobody gets
 * them. That is said on the screen, because the failure this control could
 * cause is a paid lead reaching nobody, and the way somebody would cause it is
 * by reading an empty list as "off".
 *
 * The three groups are listed separately — the admin, managers, employees —
 * because "and myself" and "and a manager" are exactly the parts an admin does
 * not expect to be allowed and would otherwise not look for.
 */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, Users } from "lucide-react";
import { setFolderLane } from "@/lib/clientActions";
import { useAuth } from "@/context/AuthContext";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MAX_LANE_UIDS } from "@/lib/distribution";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import type { DataBankFolder } from "@/hooks/useDataBank";

export interface LanePerson {
  uid: string;
  name: string;
  /** "Sales Executive", "Manager", "Admin (you)" — the line under the name. */
  detail: string;
  group: "You" | "Managers" | "Employees";
  /** Their place in the general lane, shown so the order inside the group is legible. */
  priority?: number;
  disabled?: boolean;
}

/**
 * Everybody who may be given this folder's leads, in the order the modal draws
 * them.
 *
 * Exported and pure so the card's summary line and the modal cannot disagree
 * about somebody's name — the card needs the same lookup to print "Goes to
 * Aroosa and Rafia".
 */
export function buildLanePeople(input: {
  self: { uid: string; name: string; role: string | null };
  managers: Array<{ uid: string; name: string; status: string; jobTitle?: string }>;
  employees: Array<{ uid: string; name: string; status: string; jobTitle?: string; priority?: number }>;
}): LanePerson[] {
  const people: LanePerson[] = [];

  if (input.self.uid) {
    people.push({
      uid: input.self.uid,
      name: input.self.name,
      detail: input.self.role === "admin" ? "Admin · you" : "You",
      group: "You",
    });
  }

  for (const manager of input.managers) {
    if (manager.uid === input.self.uid) continue;
    people.push({
      uid: manager.uid,
      name: manager.name,
      detail: "Manager",
      group: "Managers",
      disabled: manager.status === "DISABLED",
    });
  }

  for (const employee of input.employees) {
    if (employee.uid === input.self.uid) continue;
    people.push({
      uid: employee.uid,
      name: employee.name,
      detail: employee.jobTitle || "Employee",
      group: "Employees",
      priority: employee.priority,
      disabled: employee.status === "DISABLED",
    });
  }

  return people;
}

/** "Aroosa, Rafia and 2 others" — the card's one-line answer. */
export function describeLane(uids: string[] | null | undefined, people: LanePerson[]): string | null {
  if (!uids || uids.length === 0) return null;
  const names = uids.map(
    (uid) => people.find((person) => person.uid === uid)?.name ?? "Someone who has left"
  );
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? "" : "s"}`;
}

const GROUPS: Array<LanePerson["group"]> = ["You", "Managers", "Employees"];

export function FolderLaneModal({
  folder,
  getIdToken,
  onClose,
  onSaved,
}: {
  folder: DataBankFolder;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user, role } = useAuth();
  const isMobile = useIsMobile();
  const isAdmin = role === "admin";

  const { employees } = useEmployees(true, { role, uid: user?.uid });
  const { subAdmins } = useSubAdmins(isAdmin);

  const people = useMemo(
    () =>
      buildLanePeople({
        self: { uid: user?.uid ?? "", name: user?.email || "You", role },
        managers: subAdmins,
        employees,
      }),
    [user?.uid, user?.email, role, subAdmins, employees]
  );

  const [selected, setSelected] = useState<string[]>(() => folder.laneUids ?? []);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) => person.name.toLowerCase().includes(needle));
  }, [people, search]);

  const toggle = (uid: string) =>
    setSelected((current) =>
      current.includes(uid)
        ? current.filter((id) => id !== uid)
        : current.length >= MAX_LANE_UIDS
          ? current
          : [...current, uid]
    );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await setFolderLane(await getIdToken(), folder.id, selected);
      if (!res.ok) return setError(res.error);
      onSaved(
        res.data.names.length === 0
          ? `${folder.name} now goes to everyone in the rotation.`
          : `${folder.name} now goes to ${res.data.names.join(", ")}.`
      );
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-8">
      <div className="animate-modal-fade fixed inset-0 bg-[#1e3a38]/45" onClick={onClose} aria-hidden />

      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label="Who gets these leads"
        className="animate-modal-pop relative z-10 grid max-h-full w-full max-w-[560px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-white shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="bg-[#4f9c99] px-6 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <Users size={18} />
            <div className="text-[17px] font-medium">Who gets these leads</div>
          </div>
          <p className="mt-0.5 text-[12.5px] text-white/85">{folder.name}</p>
        </div>

        <div className="teal-scrollbar min-h-0 overflow-y-auto px-6 py-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-[#f0c4bd] bg-[#fdeeeb] px-4 py-3 text-[13px] text-[#a33a29]"
            >
              {error}
            </div>
          )}

          <p className="text-[13px] leading-relaxed text-[#5b6d6b]">
            Tick the people this campaign&rsquo;s leads should go to. They are offered in turn, in
            priority order, with the usual {ACCEPT_WINDOW_MINUTES}-minute window to accept — and if
            the last one lets it pass, it stays with them rather than leaving the group.
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[#7e918f]">
            <strong className="font-medium text-[#5b6d6b]">Tick nobody</strong> and the folder goes
            back to the whole rotation, which is how every folder starts. Handing a lead out by hand
            still works exactly as it does today — this only decides where new leads land on their
            own.
          </p>

          <div className="mt-4 flex items-center gap-2 rounded-full border border-[#dceae8] bg-[#f7fbfa] px-3.5 py-2">
            <Search size={14} className="shrink-0 text-[#9aacaa]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name"
              aria-label="Search people"
              className="w-full bg-transparent text-[13.5px] text-[#2b3a39] outline-none placeholder:text-[#9aacaa]"
              // 16px or iOS Safari zooms the page on focus.
              style={{ fontSize: isMobile ? 16 : 13.5 }}
            />
          </div>

          <div className="mt-3 space-y-4">
            {GROUPS.map((group) => {
              const rows = shown.filter((person) => person.group === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <div className="mb-1.5 text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">
                    {group}
                  </div>
                  <div className="space-y-1.5">
                    {rows.map((person) => (
                      <PersonRow
                        key={person.uid}
                        person={person}
                        checked={selected.includes(person.uid)}
                        onToggle={() => toggle(person.uid)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {shown.length === 0 && (
              <p className="py-6 text-center text-[13px] text-[#9aacaa]">Nobody by that name.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6f1f0] bg-[#f7fbfa] px-6 py-4">
          <span className="text-[12.5px] text-[#7e918f]">
            {selected.length === 0
              ? "Everyone in the rotation"
              : `${selected.length} chosen${selected.length >= MAX_LANE_UIDS ? " (the most allowed)" : ""}`}
          </span>
          <div className="flex items-center gap-3">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected([])}
                disabled={busy}
                className="rounded-full px-3 py-2.5 text-[13px] text-[#5b6d6b] transition-colors hover:bg-[#eef6f5] disabled:opacity-50"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full border border-[#cfe2e0] bg-white px-6 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-[#3f8f8a] px-7 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}

/**
 * One person, as a tick row.
 *
 * A paused account is shown and refused rather than hidden: "why is Hussain not
 * in this list" is a question somebody would otherwise have to go and answer
 * from another screen.
 */
function PersonRow({
  person,
  checked,
  onToggle,
}: {
  person: LanePerson;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={person.disabled}
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:opacity-55 ${
        checked
          ? "border-[#8cc3bf] bg-[#e8f5f3]"
          : "border-[#e6f1f0] bg-white hover:border-[#bfe0dc] hover:bg-[#f7fbfa]"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 ${
          checked ? "border-[#3f8f8a] bg-[#3f8f8a] text-white" : "border-[#cfe2e0] bg-white"
        }`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-[#2b3a39]">{person.name}</span>
        <span className="block truncate text-[12px] text-[#9aacaa]">
          {person.disabled ? `${person.detail} · paused` : person.detail}
        </span>
      </span>
      {typeof person.priority === "number" && person.priority < 99 && (
        <span className="shrink-0 rounded-full bg-[#eef6f5] px-2 py-0.5 text-[11px] text-[#5b8b87]">
          Priority {person.priority}
        </span>
      )}
    </button>
  );
}
