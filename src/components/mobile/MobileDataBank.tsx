"use client";

/**
 * The Data Bank on a phone — two screens and an overlay, in the same idiom as
 * the phone leads pipeline.
 *
 * The desktop Data Bank is a two-pane workspace: a 372px list beside a detail
 * pane. There is no width for that on a phone, and rendering it anyway is what
 * made this screen unusable — a 372px column and a detail pane both trying to
 * fit in 390px, with the record's field table scrolling sideways.
 *
 * So the phone gets the shape a phone wants: a list that fills the frame, and
 * a record that takes the whole screen when you open it. Every write goes
 * through the same `clientActions` with the same payloads as the desktop, so
 * the two surfaces cannot drift.
 *
 * Inline styles rather than Tailwind, for the reason recorded in
 * `mobileChrome`: a value the content scanner never saw emits no rule at all.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import {
  useDataBankFolders,
  useDataBankFolder,
  useDataBankRecords,
  RECORDS_PER_PAGE,
  type DataBankFolder,
  type DataBankRecord,
} from "@/hooks/useDataBank";
import {
  deleteDataBankFolder,
  updateDataBankRecord,
  deleteDataBankRecord,
  promoteDataBankRecord,
} from "@/lib/clientActions";
import { RECORD_STATUSES, RECORD_STATUS_LABELS, type DataBankStatus } from "@/lib/dataBank";
import { formatBusinessDate } from "@/lib/dates";
import { withTimeout, ActionTimeout } from "@/lib/withTimeout";
import { watchGone } from "@/lib/watchGone";
import { initialsOf } from "@/lib/leadDisplay";
import { useOpenedLeads } from "@/hooks/useOpenedLeads";
import { CursorPager } from "@/components/employees/DossierControls";
import {
  buildAssignOptions,
  describeAssignee,
  groupAssignOptions,
  type AssignOption,
} from "@/lib/assignTargets";
import { FolderFormModal } from "@/components/dataBank/FolderFormModal";
import { ImportModal } from "@/components/dataBank/ImportModal";
import { RecordFormModal } from "@/components/dataBank/RecordFormModal";
import { M, HeaderCircle, MobileHeader } from "./mobileChrome";
import { AccountButton } from "./MobileAccount";

/** Status accent, matching the desktop workspace's `STATUS_TONE` exactly. */
const TONE: Record<DataBankStatus, { bg: string; text: string; dot: string }> = {
  NEW: { bg: M.blueBg, text: M.blue, dot: M.blue },
  CONTACTED: { bg: M.tealTint, text: M.tealDeep, dot: M.tealDeep },
  NOT_INTERESTED: { bg: "#f2f7f6", text: M.faint, dot: M.ghost },
};

/** The same three read-state tones the leads list uses. */
const ROW_TONES = {
  unopened: { background: "#e2f0ee", border: "#c9dedb" },
  opened: { background: M.cardBg, border: M.cardBorder },
} as const;

/* ========================================================================== */
/* Screen 1 — the sources                                                     */
/* ========================================================================== */

