"use client";

/**
 * One folder's records — the same two-pane shape as the leads workspace, so
 * the screen is already familiar: a 372px list on the left, the record's
 * details on the right.
 *
 * The difference is that the detail pane is **built from the folder's own
 * fields**, in the folder's own words. A Capital Smart City record shows
 * Member Name / Contact Number / Address / Form Number; an F2F record shows
 * something else entirely. Neither the list nor the pane knows anything about
 * either — they render whatever the folder defines.
 *
 * Paging is next/previous rather than numbered, because the underlying query
 * is a Firestore cursor: there is no offset, and faking one on a 20,000-row
 * folder would cost a read per skipped row.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileFolderWorkspace } from "@/components/mobile/MobileDataBank";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useDataBankFolder, useDataBankRecords, type DataBankRecord } from "@/hooks/useDataBank";
import {
  addDataBankRecord,
  updateDataBankRecord,
  deleteDataBankRecord,
  promoteDataBankRecord,
  assignRecordsToManager,
} from "@/lib/clientActions";
import { RECORD_STATUSES, RECORD_STATUS_LABELS, type DataBankStatus } from "@/lib/dataBank";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { withTimeout, ActionTimeout } from "@/lib/withTimeout";
import { watchGone } from "@/lib/watchGone";
import { initialsOf } from "@/lib/leadDisplay";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { RECORDS_PER_PAGE } from "@/hooks/useDataBank";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { WorkspaceEmpty } from "@/components/leads/WorkspaceEmpty";
import { CursorPager } from "@/components/employees/DossierControls";
import {
  assignActionFor,
  buildAssignOptions,
  describeAssignee,
  groupAssignOptions,
  type AssignOption,
} from "@/lib/assignTargets";
import { ImportModal } from "./ImportModal";
import { BulkPromoteBar } from "./BulkPromoteBar";
import { RecordFormModal } from "./RecordFormModal";
import {
  ArrowLeft,
  Search,
  SlidersHorizontal,
  Upload,
  Plus,
  Phone,
  MessageCircle,
  Trash2,
  Pencil,
  ArrowUpRight,
} from "lucide-react";

const STATUS_TONE: Record<DataBankStatus, { bg: string; text: string; dot: string }> = {
  NEW: { bg: "#eef6fb", text: "#3f7ea3", dot: "#3f7ea3" },
  CONTACTED: { bg: "#e8f5f3", text: "#2f7d78", dot: "#2f7d78" },
  NOT_INTERESTED: { bg: "#f2f7f6", text: "#8fa2a0", dot: "#a9bcba" },
};

/**
 * The leads workspace's read-state ramp, verbatim.
 *
 * This screen is the same product as the pipeline list, so a row here has to
 * shade exactly as a row there — dark to light, selected deepest, unopened in
 * the middle, already-read receding almost to the panel's white. Inline rather
 * than Tailwind arbitrary values for the reason recorded in `StageChrome`:
 * a value the content scanner never saw emits no rule at all.
 */
const ROW_TONES = {
  selected: { background: "#c6e0dc", border: "#3f8f8a" },
  unopened: { background: "#e2f0ee", border: "#c9dedb" },
  opened: { background: "#fbfdfd", border: "#e6f1ef" },
} as const;

