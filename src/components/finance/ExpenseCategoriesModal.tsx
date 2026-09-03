"use client";

/**
 * Managing expense categories.
 *
 * The built-in list cannot be edited — those names are what the reports and
 * every historical record are written against, and letting somebody rename
 * "Rent" to "Misc" would rewrite a year of accounts from a settings dialog.
 * Categories the business has added are theirs to rename or remove.
 *
 * **Renaming moves the records with it.** Leaving old expenses pointing at a
 * name that no longer exists would split one category into two on every
 * report, which is worse than the write cost. **Removing does not**: it takes
 * the name out of the dropdown and leaves the history alone, because rewriting
 * records to tidy a list is not a trade worth making.
 */

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { getExpenseCategories, manageExpenseCategory } from "@/lib/clientActions";
import { Banner, F, PrimaryButton, fieldStyle } from "./financeChrome";

export function ExpenseCategoriesModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { getIdToken } = useAuth();

  const [all, setAll] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getExpenseCategories(token);
      if (cancelled) return;

      if (result.ok) {
        setAll(result.data.categories);
        setCustom(result.data.custom);
      } else {
        setError(result.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, nonce]);

  const run = async (
    action: "ADD" | "RENAME" | "REMOVE",
    name: string,
    renameTo?: string,
    message?: string
  ) => {
    setError(null);
    setBusy(true);
    const token = await getIdToken();
    const result = await manageExpenseCategory(token, action, name, renameTo);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAll(result.data.categories);
    setNonce((value) => value + 1);
    onChanged(
      message ??
        (result.data.moved
          ? `Renamed, and ${result.data.moved} expense${result.data.moved === 1 ? "" : "s"} moved with it.`
          : "Categories updated.")
    );
  };

  return (
    <OverlayPanel
      title="Expense categories"
      subtitle="Used by the form, the filters and every report"
      icon={<Tags size={18} color="#fff" />}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PrimaryButton onClick={onClose} tone="quiet">
            Done
          </PrimaryButton>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Add a category">
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <input
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              placeholder="Legal & professional"
              disabled={busy}
              style={{ ...fieldStyle, flex: "1 1 200px" }}
            />
            <PrimaryButton
              onClick={() => {
                const name = adding.trim();
                if (!name) return;
                setAdding("");
                void run("ADD", name, undefined, `"${name}" added.`);
              }}
              disabled={busy || !adding.trim()}
            >
              <Plus size={14} /> Add
            </PrimaryButton>
          </div>
        </OverlayCard>

        <OverlayCard title="Your categories" hint={custom.length === 0 ? "None yet" : undefined}>
          {custom.length === 0 ? (
            <p style={{ fontSize: 12.5, color: F.faint, lineHeight: 1.6 }}>
              Categories you add appear here and can be renamed or removed. The built-in ones below
              cannot be changed — the reports and every existing record are written against them.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {custom.map((name) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 9,
                    borderRadius: 10,
                    border: `1px solid ${F.line}`,
                    padding: "8px 11px",
                  }}
                >
                  {renaming?.from === name ? (
                    <>
                      <input
                        value={renaming.to}
                        onChange={(event) =>
                          setRenaming({ from: name, to: event.target.value })
                        }
                        disabled={busy}
                        style={{ ...fieldStyle, flex: "1 1 160px" }}
                      />
                      <button
                        type="button"
                        disabled={busy || !renaming.to.trim()}
                        onClick={() => {
                          const to = renaming.to.trim();
                          setRenaming(null);
                          void run("RENAME", name, to);
                        }}
                        style={{ ...iconButton, color: "#1f7a52" }}
                        aria-label="Save name"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        style={iconButton}
                        aria-label="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: "1 1 auto", fontSize: 13, fontWeight: 700, color: F.ink }}>
                        {name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRenaming({ from: name, to: name })}
                        style={iconButton}
                        aria-label={`Rename ${name}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run("REMOVE", name, undefined, `"${name}" removed.`)}
                        style={{ ...iconButton, color: "#a33a29" }}
                        aria-label={`Remove ${name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </OverlayCard>

        <OverlayCard title="Built in" hint="Cannot be changed">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {all
              .filter((name) => !custom.includes(name))
              .map((name) => (
                <span
                  key={name}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${F.line}`,
                    background: F.hair,
                    color: F.muted,
                    padding: "3px 11px",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {name}
                </span>
              ))}
          </div>
        </OverlayCard>

        {error && <Banner ok={false}>{error}</Banner>}
      </div>
    </OverlayPanel>
  );
}

const iconButton: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  border: `1px solid ${F.line}`,
  background: F.surface,
  color: F.muted,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};