export function MobileDataBankFolders() {
  const { role, user, getIdToken } = useAuth();
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";
  const router = useRouter();

  // A sub admin sees the folders assigned to them; the query and the Security
  // Rule agree on that, so nothing is filtered afterwards.
  const { folders, loading, error } = useDataBankFolders(isManager, { role, uid: user?.uid });
  const [formFor, setFormFor] = useState<{ folder: DataBankFolder | null } | null>(null);
  const [confirming, setConfirming] = useState<DataBankFolder | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(
    () => ({
      records: folders.reduce((sum, folder) => sum + folder.recordCount, 0),
      promoted: folders.reduce((sum, folder) => sum + folder.promotedCount, 0),
    }),
    [folders]
  );

  const remove = async (folder: DataBankFolder) => {
    setBusy(true);
    try {
      const res = await deleteDataBankFolder(await getIdToken(), folder.id);
      if (res.ok) {
        setBanner({
          tone: "success",
          text: `${folder.name} deleted, along with ${res.data.deleted.toLocaleString()} records.`,
        });
        setConfirming(null);
      } else {
        setBanner({ tone: "error", text: res.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={EYEBROW}>Data Bank</div>
            <h1 style={TITLE}>Sources</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {/* Creating a folder is the admin's decision, and the Server
                Action refuses it for a sub admin — so the control is absent
                rather than present and broken. */}
            {isAdmin && (
              <HeaderCircle label="New folder" onClick={() => setFormFor({ folder: null })}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </HeaderCircle>
            )}
            <AccountButton />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <HeaderStat label="Sources" value={folders.length.toLocaleString()} />
          <HeaderStat label="Cold records" value={totals.records.toLocaleString()} />
          <HeaderStat label="Promoted" value={totals.promoted.toLocaleString()} />
        </div>
      </MobileHeader>

      <div style={LIST_BODY}>
        {error && <Note tone="error">{error}</Note>}
        {banner && <Note tone={banner.tone}>{banner.text}</Note>}

        {loading ? (
          <SkeletonCards />
        ) : folders.length === 0 ? (
          <Empty
            title="No sources yet."
            body="A folder is one source — Capital Smart City, F2F, a walk-in list. Create it with the columns that source's sheet has, then import the file."
          />
        ) : (
          folders.map((folder, index) => (
            <div
              key={folder.id}
              style={{
                background: M.cardBg,
                border: `1px solid ${M.cardBorder}`,
                borderRadius: M.cardRadius,
                overflow: "hidden",
                // A flex item in a column container shrinks below its content
                // by default, and the scroll container above is `flex: 1` —
                // without this the card's own action row is clipped off the
                // bottom edge. Caught in the browser, not in review.
                flexShrink: 0,
                animation:
                  index < 8 ? `mob-rise 300ms cubic-bezier(0.22,0.61,0.36,1) ${index * 32}ms both` : undefined,
              }}
            >
              <button
                className="mob-press"
                onClick={() => router.push(`/admin/data-bank/${folder.id}`)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  padding: "15px 16px 13px",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {folder.code && (
                    <span
                      style={{
                        flexShrink: 0,
                        borderRadius: 7,
                        background: M.tealTint,
                        color: M.tealDeep,
                        padding: "2px 7px",
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {folder.code}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      letterSpacing: "-0.35px",
                      color: M.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {folder.name}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={M.teal}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    style={{ marginLeft: "auto", flexShrink: 0 }}
                    aria-hidden
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>

                {folder.description && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: M.fainter,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {folder.description}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "flex-end", gap: 22, marginTop: 12 }}>
                  <Figure value={folder.recordCount.toLocaleString()} label="Records" />
                  <Figure value={folder.promotedCount.toLocaleString()} label="Promoted" tone={M.tealDeep} />
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                  {folder.fields.slice(0, 3).map((field) => (
                    <span
                      key={field.key}
                      style={{
                        borderRadius: 7,
                        background: M.trackFlat,
                        color: M.muted,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {field.label}
                    </span>
                  ))}
                  {folder.fields.length > 3 && (
                    <span style={{ padding: "3px 4px", fontSize: 11, fontWeight: 600, color: M.fainter }}>
                      +{folder.fields.length - 3}
                    </span>
                  )}
                </div>
              </button>

              {/* Outside the navigating button, so they are separate targets.
                  A sub admin gets neither, so the row is not rendered at all
                  rather than showing two buttons that would be refused. */}
              {isAdmin && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderTop: `1px solid ${M.divider}`,
                  padding: "8px 12px",
                }}
              >
                <MiniAction onPress={() => setFormFor({ folder })} d="M4 20h4L19 9l-4-4L4 16zM14 5l4 4" >
                  Edit fields
                </MiniAction>
                <div style={{ marginLeft: "auto" }}>
                  <MiniAction
                    tone={M.red}
                    onPress={() => setConfirming(folder)}
                    d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"
                  >
                    Delete
                  </MiniAction>
                </div>
              </div>
              )}
            </div>
          ))
        )}
      </div>

      {formFor && (
        <FolderFormModal
          folder={formFor.folder}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}

      {confirming && (
        <ConfirmSheet
          title={`Delete ${confirming.name}?`}
          body={`This removes the folder and all ${confirming.recordCount.toLocaleString()} records in it. Leads already promoted into the pipeline are not affected. This cannot be undone.`}
          confirmLabel={busy ? "Deleting…" : `Delete ${confirming.recordCount.toLocaleString()} records`}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </>
  );
}

/* ========================================================================== */
/* Screen 2 — one folder's records                                            */
/* ========================================================================== */

export function MobileFolderWorkspace({ folderId }: { folderId: string }) {
  const { role, user, getIdToken } = useAuth();
  // A sub admin works the records inside their own folders exactly as an admin
  // does — adding, editing and promoting are all allowed. Only the folder
  // itself is admin-owned, and that lives on the previous screen.
  const isManager = role === "admin" || role === "subadmin";
  const router = useRouter();

  const { folder, loading: folderLoading, error: folderError } = useDataBankFolder(folderId, isManager);
  const { employees } = useEmployees(isManager, { role, uid: user?.uid });
  const { isOpened, markOpened } = useOpenedLeads(user?.uid);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<DataBankStatus | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [formFor, setFormFor] = useState<{ record: DataBankRecord | null } | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const page = useDataBankRecords(folderId, { search: query, status, enabled: isManager });
  const selected = page.records.find((record) => record.id === selectedId) ?? null;

  /**
   * Employees, managers and "Admin / Myself" (§2) — the same list the desktop
   * Data Bank offers, from the same builder, so the two surfaces cannot
   * disagree about who a record may go to.
   */
  const assignOptions = useMemo(
    () =>
      buildAssignOptions(employees, {
        uid: user?.uid ?? "",
        name: user?.email?.split("@")[0] ?? "Me",
        role: role ?? null,
      }),
    [employees, user?.uid, user?.email, role]
  );

  const afterWrite = (message: string) => {
    setBanner({ tone: "success", text: message });
    page.refresh();
  };

  if (!folderLoading && !folder) {
    return (
      <>
        <MobileHeader>
          <h1 style={TITLE}>Data Bank</h1>
        </MobileHeader>
        <div style={LIST_BODY}>
          <Note tone="error">{folderError ?? "That folder no longer exists."}</Note>
          <button
            className="mob-press"
            onClick={() => router.push("/admin/data-bank")}
            style={{ ...PRIMARY_BUTTON, marginTop: 4 }}
          >
            Back to the Data Bank
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
            <HeaderCircle label="Back to the Data Bank" onClick={() => router.push("/admin/data-bank")} size={34}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </HeaderCircle>
            <div style={{ minWidth: 0 }}>
              <div style={EYEBROW}>{folder?.code || "Source"}</div>
              <h1 style={{ ...TITLE, fontSize: 21 }}>{folder?.name ?? "…"}</h1>
              <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.8, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {(folder?.recordCount ?? 0).toLocaleString()} records
              </div>
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <AccountButton />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginTop: 15,
            padding: "11px 15px",
            borderRadius: 999,
            background: M.searchBg,
            border: `1px solid ${M.searchBorder}`,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, or a phone number"
            aria-label="Search this folder"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13.5,
              fontWeight: 500,
              color: "#fff",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
          <button className="mob-press" onClick={() => setImportOpen(true)} style={HEADER_BUTTON}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span>Import CSV</span>
          </button>
          <button
            className="mob-press"
            onClick={() => setFormFor({ record: null })}
            style={{ ...HEADER_BUTTON, background: "#fff", color: M.tealDeep, borderColor: "#fff" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={M.tealDeep} strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Add record</span>
          </button>
        </div>
      </MobileHeader>

      {/* Chips — the same cuts as the desktop workspace. */}
      <div
        role="tablist"
        aria-label="Filter records"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 18px 10px",
          overflowX: "auto",
          overscrollBehavior: "contain",
          flexShrink: 0,
          scrollbarWidth: "none",
        }}
      >
        {(["ALL", ...RECORD_STATUSES] as const).map((key) => {
          const active = status === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(key)}
              className="mob-press"
              style={{
                flexShrink: 0,
                padding: "9px 17px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                border: `1px solid ${active ? M.teal : M.cardBorder}`,
                background: active ? M.teal : M.cardBg,
                color: active ? "#fff" : M.muted,
                transition: "background-color 160ms ease, color 160ms ease, border-color 160ms ease",
              }}
            >
              {key === "ALL" ? "All" : RECORD_STATUS_LABELS[key]}
            </button>
          );
        })}
      </div>

      <div style={LIST_BODY}>
        {banner && <Note tone={banner.tone}>{banner.text}</Note>}
        {page.error && <Note tone="error">{page.error}</Note>}

        {page.loading ? (
          <SkeletonCards />
        ) : page.records.length === 0 ? (
          <Empty
            title={query.trim() ? `Nothing matches “${query.trim()}”.` : "No records in this filter."}
            body={
              query.trim()
                ? "Search matches a name from its start, or a whole phone number."
                : "Import a CSV, or add a record by hand."
            }
          />
        ) : (
          page.records.map((record, index) => {
            const seen = isOpened(record.id);
            const shade = ROW_TONES[seen ? "opened" : "unopened"];
            const tone = TONE[record.status];
            return (
              <button
                key={record.id}
                className="mob-press"
                onClick={() => {
                  setSelectedId(record.id);
                  markOpened(record.id);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px minmax(0,1fr) auto",
                  alignItems: "center",
                  gap: 13,
                  background: shade.background,
                  border: `1px solid ${shade.border}`,
                  borderRadius: M.cardRadius,
                  padding: "14px 16px",
                  textAlign: "left",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  flexShrink: 0,
                  animation:
                    index < 8 ? `mob-rise 300ms cubic-bezier(0.22,0.61,0.36,1) ${index * 32}ms both` : undefined,
                }}
              >
                <span
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#fff",
                    border: `2px solid ${tone.dot}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#4a5c5a",
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {initialsOf(record.name)}
                </span>

                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    {!seen && (
                      <span
                        style={{ width: 7, height: 7, borderRadius: "50%", background: M.teal, flexShrink: 0 }}
                        aria-hidden
                      />
                    )}
                    <span
                      style={{
                        fontSize: 15.5,
                        fontWeight: 700,
                        letterSpacing: "-0.35px",
                        color: M.ink,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {record.name}
                    </span>
                    {!seen && <span className="sr-only">(not opened yet)</span>}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      color: M.faint,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {record.phone || "No number"}
                  </span>
                </span>

                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7, flexShrink: 0 }}>
                  <span
                    style={{
                      borderRadius: 999,
                      background: tone.bg,
                      color: tone.text,
                      padding: "3px 9px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {RECORD_STATUS_LABELS[record.status]}
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={M.teal} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m6 6 6 6-6 6M14 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            );
          })
        )}

        <CursorPager
          page={page.page}
          pageSize={RECORDS_PER_PAGE}
          count={page.records.length}
          hasNext={page.hasNext}
          hasPrevious={page.hasPrevious}
          busy={page.loading}
          onNext={page.next}
          onPrevious={page.previous}
          variant="mobile"
        />
      </div>

      {selected && folder && (
        <MobileRecordDetail
          key={selected.id}
          record={selected}
          folder={folder}
          assignOptions={assignOptions}
          getIdToken={getIdToken}
          onClose={() => setSelectedId(null)}
          onEdit={() => setFormFor({ record: selected })}
          onChanged={afterWrite}
          onRemoved={(message) => {
            setSelectedId(null);
            afterWrite(message);
          }}
        />
      )}

      {importOpen && folder && (
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

      {formFor && folder && (
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
    </>
  );
}

/* ========================================================================== */
/* The record overlay                                                         */
/* ========================================================================== */

function MobileRecordDetail({
  record,
  folder,
  assignOptions,
  getIdToken,
  onClose,
  onEdit,
  onChanged,
  onRemoved,
}: {
  record: DataBankRecord;
  folder: DataBankFolder;
  assignOptions: AssignOption[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (message: string) => void;
  onRemoved: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    // Gone means "out of this folder", not "deleted": promotion files the row
    // under a reserved folder id and removes the document afterwards, so
    // waiting for the document to disappear could outlast the work by a lot.
    const gone = watchGone(
      "dataBankRecords",
      record.id,
      (data) => data.folderId !== record.folderId
    );
    try {
      // Raced against Firestore confirming the deletion — see the desktop
      // `promote` and `lib/watchGone` for why the action's response alone is
      // not a reliable signal on this project.
      const outcome = await withTimeout(
        Promise.race([
          promoteDataBankRecord(await getIdToken(), record.id, assignee).then(
            (res) => ({ from: "action" as const, res })
          ),
          gone.promise.then(() => ({ from: "database" as const, res: null })),
        ])
      );
      if (outcome.from === "database" || outcome.res?.ok) {
        const who = describeAssignee(assignOptions, assignee);
        onRemoved(`${record.name} is now a lead assigned to ${who}.`);
      } else if (outcome.res) {
        setError(outcome.res.error);
      }
    } catch (err) {
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
    <div
      className="mob-slide-in"
      role="dialog"
      aria-modal="true"
      aria-label={record.name}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        background: M.page,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <MobileHeader>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderCircle label="Back to the records" onClick={onClose} size={34}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </HeaderCircle>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14.5,
              fontWeight: 700,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {initialsOf(record.name)}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: "-0.5px",
                color: "#fff",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {record.name}
            </h2>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                opacity: 0.85,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {record.phone || "No number"} · {folder.code || folder.name}
            </div>
          </div>
        </div>

        {/* The three things you actually do to a cold record, at thumb height. */}
        <div style={{ display: "flex", gap: 9, marginTop: 15 }}>
          {call && (
            <a href={call} style={{ ...HEADER_BUTTON, flex: 1, justifyContent: "center", textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
                <path d="M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />
              </svg>
              <span>Call</span>
            </a>
          )}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
              style={{ ...HEADER_BUTTON, flex: 1, justifyContent: "center", textDecoration: "none" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.5A8.5 8.5 0 1 1 21 11.5Z" />
              </svg>
              <span>WhatsApp</span>
            </a>
          )}
          <button
            className="mob-press"
            onClick={onEdit}
            style={{ ...HEADER_BUTTON, flex: call && whatsapp ? "0 0 auto" : 1, justifyContent: "center" }}
            aria-label="Edit this record"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 20h4L19 9l-4-4L4 16zM14 5l4 4" />
            </svg>
            {!(call && whatsapp) && <span>Edit</span>}
          </button>
        </div>
      </MobileHeader>

      <div
        style={{
          minHeight: 0,
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "16px 18px calc(env(safe-area-inset-bottom, 0px) + 26px)",
          display: "flex",
          flexDirection: "column",
          gap: 13,
        }}
      >
        {error && <Note tone="error">{error}</Note>}

        {/* Call status */}
        <Card title="Call status">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {RECORD_STATUSES.map((key) => {
              const active = record.status === key;
              return (
                <button
                  key={key}
                  className="mob-press"
                  onClick={() => void setStatus(key)}
                  disabled={busy || active}
                  style={{
                    padding: "9px 15px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: active ? "default" : "pointer",
                    WebkitTapHighlightColor: "transparent",
                    border: `1px solid ${active ? M.teal : M.cardBorder}`,
                    background: active ? M.teal : "#fff",
                    color: active ? "#fff" : M.muted,
                    opacity: busy && !active ? 0.5 : 1,
                  }}
                >
                  {RECORD_STATUS_LABELS[key]}
                </button>
              );
            })}
          </div>

          <label style={{ display: "block", marginTop: 14 }}>
            <span style={LABEL}>Note</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened on the call"
              style={{
                marginTop: 6,
                width: "100%",
                resize: "vertical",
                borderRadius: M.fieldRadius,
                border: `1px solid ${M.cardBorder}`,
                background: "#f7fbfa",
                padding: "11px 13px",
                fontSize: 13.5,
                fontWeight: 500,
                color: M.ink,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </label>
          {notes !== (record.notes ?? "") && (
            <button
              className="mob-press"
              onClick={() => void saveNotes()}
              disabled={busy}
              style={{ ...PRIMARY_BUTTON, marginTop: 10 }}
            >
              Save note
            </button>
          )}
        </Card>

        {/* Every field this source carries, in its own words. */}
        <Card title={`${folder.name} record`}>
          <dl style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {folder.fields.map((field) => {
              const value = record.values[field.key]?.trim() ?? "";
              const isRole = field.key === folder.roles.name || field.key === folder.roles.phone;
              return (
                <div key={field.key}>
                  <dt style={{ ...LABEL, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{field.label}</span>
                    {isRole && (
                      <span
                        style={{
                          borderRadius: 5,
                          background: M.tealTint,
                          color: M.tealDeep,
                          padding: "1px 5px",
                          fontSize: 9.5,
                          fontWeight: 700,
                        }}
                      >
                        {field.key === folder.roles.name ? "name" : "phone"}
                      </span>
                    )}
                  </dt>
                  <dd
                    style={{
                      marginTop: 3,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: value ? M.ink : "#c3d5d3",
                      wordBreak: "break-word",
                      fontVariantNumeric: field.key === folder.roles.phone ? "tabular-nums" : undefined,
                    }}
                  >
                    {value || "—"}
                  </dd>
                </div>
              );
            })}
          </dl>
          {record.createdAt && (
            <div style={{ marginTop: 13, fontSize: 11.5, fontWeight: 500, color: M.fainter }}>
              Added {formatBusinessDate(record.createdAt)}
            </div>
          )}
        </Card>

        {/* Promotion — the point of the whole Data Bank. */}
        <div
          style={{
            borderRadius: M.cardRadius,
            border: "1px solid #bfe0dc",
            background: M.tealTint,
            padding: "15px 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 700, color: M.tealDark }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
            <span>Move into the pipeline</span>
          </div>
          <p style={{ marginTop: 5, fontSize: 12.5, fontWeight: 500, color: M.body, lineHeight: 1.5 }}>
            Creates a lead assigned straight to the person you pick — no acceptance window. Every
            field above travels with it. The row then leaves this folder.
          </p>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label="Assign this lead to"
            style={{
              marginTop: 12,
              width: "100%",
              borderRadius: M.fieldRadius,
              border: "1px solid #bfe0dc",
              background: "#fff",
              padding: "12px 13px",
              fontSize: 13.5,
              fontWeight: 600,
              color: M.ink,
              outline: "none",
              fontFamily: "inherit",
            }}
          >
            <option value="">Choose who this goes to…</option>
            {groupAssignOptions(assignOptions).map((section) => (
              <optgroup key={section.group} label={section.label}>
                {section.options.map((option) => (
                  <option key={option.uid} value={option.uid}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className="mob-press"
            onClick={() => void promote()}
            disabled={busy || !assignee}
            style={{
              ...PRIMARY_BUTTON,
              marginTop: 10,
              width: "100%",
              background: M.tealDeep,
              opacity: busy || !assignee ? 0.5 : 1,
            }}
          >
            {busy ? "Working…" : "Promote to lead"}
          </button>
          {assignOptions.length === 0 && (
            <p style={{ marginTop: 9, fontSize: 12, fontWeight: 600, color: M.amberInk }}>
              Nobody to assign to — resume someone in the Team directory first.
            </p>
          )}
          <p style={{ marginTop: 8, fontSize: 11.5, color: M.faint, lineHeight: 1.5 }}>
            An employee gets it in their pipeline. A manager, or you, get it in the Client section.
          </p>
        </div>

        <button
          className="mob-press"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            borderRadius: 999,
            border: "1px solid #f0c4bd",
            background: "#fff",
            color: M.red,
            padding: "12px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
            fontFamily: "inherit",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
          </svg>
          <span>Remove from this folder</span>
        </button>
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title={`Remove ${record.name}?`}
          body={`This deletes the row from ${folder.name}. It cannot be undone — re-importing the source file would bring it back as a new record with no call status.`}
          confirmLabel={busy ? "Removing…" : "Remove"}
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}

/* ========================================================================== */
/* Small shared pieces                                                        */
/* ========================================================================== */

export const EYEBROW = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: "1.4px",
  textTransform: "uppercase",
  opacity: 0.78,
} as const;

export const TITLE = {
  fontSize: 24,
  fontWeight: 800,
  letterSpacing: "-0.7px",
  marginTop: 2,
  color: "#fff",
} as const;

const LABEL = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.9px",
  textTransform: "uppercase",
  color: M.fainter,
} as const;

export const LIST_BODY = {
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "contain",
  WebkitOverflowScrolling: "touch",
  padding: "14px 18px calc(env(safe-area-inset-bottom, 0px) + 18px)",
  display: "flex",
  flexDirection: "column",
  gap: 11,
} as const;

const HEADER_BUTTON = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 15px",
  borderRadius: 999,
  border: `1px solid ${M.searchBorder}`,
  background: M.searchBg,
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  fontFamily: "inherit",
} as const;

const PRIMARY_BUTTON = {
  borderRadius: 999,
  border: "none",
  background: M.teal,
  color: "#fff",
  padding: "12px 22px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  fontFamily: "inherit",
} as const;

export function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        borderRadius: M.fieldRadius,
        background: M.wellBg,
        border: `1px solid ${M.wellBorder}`,
        padding: "9px 11px",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.5px", opacity: 0.8, marginTop: 1 }}>
        {label}
      </div>
    </div>
  );
}

export function Figure({ value, label, tone = M.ink }: { value: string; label: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 21, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ ...LABEL, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: M.cardRadius,
        border: `1px solid ${M.cardBorder}`,
        background: M.cardBg,
        padding: "15px 16px",
      }}
    >
      <div style={{ ...LABEL, marginBottom: 11 }}>{title}</div>
      {children}
    </div>
  );
}

export function MiniAction({
  children,
  onPress,
  d,
  tone = M.muted,
}: {
  children: React.ReactNode;
  onPress: () => void;
  d: string;
  tone?: string;
}) {
  return (
    <button
      className="mob-press"
      onClick={onPress}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: "transparent",
        color: tone,
        padding: "7px 9px",
        borderRadius: 9,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        fontFamily: "inherit",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
      <span>{children}</span>
    </button>
  );
}

export function Note({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      style={{
        borderRadius: M.rowRadius,
        border: `1px solid ${error ? "#f0c4bd" : "#bfe0dc"}`,
        background: error ? "#fdeeeb" : "#eef8f7",
        color: error ? "#a33a29" : M.tealDeep,
        padding: "11px 13px",
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: "44px 14px", textAlign: "center" }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={M.ghost} strokeWidth="1.5" style={{ margin: "0 auto" }} aria-hidden>
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </svg>
      <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 700, color: M.ink }}>{title}</div>
      <p style={{ margin: "6px auto 0", maxWidth: 300, fontSize: 12.5, fontWeight: 500, color: M.faint, lineHeight: 1.55 }}>
        {body}
      </p>
    </div>
  );
}

/** Placeholder cards while the first snapshot lands — see `MobileLeads`. */
export function SkeletonCards() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr",
            alignItems: "center",
            gap: 13,
            background: M.cardBg,
            border: `1px solid ${M.cardBorder}`,
            borderRadius: M.cardRadius,
            padding: "14px 16px",
            opacity: 0.55,
            animation: `mob-fade 260ms ease ${i * 60}ms both`,
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: M.track }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ height: 12, width: "58%", borderRadius: 6, background: M.track }} />
            <div style={{ height: 10, width: "40%", borderRadius: 5, background: M.trackFlat }} />
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * A destructive confirmation, as a bottom sheet.
 *
 * Deleting a folder takes thousands of numbers with it, so the count is in the
 * prompt and the confirm button names it. Not a `window.confirm` — that gives
 * no room to say what is actually about to be lost.
 */
function ConfirmSheet({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div
        className="mob-fade"
        onClick={busy ? undefined : onCancel}
        style={{ position: "absolute", inset: 0, background: "rgba(30,58,56,0.45)" }}
        aria-hidden
      />
      <div
        className="mob-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "relative",
          background: "#fff",
          borderRadius: `${M.sheetRadius}px ${M.sheetRadius}px 0 0`,
          padding: "22px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: M.ink, letterSpacing: "-0.4px" }}>{title}</div>
        <p style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: M.body, lineHeight: 1.55 }}>{body}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            className="mob-press"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1,
              borderRadius: 999,
              border: `1px solid ${M.cardBorder}`,
              background: "#fff",
              color: M.muted,
              padding: "13px 18px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Keep it
          </button>
          <button
            className="mob-press"
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              borderRadius: 999,
              border: "none",
              background: M.red,
              color: "#fff",
              padding: "13px 18px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
