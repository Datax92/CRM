"use client";

/**
 * The CSV importer: pick a file, check the column mapping, watch it run.
 *
 * Three steps, and the middle one is the point of the whole feature. The
 * mapping screen shows every header in the file beside the folder field it
 * will land in, pre-matched by `suggestColumnMap` and corrected by the admin
 * in a click. Requiring a sheet's headers to match a field list exactly is
 * what makes importers unusable — a re-export with one renamed column should
 * never mean editing the file by hand.
 *
 * The mapping is **saved to the folder** on import, so the second import of
 * the same source needs no corrections at all.
 *
 * Rows are sent in chunks — capped by both Firestore's 500-write batch and the
 * Server Action body limit — with a progress bar, rather than one request that
 * would time out on a 40,000-row sheet and leave the folder in an unknown
 * state.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { importDataBankRows, saveColumnMap } from "@/lib/clientActions";
import {
  parseCsv,
  toSheet,
  suggestColumnMap,
  prepareImport,
  chunkRowsByPayload,
  estimateImportCost,
  MAX_IMPORT_ROWS,
  type ColumnMap,
  type ParsedSheet,
} from "@/lib/dataBank";
import { FREE_TIER_DAILY_WRITES } from "@/lib/quotaError";
import type { DataBankFolder } from "@/hooks/useDataBank";

type Step = "pick" | "reading" | "map" | "running" | "done";

/** "under a minute" / "3 minutes", from the rate observed so far. */
function describeRemaining(startedAt: number, done: number, total: number): string | null {
  if (done === 0 || done >= total) return null;
  const perRow = (Date.now() - startedAt) / done;
  const seconds = Math.round((perRow * (total - done)) / 1000);
  if (seconds < 45) return "under a minute";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const SELECT =
  "w-full rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2 text-[13px] text-[#2b3a39] outline-none focus:border-[#4f9c99] focus:bg-white";

export function ImportModal({
  folder,
  getIdToken,
  onClose,
  onFinished,
}: {
  folder: DataBankFolder;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onFinished: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [remaining, setRemaining] = useState<string | null>(null);
  const [result, setResult] = useState<{ written: number; duplicates: number } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
      cancelled.current = true;
    };
  }, []);

  const readFile = async (file: File) => {
    setError(null);
    setFileName(file.name);

    if (/\.xlsx?$/i.test(file.name)) {
      setError(
        "Excel files need one extra step for now — open it in Excel and choose File → Save As → CSV UTF-8, then pick that file here."
      );
      return;
    }

    // Reading and parsing a 40,000-row file takes a second or two on the main
    // thread. Without a state to show for it the tab simply freezes and the
    // click reads as having done nothing.
    setStep("reading");
    try {
      const text = await file.text();
      // One frame, so the "Reading…" panel actually paints before the parser
      // takes the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = toSheet(parseCsv(text));

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError("That file has no rows in it.");
        setStep("pick");
        return;
      }
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        setError(
          `That file has ${parsed.rows.length.toLocaleString()} rows — the limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import. Split it and import in parts.`
        );
        setStep("pick");
        return;
      }

      setSheet(parsed);
      setMap(suggestColumnMap(parsed.headers, folder.fields, folder.columnMap));
      setStep("map");
    } catch {
      setError("Could not read that file. Is it a CSV?");
      setStep("pick");
    }
  };

  const prepared = useMemo(
    () => (sheet ? prepareImport(sheet, map, folder.fields, folder.roles) : null),
    [sheet, map, folder.fields, folder.roles]
  );

  const cost = estimateImportCost(prepared?.rows.length ?? 0);

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const nameMapped = Object.values(map).includes(folder.roles.name);
  const phoneMapped = Object.values(map).includes(folder.roles.phone);
  const labelFor = (key: string) => folder.fields.find((f) => f.key === key)?.label ?? key;

  const run = async () => {
    if (!prepared || prepared.rows.length === 0) return;
    const total = prepared.rows.length;
    setStep("running");
    setProgress({ done: 0, total });
    setRemaining(null);
    cancelled.current = false;
    const startedAt = Date.now();

    let written = 0;
    let duplicates = 0;
    let done = 0;

    try {
      const token = await getIdToken();
      // Remember the corrections before writing, so they survive even if the
      // import is interrupted halfway.
      await saveColumnMap(token, folder.id, map);

      // Chunks are sized by payload as well as row count — see
      // `chunkRowsByPayload`. A wide sheet closes them early on size, which is
      // the case that used to fail silently on a big transfer list.
      const chunks = chunkRowsByPayload(prepared.rows);

      // Sequential on purpose. Each chunk's duplicate check reads what the
      // previous chunks committed, so running them concurrently would let two
      // in-flight chunks each decide a number is new. The file itself is
      // already deduped, but a second admin importing the same sheet at the
      // same time is not hypothetical.
      for (const chunk of chunks) {
        if (cancelled.current) break;
        const res = await importDataBankRows(
          token,
          folder.id,
          chunk.map((row) => ({ values: row.values }))
        );
        if (!res.ok) {
          setError(
            `${res.error} ${written.toLocaleString()} rows were written before this — run the import again to finish the rest, they will not be duplicated.`
          );
          setStep("map");
          return;
        }
        written += res.data.written;
        duplicates += res.data.duplicates;
        done += chunk.length;
        setProgress({ done, total });
        // Estimated from the rate actually observed, and recomputed here
        // rather than during render — `Date.now()` in a render body is impure
        // and this is the only place the figure can honestly change.
        //
        // Withheld until a tenth of the file is through: the first chunk
        // carries the connection setup, so an estimate drawn from it reads
        // wildly high and then collapses, which is worse than no estimate.
        setRemaining(done / total < 0.1 ? null : describeRemaining(startedAt, done, total));
      }

      setResult({ written, duplicates });
      setStep("done");
    } catch {
      setError(
        `The import stopped partway. ${written.toLocaleString()} rows are saved — run it again to finish, already-imported numbers are skipped.`
      );
      setStep("map");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-8">
      <div
        className="animate-modal-fade fixed inset-0 bg-[#1e3a38]/45"
        onClick={step === "running" || step === "reading" ? undefined : onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Import into ${folder.name}`}
        className="animate-modal-pop relative z-10 grid max-h-full w-full max-w-[720px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-white shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="bg-[#4f9c99] px-6 py-4 text-white">
          <div className="text-[17px] font-medium">Import into {folder.name}</div>
          <p className="mt-0.5 text-[12.5px] text-white/85">
            {step === "map" && sheet
              ? `${fileName} — ${sheet.rows.length.toLocaleString()} rows`
              : "A CSV of this source's records."}
          </p>
        </div>

        <div className="teal-scrollbar min-h-0 space-y-4 overflow-y-auto px-6 py-5">
          {error && (
            <div role="alert" className="rounded-md border border-[#f0c4bd] bg-[#fdeeeb] px-4 py-3 text-[13px] text-[#a33a29]">
              {error}
            </div>
          )}

          {step === "pick" && (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#cfe2e0] bg-[#f7fbfa] px-6 py-12 text-center transition-colors hover:border-[#8cc3bf]">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#4f9c99" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <span className="text-[14.5px] text-[#2b3a39]">Choose a CSV file</span>
              <span className="text-[12.5px] text-[#7e918f]">
                Nothing is written until you confirm the columns.
              </span>
              <span className="text-[12px] text-[#9aacaa]">
                Large files are fine — 40,000 rows go in one pass, and take a few minutes.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
            </label>
          )}

          {step === "map" && sheet && prepared && (
            <>
              <div>
                <div className="text-[14.5px] text-[#2b3a39]">Match your columns</div>
                <p className="mt-0.5 text-[12.5px] text-[#7e918f]">
                  Each column in your file, and the folder field it goes into. Anything set to
                  &ldquo;Skip&rdquo; is not imported.
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-[#e0eeec]">
                {sheet.headers.map((header, index) => (
                  <div
                    key={header}
                    className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[#f0f6f5] px-4 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] text-[#2b3a39]">{header}</div>
                      <div className="truncate text-[12px] text-[#9aacaa]">
                        {sheet.rows[0]?.[index] || "—"}
                      </div>
                    </div>
                    <span className="text-[#c3d5d3]" aria-hidden>
                      →
                    </span>
                    <select
                      value={map[header] ?? ""}
                      aria-label={`Field for column ${header}`}
                      onChange={(e) => {
                        const key = e.target.value;
                        setMap((current) => {
                          const next = { ...current };
                          // One field can only receive one column.
                          if (key) {
                            for (const [other, assigned] of Object.entries(next)) {
                              if (assigned === key && other !== header) delete next[other];
                            }
                            next[header] = key;
                          } else {
                            delete next[header];
                          }
                          return next;
                        });
                      }}
                      className={SELECT}
                    >
                      <option value="">Skip this column</option>
                      {folder.fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                          {field.key === folder.roles.name ? "  (name)" : ""}
                          {field.key === folder.roles.phone ? "  (phone)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {(!nameMapped || !phoneMapped) && (
                <div className="rounded-md border border-[#f0e0c0] bg-[#fdf5e6] px-4 py-3 text-[13px] text-[#a5762a]">
                  Point a column at{" "}
                  {!nameMapped && <strong>{labelFor(folder.roles.name)}</strong>}
                  {!nameMapped && !phoneMapped && " and "}
                  {!phoneMapped && <strong>{labelFor(folder.roles.phone)}</strong>} to continue — a
                  record needs a name and a number.
                </div>
              )}

              <div className="rounded-lg bg-[#f2f8f7] px-4 py-3 text-[13px] text-[#3c4d4b]">
                <strong className="text-[#2f7d78]">{prepared.rows.length.toLocaleString()}</strong> of{" "}
                {sheet.rows.length.toLocaleString()} rows ready to import.
                {prepared.missingName.length > 0 && (
                  <div className="mt-1 text-[12.5px] text-[#9aacaa]">
                    {prepared.missingName.length} skipped — no name (line
                    {prepared.missingName.length === 1 ? " " : "s "}
                    {prepared.missingName.slice(0, 5).join(", ")}
                    {prepared.missingName.length > 5 ? "…" : ""})
                  </div>
                )}
                {prepared.missingPhone.length > 0 && (
                  <div className="mt-1 text-[12.5px] text-[#9aacaa]">
                    {prepared.missingPhone.length} skipped — no usable number (line
                    {prepared.missingPhone.length === 1 ? " " : "s "}
                    {prepared.missingPhone.slice(0, 5).join(", ")}
                    {prepared.missingPhone.length > 5 ? "…" : ""})
                  </div>
                )}
                {prepared.duplicateInFile.length > 0 && (
                  <div className="mt-1 text-[12.5px] text-[#9aacaa]">
                    {prepared.duplicateInFile.length} skipped — the same number appears earlier in
                    this file
                  </div>
                )}
              </div>

              {/* One import row is one Firestore write, and the free plan
                  allows 20,000 of them per day across the whole project. An
                  import past that ceiling does not fail — it stalls, and so
                  does everything else in the app until midnight Pacific. Say
                  so before the button is pressed, not after.

                  Shown for anything big enough to be worth planning around;
                  amber once it would not fit inside a day's free allowance. */}
              {cost.writes >= 1_000 && (
                <div
                  className={
                    cost.writes > FREE_TIER_DAILY_WRITES
                      ? "rounded-md border border-[#f0e0c0] bg-[#fdf5e6] px-4 py-3 text-[13px] text-[#a5762a]"
                      : "rounded-md border border-[#dceae8] bg-white px-4 py-3 text-[13px] text-[#5b6d6b]"
                  }
                >
                  <strong>
                    {cost.writes.toLocaleString()} database writes and{" "}
                    {cost.reads.toLocaleString()} reads
                  </strong>{" "}
                  — one write per record, which is Firestore&rsquo;s floor.
                  {cost.writes > FREE_TIER_DAILY_WRITES ? (
                    <>
                      {" "}
                      The free plan allows {FREE_TIER_DAILY_WRITES.toLocaleString()} writes a day
                      across the whole project, so <strong>this import does not fit in one
                      day</strong>: past the ceiling every save in the app stalls until midnight
                      US/Pacific. Either split it across days or move the project to the Blaze
                      pay-as-you-go plan, where it costs about ${cost.usd.toFixed(2)}.
                    </>
                  ) : (
                    <>
                      {" "}
                      That is {Math.round((cost.writes / FREE_TIER_DAILY_WRITES) * 100)}% of the free
                      plan&rsquo;s {FREE_TIER_DAILY_WRITES.toLocaleString()} writes a day, or about $
                      {cost.usd.toFixed(2)} on Blaze.
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {step === "reading" && (
            <div className="py-14 text-center">
              <div
                className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dceae8] border-t-[#3f8f8a]"
                aria-hidden
              />
              <div className="mt-4 text-[14.5px] text-[#2b3a39]">Reading {fileName}…</div>
              <p className="mt-1.5 text-[12.5px] text-[#7e918f]">
                A large file takes a moment to parse. Nothing has been written yet.
              </p>
            </div>
          )}

          {step === "running" && (
            <div className="py-10 text-center">
              <div className="text-[14.5px] text-[#2b3a39]">Importing…</div>
              <div className="mx-auto mt-4 h-2.5 w-full max-w-[420px] overflow-hidden rounded-full bg-[#eef4f3]">
                <div
                  className="h-full rounded-full bg-[#3f8f8a] transition-[width] duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-2 text-[12.5px] tabular-nums text-[#7e918f]">
                {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows · {percent}%
              </div>
              {/*
                A 40,000-row import runs for minutes. Without a remaining
                figure the only honest reading of a slow bar is "it has hung".
              */}
              {remaining && (
                <div className="mt-1 text-[12.5px] text-[#9aacaa]">About {remaining} left</div>
              )}
              <p className="mt-3 text-[12px] text-[#9aacaa]">Keep this window open until it finishes.</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f5f3] text-[#2f7d78]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div className="mt-3 text-[16px] text-[#2b3a39]">
                {result.written.toLocaleString()} record{result.written === 1 ? "" : "s"} imported
              </div>
              {result.duplicates > 0 && (
                <p className="mt-1.5 text-[13px] text-[#7e918f]">
                  {result.duplicates.toLocaleString()} skipped — already in this folder. Existing
                  rows were left exactly as they were.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#e6f1f0] bg-[#f7fbfa] px-6 py-4">
          {step === "map" && (
            <button
              type="button"
              onClick={() => {
                setStep("pick");
                setSheet(null);
                setError(null);
              }}
              className="rounded-full border border-[#cfe2e0] bg-white px-6 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9]"
            >
              Choose another file
            </button>
          )}
          {step !== "running" && step !== "reading" && (
            <button
              type="button"
              onClick={() => {
                if (step === "done" && result) {
                  onFinished(`${result.written.toLocaleString()} records imported into ${folder.name}.`);
                } else {
                  onClose();
                }
              }}
              className="rounded-full border border-[#cfe2e0] bg-white px-6 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9]"
            >
              {step === "done" ? "Done" : "Cancel"}
            </button>
          )}
          {step === "map" && (
            <button
              type="button"
              onClick={() => void run()}
              disabled={!prepared || prepared.rows.length === 0 || !nameMapped || !phoneMapped}
              className="rounded-full bg-[#3f8f8a] px-7 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
            >
              Import {prepared ? prepared.rows.length.toLocaleString() : 0} rows
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