export function FolderWorkspace({ folderId }: { folderId: string }) {
  const { role, user, loading: authLoading, getIdToken } = useAuth();
  // **Both managing roles.** This was `role === "admin"` and gated every read
  // below, so a sub admin opening a folder assigned to them subscribed to
  // nothing, `folder` stayed null, and the screen reported "That folder no
  // longer exists" — which was a permissions gate misreporting itself as a
  // missing record. Ownership is enforced by the Security Rules and by
  // `assertFolderAccess` in the actions; this flag only decides whether to ask.
  const isManager = role === "admin" || role === "subadmin";
  // Phones get their own screen, not this two-pane one squeezed into 390px.
  const isMobile = useIsMobile();
  // Reads are gated on the surface that is actually rendering. This is the one
  // list in the app that costs a page of Firestore reads to open, so letting
  // both components subscribe would double that for nothing.
  const wantsData = isManager && !isMobile;

  const { folder, loading: folderLoading, error: folderError } = useDataBankFolder(folderId, wantsData);
  // A sub admin's roster is their own team, which is also exactly the set of
  // people they may promote a record to.
  const { employees } = useEmployees(wantsData, { role, uid: user?.uid });
  // Managers are a separate query — `useEmployees` is `role == "employee"`, so
  // without this the Managers group was silently always empty and the option
  // the assign list has always supported could never appear. Admin only: a
  // manager handing rows sideways to another manager is the admin's call.
  const { subAdmins } = useSubAdmins(wantsData && role === "admin");

  /**
   * Who a record may go to: employees, managers, and the viewer themselves.
   * Built here so the row action and the bulk bar cannot offer different
   * lists, and carrying `action` so both dispatch the same way.
   */
  const assignOptions = useMemo(
    () =>
      buildAssignOptions([...employees, ...subAdmins], {
        uid: user?.uid ?? "",
        name: user?.email?.split("@")[0] ?? "Me",
        role: role ?? null,
      }),
    [employees, subAdmins, user?.uid, user?.email, role]
  );

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DataBankStatus | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * The bulk selection (§9). Ids rather than indexes, so a row that scrolls
   * away or is filtered out stays selected — and so the payload sent to the
   * server is exactly what the bar counted.
   */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [formFor, setFormFor] = useState<{ record: DataBankRecord | null } | null>(null);
  // `href` lets a success message point at where the thing went — a promoted
  // record leaves this screen entirely, so "it worked" is not enough on its own.
  const [banner, setBanner] = useState<
    { tone: "error" | "success"; text: string; href?: string } | null
  >(null);
  // Same per-browser read state the pipeline list uses. Record ids and lead
  // ids are both random Firestore ids from different collections, so the two
  // lists can share one store without colliding.
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);

  const page = useDataBankRecords(folderId, { search: query, status, enabled: wantsData });
  const selected = page.records.find((record) => record.id === selectedId) ?? null;

  const afterWrite = (message: string, href?: string) => {
    setBanner({ tone: "success", text: message, href });
    page.refresh();
  };

  if (isMobile) return <MobileFolderWorkspace folderId={folderId} />;

  if (authLoading || folderLoading) return <FullPageSpinner />;

  if (!folder) {
    return (
      <div className="-m-6 min-h-full bg-[#e9f1f0] px-6 py-10 md:-m-8">
        {/* Two different failures, said apart: a folder that is gone, and one
            that exists but was never assigned to this sub admin. Reporting the
            second as the first sent people looking for deleted data. */}
        <Banner
          tone="error"
          text={
            folderError ??
            (role === "subadmin"
              ? "This folder is not assigned to you. Ask an admin to assign it, or pick one of yours."
              : "That folder no longer exists.")
          }
        />
        <Link
          href={role === "subadmin" ? "/subadmin/data-bank" : "/admin/data-bank"}
          className="mt-4 inline-block text-[13.5px] text-[#2f7d78]"
        >
          ← Back to the Data Bank
        </Link>
      </div>
    );
  }

  const showDetailOnMobile = selected !== null;

  return (
    <div className="leads-shell -m-6 grid grid-cols-1 overflow-hidden bg-[#e9f1f0] text-[#2b3a39] md:-m-8 lg:grid-cols-[372px_1fr]">
      {/* ================================================================= */}
      {/* Left — record list                                                */}
      {/* ================================================================= */}
      <section
        className={`min-w-0 flex-col border-r border-[#dceae8] bg-[#fbfdfd] ${
          showDetailOnMobile ? "hidden min-h-0 lg:flex" : "flex min-h-0"
        }`}
        aria-label={`${folder.name} records`}
      >
        {/*
          Same 78px teal band as the pipeline list, so the two screens line up
          at the top. `text-white` on the <h1> is load-bearing: @layer base
          gives every heading its own colour, which beats the one inherited
          from this teal parent.
        */}
        <div className="flex min-h-[78px] shrink-0 items-center justify-between gap-3 bg-[#4f9c99] px-5 py-3.5 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href={role === "subadmin" ? "/subadmin/data-bank" : "/admin/data-bank"}
              aria-label="Back to the Data Bank"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
            >
              <ArrowLeft size={17} />
            </Link>
            <div className="min-w-0">
              {/*
                Wraps to a second line rather than truncating. "ALL LEADS" on
                the pipeline is a fixed label that always fits; a folder name is
                the user's own words and is the one thing on this bar that has
                to be readable — "CAPITAL SM…" tells you nothing about which
                source you are in. Clamped inline rather than with a utility
                class for the reason recorded throughout this project: a class
                the content scanner never saw emits no rule.
              */}
              <h1
                title={folder.name}
                className="text-[15px] font-medium tracking-[0.9px] text-white uppercase"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  lineHeight: 1.15,
                }}
              >
                {folder.name}
              </h1>
              <div className="text-[11.5px] tabular-nums text-white/80">
                {folder.recordCount.toLocaleString()} records
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 py-1.5 pr-3 pl-2.5 text-[12.5px] text-white transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Upload size={13} />
              <span>Import</span>
            </button>
            <button
              onClick={() => setFormFor({ record: null })}
              className="inline-flex items-center gap-1.5 rounded-full bg-white py-1.5 pr-3 pl-2.5 text-[12.5px] text-[#2f7d78] transition-colors hover:bg-[#eafaf8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Plus size={13} strokeWidth={2.2} />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Search — 16px / 18px / 10px, matching the pipeline list exactly */}
        <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4 pb-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-[#dceae8] bg-[#eef5f4] px-3 py-2 focus-within:border-[#4f9c99] focus-within:ring-2 focus-within:ring-[#4f9c99]/15">
            <Search size={16} className="shrink-0 text-[#7e918f]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Data"
              aria-label="Search this folder by name or phone number"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#2b3a39] outline-none placeholder:text-[#7e918f]"
            />
          </div>
          <div
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border border-[#dceae8] bg-[#eef5f4] text-[#5b6d6b]"
            aria-hidden
          >
            <SlidersHorizontal size={17} />
          </div>
        </div>

        {/* Filter chips */}
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 px-[18px] pt-1.5 pb-3.5"
          role="tablist"
          aria-label="Filter records"
        >
          {(["ALL", ...RECORD_STATUSES] as const).map((key) => {
            const active = status === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(key)}
                className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-2 text-[12.5px] transition-colors ${
                  active
                    ? "border-[#4f9c99] bg-[#4f9c99] text-white"
                    : "border-[#cfe2e0] bg-white text-[#5b6d6b] hover:border-[#8cc3bf]"
                }`}
              >
                <span>{key === "ALL" ? "All" : RECORD_STATUS_LABELS[key]}</span>
              </button>
            );
          })}
        </div>

        {query.trim() && (
          <p className="shrink-0 px-[18px] pb-2 text-[12px] text-[#9aacaa]">
            Searching by {query.replace(/\D/g, "").length >= 7 ? "phone number" : "name (from the start)"}.
          </p>
        )}

        {/*
          The banner lives here, in the list panel, not in the detail pane.
          Promotion deletes the record, so the pane it used to render in is
          unmounted the instant the write succeeds — the confirmation was
          being destroyed in the same tick it was created, and the admin saw
          the row silently vanish with no sign anything had happened.
        */}
        {(page.error || banner) && (
          <div className="shrink-0 px-4 pb-2">
            {page.error && <Banner tone="error" text={page.error} />}
            {banner && (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800">
                <div className="flex items-start justify-between gap-3">
                  <span>{banner.text}</span>
                  <button
                    onClick={() => setBanner(null)}
                    className="shrink-0 rounded font-bold text-slate-800 hover:text-slate-900"
                  >
                    Dismiss
                  </button>
                </div>
                {banner.href && (
                  <Link
                    href={banner.href}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#2f7d78] px-3 py-1.5 text-[12px] text-white transition-colors hover:bg-[#1f5c58]"
                  >
                    <span>Open it in the pipeline</span>
                    <ArrowUpRight size={13} />
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* §9 — bulk selection and assignment, above the rows it acts on. */}
        <div className="px-3.5 pb-2.5">
          <BulkPromoteBar
            selected={[...picked]}
            available={page.records.length}
            assignOptions={assignOptions}
            getIdToken={getIdToken}
            onSelectCount={(n) => {
              // From the top of what is on screen, in the order shown — "50"
              // has to mean the first fifty of this search, not fifty rows
              // from somewhere in a 40,000-row folder.
              const take = page.records.slice(0, n).map((record) => record.id);
              setPicked(new Set(take));
              return take.length;
            }}
            onClear={() => setPicked(new Set())}
            onDone={(message, href) => {
              setPicked(new Set());
              // The link follows the action: promoted rows land in the
              // pipeline, handed-over rows land in a manager's Data Bank,
              // which is not a page this admin needs sending to.
              afterWrite(message, href);
            }}
          />
        </div>

        {/* Rows */}
        <div className="teal-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-5">
          {page.loading ? (
            <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">Loading…</p>
          ) : page.records.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13px] text-[#8fa2a0]">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : "No records in this filter."}
            </p>
          ) : (
            page.records.map((record, index) => {
              const active = record.id === selectedId;
              const seen = isOpened(record.id);
              const shade = ROW_TONES[active ? "selected" : seen ? "opened" : "unopened"];
              const tone = STATUS_TONE[record.status];
              const ticked = picked.has(record.id);
              return (
                <div key={record.id} className="flex items-center gap-2">
                  {/* Outside the row button so ticking does not also open the
                      record — two different intentions, two targets. */}
                  <input
                    type="checkbox"
                    checked={ticked}
                    aria-label={`Select ${record.name}`}
                    onChange={() =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (next.has(record.id)) next.delete(record.id);
                        else next.add(record.id);
                        return next;
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-[#2f7d78]"
                  />
                <button
                  onClick={() => {
                    setSelectedId(record.id);
                    markOpened(record.id);
                  }}
                  aria-current={active ? "true" : undefined}
                  style={{
                    // Stagger only the first screenful; beyond that the delay
                    // outlasts the scroll and the list reads as laggy.
                    animationDelay: `${Math.min(index, 12) * 35}ms`,
                    background: shade.background,
                    borderColor: shade.border,
                  }}
                  className="animate-lead-row grid w-full min-w-0 flex-1 grid-cols-[44px_1fr_auto] items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-[#8cc3bf]"
                >
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full border-2 bg-white text-[13.5px] font-medium text-[#4a5c5a]"
                    style={{ borderColor: tone.dot }}
                    aria-hidden
                  >
                    {initialsOf(record.name)}
                  </span>

                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Shading alone would carry the read state on colour
                          only — this dot, and the text beside it, give it a
                          second and a third form. */}
                      {!seen && !active && (
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-full"
                          style={{ background: "#3f8f8a" }}
                          aria-hidden
                        />
                      )}
                      <span className="truncate text-sm font-medium text-[#2b3a39]">{record.name}</span>
                      {!seen && !active && <span className="sr-only">(not opened yet)</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] tabular-nums text-[#7e918f]">
                      {record.phone || "No number"}
                    </span>
                  </span>

                  <span className="flex flex-col items-end gap-1.5">
                    <span className="text-right text-[11.5px] leading-tight text-[#5b6d6b]">
                      {record.createdAt ? formatBusinessDateTime(record.createdAt) : "—"}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px]"
                      style={{ background: tone.bg, color: tone.text }}
                    >
                      {RECORD_STATUS_LABELS[record.status]}
                    </span>
                  </span>
                </button>
                </div>
              );
            })
          )}

          <div className="px-1">
            <CursorPager
              page={page.page}
              pageSize={RECORDS_PER_PAGE}
              count={page.records.length}
              hasNext={page.hasNext}
              hasPrevious={page.hasPrevious}
              busy={page.loading}
              onNext={page.next}
              onPrevious={page.previous}
              variant="web"
            />
          </div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Right — detail                                                    */}
      {/* ================================================================= */}
      <section
        className={`min-h-0 min-w-0 overflow-hidden ${showDetailOnMobile ? "block" : "hidden lg:block"}`}
        aria-label="Record detail"
      >
        {selected ? (
          <RecordPane
            key={selected.id}
            record={selected}
            folder={folder}
            assignOptions={assignOptions}
            getIdToken={getIdToken}
            onBack={() => setSelectedId(null)}
            onEdit={() => setFormFor({ record: selected })}
            onChanged={afterWrite}
            onRemoved={(message, href) => {
              setSelectedId(null);
              afterWrite(message, href);
            }}
          />
        ) : (
          <WorkspaceEmpty
            label="Select a Record from the List"
            hint="Every field this source carries is shown here, and a record can be promoted into the pipeline from this pane."
          />
        )}
      </section>

      {importOpen && (
        <ImportModal
          folder={folder}
          getIdToken={getIdToken}
          onClose={() => setImportOpen(false)}
          onFinished={(message) => {
            setImportOpen(false);
            afterWrite(message);
          }}
        />
      )}

      {formFor && (
        <RecordFormModal
          folder={folder}
          record={formFor.record}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            afterWrite(message);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RecordPane({
  record,
  folder,
  assignOptions,
  getIdToken,
  onBack,
  onEdit,
  onChanged,
  onRemoved,
}: {
  record: DataBankRecord;
  folder: NonNullable<ReturnType<typeof useDataBankFolder>["folder"]>;
  assignOptions: AssignOption[];
  getIdToken: () => Promise<string>;
  onBack: () => void;
  onEdit: () => void;
  onChanged: (message: string) => void;
  onRemoved: (message: string, href?: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  // What the chosen recipient's option actually does, so the button says which
  // of the two operations it is about to perform.
  const handoff = assignee ? assignActionFor(assignOptions, assignee) === "HANDOFF" : false;
  const [notes, setNotes] = useState(record.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = folder.fields.filter((field) => record.values[field.key]?.trim()).length;

  const call = record.phone ? `tel:${record.phone.replace(/[^\d+]/g, "")}` : null;
  const whatsapp = record.phone
    ? `https://wa.me/${record.phone.replace(/\D/g, "").replace(/^0/, "92")}`
    : null;

  const setStatus = async (next: DataBankStatus) => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateDataBankRecord(await getIdToken(), record.id, { status: next });
      if (res.ok) onChanged(`Marked as ${RECORD_STATUS_LABELS[next].toLowerCase()}.`);
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateDataBankRecord(await getIdToken(), record.id, { notes });
      if (res.ok) onChanged("Note saved.");
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!assignee) {
      setError("Choose who this lead goes to.");
      return;
    }
    setBusy(true);
    setError(null);

    const who = describeAssignee(assignOptions, assignee);

    // A manager is handed the **record**, to distribute to their own team; an
    // employee or the viewer is handed a **lead**. Two different operations,
    // and the option itself says which — see `lib/assignTargets`.
    if (assignActionFor(assignOptions, assignee) === "HANDOFF") {
      try {
        const res = await withTimeout(
          assignRecordsToManager(await getIdToken(), [record.id], assignee)
        );
        if (res.ok) {
          onRemoved(`${record.name} handed to ${who}. It is now in their Data Bank.`);
        } else {
          setError(res.error);
        }
      } catch (err) {
        setError(
          err instanceof ActionTimeout
            ? err.message
            : "Could not reach the server. Nothing was changed."
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    const done = () =>
      onRemoved(`${record.name} is now a lead assigned to ${who}.`, "/admin/leads?filter=active");

    // Two independent answers, raced. The action's HTTP response is the one
    // that can explain a refusal; Firestore's realtime channel is the one that
    // actually proves the write landed. On this project the response has
    // repeatedly failed to arrive for a promotion that committed perfectly
    // well, so waiting only on it left the button spinning over finished work.
    // Gone means "out of this folder", not "deleted": promotion files the row
    // under a reserved folder id and removes the document afterwards, so
    // waiting for the document to disappear could outlast the work by a lot.
    const gone = watchGone(
      "dataBankRecords",
      record.id,
      (data) => data.folderId !== record.folderId
    );
    try {
      const outcome = await withTimeout(
        Promise.race([
          promoteDataBankRecord(await getIdToken(), record.id, assignee).then(
            (res) => ({ from: "action" as const, res })
          ),
          gone.promise.then(() => ({ from: "database" as const, res: null })),
        ])
      );

      if (outcome.from === "database" || outcome.res?.ok) {
        done();
      } else if (outcome.res) {
        setError(outcome.res.error);
      }
    } catch (err) {
      // The timeout fired with neither answer in. Give the database one last
      // look before calling it a failure — the write may have landed while the
      // response was lost.
      setError(
        err instanceof ActionTimeout
          ? err.message
          : "Could not reach the server. Nothing was changed."
      );
    } finally {
      gone.cancel();
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await deleteDataBankRecord(await getIdToken(), record.id);
      if (res.ok) onRemoved(`${record.name} removed from ${folder.name}.`);
      else setError(res.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-lead-pane flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3.5 bg-[#4f9c99] px-5 py-4 text-white">
        <button
          onClick={onBack}
          aria-label="Back to the list"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20 lg:hidden"
        >
          <ArrowLeft size={18} />
        </button>
        <span
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-white/20 text-[15px]"
          aria-hidden
        >
          {initialsOf(record.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[19px] font-medium text-white">{record.name}</h2>
          <div className="truncate text-[12.5px] text-white/85 tabular-nums">
            {record.phone} · {folder.code || folder.name}
            {record.createdAt && <> · added {formatBusinessDate(record.createdAt)}</>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {call && (
            <a
              href={call}
              aria-label={`Call ${record.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
            >
              <Phone size={16} className="text-white" />
            </a>
          )}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
              aria-label={`WhatsApp ${record.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
            >
              <MessageCircle size={16} className="text-white" />
            </a>
          )}
          <button
            onClick={onEdit}
            aria-label="Edit this record"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
          >
            <Pencil size={15} className="text-white" />
          </button>
        </div>
      </div>

      <div className="teal-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f3faf9] px-5 py-5 sm:px-6">
        {error && <Banner tone="error" text={error} />}

        {/*
          The facts strip the leads detail pane opens with, carrying what is
          true of every record whatever columns its source has.
        */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#e0eeec] bg-[#e0eeec] sm:grid-cols-4">
          <Fact label="Status" value={RECORD_STATUS_LABELS[record.status]} />
          <Fact label="Source" value={folder.code || folder.name} />
          <Fact label="Added" value={record.createdAt ? formatBusinessDate(record.createdAt) : "—"} />
          <Fact label="Fields" value={`${filled} of ${folder.fields.length} filled`} />
        </div>

        {/*
          Every field this source carries, in the source's own words.
          Two columns rather than one long definition list: a transfer sheet
          runs to fifteen or more columns, and stacked full-width they become a
          wall nobody reads to the bottom of. A field whose value wraps to more
          than a line takes the full width back, so an address is never
          squeezed into half a pane.
        */}
        <div className="overflow-hidden rounded-xl border border-[#e0eeec] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#f0f6f5] px-5 py-3">
            <span className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">
              {folder.name} record
            </span>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-[#2f7d78] transition-colors hover:bg-[#eef7f6]"
            >
              <Pencil size={12} />
              <span>Edit</span>
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-px bg-[#f0f6f5] sm:grid-cols-2">
            {folder.fields.map((field) => {
              const value = record.values[field.key]?.trim() ?? "";
              // The two role fields are what makes the row dialable and
              // dedupable, so they lead and are never buried mid-grid.
              const isRole = field.key === folder.roles.name || field.key === folder.roles.phone;
              return (
                <div
                  key={field.key}
                  className={`bg-white px-5 py-3 ${value.length > 46 ? "sm:col-span-2" : ""}`}
                >
                  <dt className="flex items-center gap-1.5 text-[11.5px] tracking-[0.3px] text-[#9aacaa]">
                    <span>{field.label}</span>
                    {isRole && (
                      <span className="rounded bg-[#eef7f6] px-1.5 py-px text-[10px] text-[#2f7d78]">
                        {field.key === folder.roles.name ? "name" : "phone"}
                      </span>
                    )}
                  </dt>
                  <dd
                    className={`mt-1 min-w-0 text-[13.5px] break-words text-[#2b3a39] ${
                      field.key === folder.roles.phone ? "tabular-nums" : ""
                    }`}
                  >
                    {value || <span className="text-[#c3d5d3]">—</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="rounded-xl border border-[#e0eeec] bg-white px-5 py-4">
          <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Call status</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {RECORD_STATUSES.map((key) => {
              const active = record.status === key;
              return (
                <button
                  key={key}
                  onClick={() => void setStatus(key)}
                  disabled={busy || active}
                  className={`rounded-full border px-4 py-2 text-[13px] transition-colors ${
                    active
                      ? "border-[#3f8f8a] bg-[#3f8f8a] text-white"
                      : "border-[#dceae8] bg-white text-[#5b6d6b] hover:border-[#8cc3bf] disabled:opacity-50"
                  }`}
                >
                  {RECORD_STATUS_LABELS[key]}
                </button>
              );
            })}
          </div>

          <label className="mt-4 block">
            <span className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">Note</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened on the call"
              className="mt-1.5 w-full resize-y rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none focus:border-[#4f9c99] focus:bg-white"
            />
          </label>
          {notes !== (record.notes ?? "") && (
            <button
              onClick={() => void saveNotes()}
              disabled={busy}
              className="mt-2 rounded-full bg-[#3f8f8a] px-5 py-2 text-[13px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
            >
              Save note
            </button>
          )}
        </div>

        {/* Promotion — the point of the whole Data Bank. */}
        <div className="rounded-xl border border-[#bfe0dc] bg-[#e8f5f3] px-5 py-4">
          <div className="flex items-center gap-2 text-[14.5px] text-[#1f5c58]">
            <ArrowUpRight size={17} />
            <span>Hand this record on</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[#3c4d4b]">
            Either way the row leaves this folder and every field above travels with it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              aria-label="Assign this lead to"
              className="min-w-[200px] flex-1 rounded-md border border-[#bfe0dc] bg-white px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none focus:border-[#4f9c99]"
            >
              <option value="">Choose who this goes to…</option>
              {groupAssignOptions(assignOptions).map((section) => (
                <optgroup key={section.group} label={section.label}>
                  {section.options.map((option) => (
                    <option key={option.uid} value={option.uid}>
                      {option.label} — {option.hint}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              onClick={() => void promote()}
              disabled={busy || !assignee}
              className="rounded-full bg-[#2f7d78] px-6 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#1f5c58] disabled:opacity-50"
            >
              {busy ? "Working…" : handoff ? "Hand to manager" : "Promote to lead"}
            </button>
          </div>
          {assignOptions.length === 0 && (
            <p className="mt-2 text-[12.5px] text-[#a5762a]">
              Nobody to assign to — resume someone in the Employee Directory first.
            </p>
          )}
          <p className="mt-2 text-[12px] text-[#3c4d4b]">
            An <strong className="font-medium">employee</strong> gets a lead in their pipeline.{" "}
            <strong className="font-medium">You</strong> get a lead in your Client section. A{" "}
            <strong className="font-medium">manager</strong> gets the record in their own Data
            Bank, to hand to one of their team or take themselves.
          </p>
        </div>

        <button
          onClick={() => void remove()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-[#f0c4bd] bg-white px-5 py-2.5 text-[13px] text-[#c0574a] transition-colors hover:bg-[#fdeeec] disabled:opacity-50"
        >
          <Trash2 size={14} />
          <span>Remove from this folder</span>
        </button>
      </div>
    </div>
  );
}

/** One cell of the detail pane's facts strip. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] tracking-[0.9px] text-[#9aacaa] uppercase">{label}</div>
      <div className="mt-1 truncate text-[13.5px] text-[#2b3a39]" title={value}>
        {value}
      </div>
    </div>
  );
}
