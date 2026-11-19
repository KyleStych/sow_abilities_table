"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import {
  getCatalog,
  getHealth,
  getTraitsFromGame,
  postTraitsToGame,
  type CeCatalogTrait,
  type CeHealth,
} from "@/lib/ce-bridge";
import { parseOrcCsv } from "@/lib/orc-csv";
import { displayValue, traitRoles } from "@/lib/traits";
import type { Trait } from "@/types/trait";

type ManagedSlot = {
  id: string;
  name: string | null;
  address: string;
  title: string;
};

type CsvImportRow = {
  id: string;
  slot: string;
  name: string;
  title: string;
  address: string | null;
  selected: boolean;
  unresolved: boolean;
};

type TraitManagerProps = {
  traits: Trait[];
};

/** SeiKur0 picker table exposes 56 slots; never exceed this in the editor. */
const MAX_PICKER_SLOTS = 56;

function enrichTitle(
  name: string | null,
  byPicker: Map<string, Trait>,
): string {
  if (!name) return "Empty slot";
  const meta = byPicker.get(name);
  if (meta?.["Game visual title"]) {
    return meta["Game visual title"];
  }
  return name;
}

function makeId() {
  return `slot-${Math.random().toString(36).slice(2, 10)}`;
}

/** Move a set of selected items (preserving their relative order) to insertAt. */
function moveSelectedTo(
  list: ManagedSlot[],
  selectedIds: Set<string>,
  insertAt: number,
): ManagedSlot[] {
  if (selectedIds.size === 0) return list;
  const moving = list.filter((s) => selectedIds.has(s.id));
  if (moving.length === 0) return list;
  const remaining = list.filter((s) => !selectedIds.has(s.id));
  const removedBefore = list
    .slice(0, insertAt)
    .filter((s) => selectedIds.has(s.id)).length;
  let target = insertAt - removedBefore;
  target = Math.max(0, Math.min(target, remaining.length));
  return [
    ...remaining.slice(0, target),
    ...moving,
    ...remaining.slice(target),
  ];
}

function sameOrder(a: ManagedSlot[], b: ManagedSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

export function TraitManager({ traits }: TraitManagerProps) {
  const byPicker = useMemo(() => {
    const map = new Map<string, Trait>();
    for (const t of traits) {
      map.set(t.Picker, t);
    }
    return map;
  }, [traits]);

  const [health, setHealth] = useState<CeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [slots, setSlots] = useState<ManagedSlot[]>([]);
  const [baseline, setBaseline] = useState<string>("");
  const [catalog, setCatalog] = useState<CeCatalogTrait[]>([]);
  const [maxLength, setMaxLength] = useState(56);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [draggingIds, setDraggingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [insertAt, setInsertAt] = useState<number | null>(null);
  /** Slot id whose trait definition panel is open (one at a time). */
  const [detailSlotId, setDetailSlotId] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const [csvOrcName, setCsvOrcName] = useState<string | null>(null);
  const [csvDragOver, setCsvDragOver] = useState(false);

  const slotCap = Math.min(
    maxLength > 0 ? maxLength : MAX_PICKER_SLOTS,
    MAX_PICKER_SLOTS,
  );
  const atCapacity = slots.length >= slotCap;

  const dirty = useMemo(() => {
    const current = JSON.stringify(
      slots.map((s) => ({ name: s.name, address: s.address })),
    );
    return baseline !== "" && current !== baseline;
  }, [slots, baseline]);

  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let extras = 0;
    for (const slot of slots) {
      if (!slot.name) continue;
      if (seen.has(slot.name)) extras += 1;
      else seen.add(slot.name);
    }
    return extras;
  }, [slots]);

  const refreshHealth = useCallback(async () => {
    const { data, error } = await getHealth();
    if (error || !data) {
      setHealth(null);
      setHealthError(error);
      return;
    }
    setHealth(data);
    setHealthError(data.ok ? null : data.error || "Bridge reported not ok");
  }, []);

  const loadCatalog = useCallback(async () => {
    const { data, error } = await getCatalog();
    if (error || !data) {
      setStatus(error || "Failed to load catalog");
      return;
    }
    setCatalog(data.traits);
  }, []);

  const refreshFromGame = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    await refreshHealth();
    const { data, error } = await getTraitsFromGame();
    if (error || !data) {
      setStatus(error || "Failed to read traits");
      setBusy(false);
      return;
    }
    const next: ManagedSlot[] = data.traits.map((t) => ({
      id: makeId(),
      name: t.name,
      address: t.address,
      title: enrichTitle(t.name, byPicker),
    }));
    setSlots(next);
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setDetailSlotId(null);
    setMaxLength(data.max_length || 56);
    setBaseline(
      JSON.stringify(next.map((s) => ({ name: s.name, address: s.address }))),
    );
    setStatus(`Loaded ${next.length} trait(s) from game.`);
    setBusy(false);
  }, [byPicker, refreshHealth]);

  const applyToGame = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    // Send both name and live address (from this session's Refresh).
    // Bridge resolves name via catalog when possible, else uses address —
    // same as copy/pasting the pointer in CE.
    const payload = slots.map((s) => {
      if (
        !s.name &&
        (!s.address || s.address === "0x0" || s.address === "0")
      ) {
        return null;
      }
      return {
        ...(s.name ? { name: s.name } : {}),
        ...(s.address && s.address !== "0x0" && s.address !== "0"
          ? { address: s.address }
          : {}),
      };
    });
    console.info("[TraitManager] Apply to Game", {
      slotCount: slots.length,
      payload,
    });
    const { data, error, status } = await postTraitsToGame(payload);
    if (error || !data) {
      const msg = error || "Failed to write traits";
      console.error("[TraitManager] Apply failed", { status, error: msg, data });
      setStatus(`Apply failed (${status || "?"}): ${msg}`);
      setBusy(false);
      return;
    }
    const next: ManagedSlot[] = data.traits.map((t) => ({
      id: makeId(),
      name: t.name,
      address: t.address,
      title: enrichTitle(t.name, byPicker),
    }));
    setSlots(next);
    setBaseline(
      JSON.stringify(next.map((s) => ({ name: s.name, address: s.address }))),
    );
    setStatus(
      `Applied ${next.length} trait(s). If the army view looks right, advance time or change equipment to confirm they stick (same as manual CE edits).`,
    );
    await refreshHealth();
    setBusy(false);
  }, [slots, byPicker, refreshHealth]);

  useEffect(() => {
    void refreshHealth();
    void loadCatalog();
  }, [refreshHealth, loadCatalog]);

  function clearSlot(index: number) {
    setSlots((current) =>
      current.map((slot, i) =>
        i === index
          ? {
              ...slot,
              name: null,
              address: "0x0",
              title: "Empty slot",
            }
          : slot,
      ),
    );
  }

  function removeSlot(index: number) {
    const id = slots[index]?.id;
    setSlots((current) => current.filter((_, i) => i !== index));
    if (id) {
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectionAnchorId === id) setSelectionAnchorId(null);
      if (detailSlotId === id) setDetailSlotId(null);
    }
  }

  function selectSlot(index: number, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    const slot = slots[index];
    if (!slot) return;
    const additive = e.metaKey || e.ctrlKey;

    if (e.shiftKey && selectionAnchorId) {
      const anchorIndex = slots.findIndex((s) => s.id === selectionAnchorId);
      if (anchorIndex >= 0) {
        const lo = Math.min(anchorIndex, index);
        const hi = Math.max(anchorIndex, index);
        const rangeIds = slots.slice(lo, hi + 1).map((s) => s.id);
        if (additive) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of rangeIds) next.add(id);
            return next;
          });
        } else {
          setSelectedIds(new Set(rangeIds));
        }
        return;
      }
    }

    if (additive) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(slot.id)) next.delete(slot.id);
        else next.add(slot.id);
        return next;
      });
      setSelectionAnchorId(slot.id);
      return;
    }

    // Plain click: select + toggle definition panel (one open at a time).
    if (detailSlotId === slot.id) {
      setDetailSlotId(null);
    } else {
      setDetailSlotId(slot.id);
    }
    setSelectedIds(new Set([slot.id]));
    setSelectionAnchorId(slot.id);
  }

  function setSlotTrait(index: number, trait: CeCatalogTrait) {
    setSlots((current) =>
      current.map((slot, i) =>
        i === index
          ? {
              ...slot,
              name: trait.name,
              address: trait.address,
              title: enrichTitle(trait.name, byPicker),
            }
          : slot,
      ),
    );
    setPickerOpenFor(null);
    setPickerQuery("");
  }

  function addSlot(trait?: CeCatalogTrait) {
    if (slots.length >= slotCap) {
      setStatus(`At capacity (${slotCap} slots). Remove a trait before adding.`);
      setPickerOpenFor(null);
      setPickerQuery("");
      return;
    }
    const name = trait?.name ?? null;
    const address = trait?.address ?? "0x0";
    setSlots((current) => {
      if (current.length >= slotCap) return current;
      return [
        ...current,
        {
          id: makeId(),
          name,
          address,
          title: enrichTitle(name, byPicker),
        },
      ];
    });
    setPickerOpenFor(null);
    setPickerQuery("");
  }

  function removeDuplicateTraits() {
    const seen = new Set<string>();
    const kept: ManagedSlot[] = [];
    let removed = 0;
    for (const slot of slots) {
      if (!slot.name) {
        kept.push(slot);
        continue;
      }
      if (seen.has(slot.name)) {
        removed += 1;
        continue;
      }
      seen.add(slot.name);
      kept.push(slot);
    }
    if (removed === 0) {
      setStatus("No duplicate traits found.");
      return;
    }
    const removedIds = new Set(
      slots.filter((s) => !kept.some((k) => k.id === s.id)).map((s) => s.id),
    );
    setSlots(kept);
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => !removedIds.has(id)));
      return next;
    });
    if (selectionAnchorId && removedIds.has(selectionAnchorId)) {
      setSelectionAnchorId(null);
    }
    if (detailSlotId && removedIds.has(detailSlotId)) {
      setDetailSlotId(null);
    }
    setStatus(
      `Removed ${removed} duplicate trait(s); kept the first of each name.`,
    );
  }

  async function handleCsvFile(file: File) {
    setStatus(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("Please drop a .csv orc export.");
      return;
    }
    if (catalog.length === 0) {
      await loadCatalog();
    }
    try {
      const text = await file.text();
      const parsed = parseOrcCsv(text);
      const liveCatalog =
        catalog.length > 0
          ? catalog
          : (await getCatalog()).data?.traits || [];
      const byName = new Map(liveCatalog.map((t) => [t.name, t]));

      const rows: CsvImportRow[] = parsed.pickers.map((row) => {
        const live = byName.get(row.name) || null;
        return {
          id: makeId(),
          slot: row.slot,
          name: row.name,
          title: enrichTitle(row.name, byPicker),
          address: live?.address ?? null,
          selected: Boolean(live),
          unresolved: !live,
        };
      });

      setCsvOrcName(parsed.orcName);
      setCsvRows(rows);
      const unresolved = rows.filter((r) => r.unresolved).length;
      setStatus(
        unresolved > 0
          ? `Loaded ${rows.length} picker row(s) from CSV · ${unresolved} unresolved against live catalog (hex ignored).`
          : `Loaded ${rows.length} picker row(s) from CSV · all resolved against live catalog.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to parse CSV");
      setCsvRows([]);
      setCsvOrcName(null);
    }
  }

  function loadCsvSelection(mode: "replace" | "append") {
    const selected = csvRows.filter((r) => r.selected && !r.unresolved);
    if (selected.length === 0) {
      setStatus("Select at least one resolved trait to load.");
      return;
    }
    if (mode === "append" && slots.length + selected.length > slotCap) {
      setStatus(
        `Appending would exceed capacity (${slots.length}+${selected.length} > ${slotCap}).`,
      );
      return;
    }

    let mapped: ManagedSlot[] = selected.map((r) => ({
      id: makeId(),
      name: r.name,
      address: r.address || "0x0",
      title: r.title,
    }));

    if (mode === "replace") {
      let truncated = 0;
      if (mapped.length > slotCap) {
        truncated = mapped.length - slotCap;
        mapped = mapped.slice(0, slotCap);
      }
      setSlots(mapped);
      setSelectedIds(new Set());
      setSelectionAnchorId(null);
      setDetailSlotId(null);
      setStatus(
        truncated > 0
          ? `Loaded ${mapped.length} trait(s) from CSV (trimmed ${truncated} over the ${slotCap}-slot cap). Click Apply to Game to write.`
          : `Loaded ${mapped.length} trait(s) from CSV into the editor. Click Apply to Game to write.`,
      );
    } else {
      setSlots((current) => [...current, ...mapped].slice(0, slotCap));
      setStatus(
        `Appended ${mapped.length} trait(s) from CSV. Click Apply to Game to write.`,
      );
    }
  }

  const filteredCatalog = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return catalog.slice(0, 80);
    return catalog
      .filter((t) => {
        const title = enrichTitle(t.name, byPicker).toLowerCase();
        return t.name.toLowerCase().includes(q) || title.includes(q);
      })
      .slice(0, 80);
  }, [catalog, pickerQuery, byPicker]);

  const connected = health?.ok === true;
  const csvSelectedCount = csvRows.filter(
    (r) => r.selected && !r.unresolved,
  ).length;

  function updateInsertFromPoint(index: number, e: DragEvent) {
    if (draggingIds.size === 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    let nextInsert = before ? index : index + 1;
    nextInsert = Math.max(0, Math.min(nextInsert, slots.length));
    const preview = moveSelectedTo(slots, draggingIds, nextInsert);
    if (sameOrder(preview, slots)) {
      setInsertAt(null);
      return;
    }
    setInsertAt(nextInsert);
  }

  function commitDrop(targetInsert: number | null) {
    if (draggingIds.size === 0 || targetInsert === null) {
      setDraggingIds(new Set());
      setInsertAt(null);
      return;
    }
    setSlots((current) => {
      const next = moveSelectedTo(current, draggingIds, targetInsert);
      return sameOrder(next, current) ? current : next;
    });
    setDraggingIds(new Set());
    setInsertAt(null);
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
          Trait Manager
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
          Drag to reorder picker traits.{" "}
          <span className="text-foreground/90">
            Ctrl/Cmd+click or Shift+click
          </span>{" "}
          to multi-select and move a group together. Drop an orc CSV to import
          traits selectively.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised/50 px-4 py-3">
        <span
          className={
            connected
              ? "inline-block size-2.5 rounded-full bg-emerald-500"
              : "inline-block size-2.5 rounded-full bg-red-500/80"
          }
          aria-hidden
        />
        <p className="text-sm text-muted">
          {connected
            ? `Connected · ${health?.count ?? 0} traits · orc ${health?.p_uruk}`
            : healthError || "Not connected to CE bridge"}
        </p>
        {dirty ? (
          <span className="text-xs font-medium uppercase tracking-wide text-ember">
            Unsaved
          </span>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void refreshFromGame()}
          className="rounded-md border border-line bg-raised px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-ember/60 disabled:opacity-50"
        >
          Refresh from Game
        </button>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void applyToGame()}
          className="rounded-md bg-ember px-3 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Apply to Game
        </button>
        <button
          type="button"
          disabled={busy || atCapacity}
          title={
            atCapacity
              ? `List is full (${slotCap}/${MAX_PICKER_SLOTS})`
              : "Add a trait"
          }
          onClick={() => {
            if (atCapacity) {
              setStatus(
                `At capacity (${slotCap} slots). Remove a trait before adding.`,
              );
              return;
            }
            setPickerOpenFor(-1);
            setPickerQuery("");
          }}
          className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-50"
        >
          Add trait{atCapacity ? ` (${slotCap}/${MAX_PICKER_SLOTS})` : ""}
        </button>
        <button
          type="button"
          disabled={busy || duplicateCount === 0}
          title={
            duplicateCount === 0
              ? "No duplicate trait names"
              : `Remove ${duplicateCount} later duplicate(s)`
          }
          onClick={() => removeDuplicateTraits()}
          className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-50"
        >
          Remove duplicates
          {duplicateCount > 0 ? ` (${duplicateCount})` : ""}
        </button>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setSelectionAnchorId(null);
            }}
            className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground"
          >
            Clear selection ({selectedCount})
          </button>
        ) : null}
      </div>

      {/* CSV drop zone */}
      <section
        className={
          csvDragOver
            ? "mb-6 rounded-lg border-2 border-dashed border-ember bg-ember/10 px-4 py-6"
            : "mb-6 rounded-lg border-2 border-dashed border-line bg-raised/30 px-4 py-6"
        }
        onDragEnter={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setCsvDragOver(true);
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setCsvDragOver(true);
        }}
        onDragLeave={() => setCsvDragOver(false)}
        onDrop={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setCsvDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleCsvFile(file);
        }}
      >
        <p className="text-sm font-medium text-foreground">
          Drop an orc CSV export here
        </p>
        <p className="mt-1 text-xs text-muted">
          Picker names are matched to the live CE catalog. CSV hex addresses are
          ignored so a different game launch cannot write stale pointers.
        </p>
        <label className="mt-3 inline-block cursor-pointer text-sm text-ember underline-offset-2 hover:underline">
          Or browse…
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCsvFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </section>

      {csvRows.length > 0 ? (
        <section className="mb-8 rounded-lg border border-line bg-ink/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-foreground">
                CSV import{csvOrcName ? ` · ${csvOrcName}` : ""}
              </h2>
              <p className="text-xs text-muted">
                {csvSelectedCount} selected ·{" "}
                {csvRows.filter((r) => r.unresolved).length} unresolved
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-foreground"
                onClick={() =>
                  setCsvRows((rows) =>
                    rows.map((r) => ({
                      ...r,
                      selected: !r.unresolved,
                    })),
                  )
                }
              >
                Select resolved
              </button>
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-foreground"
                onClick={() =>
                  setCsvRows((rows) =>
                    rows.map((r) => ({ ...r, selected: false })),
                  )
                }
              >
                Clear
              </button>
              <button
                type="button"
                disabled={csvSelectedCount === 0}
                className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-foreground disabled:opacity-40"
                onClick={() => loadCsvSelection("replace")}
              >
                Replace list
              </button>
              <button
                type="button"
                disabled={csvSelectedCount === 0}
                className="rounded-md bg-ember px-2 py-1 text-xs font-medium text-ink disabled:opacity-40"
                onClick={() => loadCsvSelection("append")}
              >
                Append selected
              </button>
            </div>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {csvRows.map((row) => (
              <li key={row.id}>
                <label
                  className={
                    row.unresolved
                      ? "flex cursor-not-allowed items-start gap-2 rounded-md px-2 py-1.5 opacity-50"
                      : "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-raised"
                  }
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={row.unresolved}
                    checked={row.selected}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setCsvRows((rows) =>
                        rows.map((r) =>
                          r.id === row.id ? { ...r, selected: checked } : r,
                        ),
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">
                      {row.title}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">
                      {row.slot} · {row.name}
                      {row.unresolved
                        ? " · not in live catalog"
                        : ` · ${row.address}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status ? (
        <p className="mb-4 text-sm text-muted" role="status">
          {status}
        </p>
      ) : null}

      {pickerOpenFor === -1 && !atCapacity ? (
        <PickerPanel
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          items={filteredCatalog}
          byPicker={byPicker}
          onPick={(t) => addSlot(t)}
          onClose={() => {
            setPickerOpenFor(null);
            setPickerQuery("");
          }}
          allowEmpty
          onEmpty={() => addSlot()}
        />
      ) : null}

      <ul
        className="flex flex-col"
        onDragOver={(e) => {
          if (draggingIds.size > 0) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          commitDrop(insertAt);
        }}
      >
        {slots.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            No traits loaded. Select an orc in the army menu, then Refresh from
            Game — or drop a CSV above.
          </li>
        ) : null}

        {slots.map((slot, index) => {
          const isSelected = selectedIds.has(slot.id);
          const isDragging = draggingIds.has(slot.id);
          const detailOpen = detailSlotId === slot.id;
          const definition = slot.name ? byPicker.get(slot.name) : undefined;
          return (
            <li key={slot.id} className="relative">
              {draggingIds.size > 0 && insertAt === index ? (
                <div
                  className="pointer-events-none my-1 h-1 rounded-full bg-ember shadow-[0_0_8px_rgba(224,138,69,0.7)]"
                  aria-hidden
                />
              ) : (
                <div className="h-1" aria-hidden />
              )}
              <div
                className={
                  detailOpen || isSelected
                    ? "overflow-hidden rounded-lg border border-ember bg-raised/70"
                    : "overflow-hidden rounded-lg border border-line bg-raised/70"
                }
              >
                <div
                  draggable
                  aria-selected={isSelected}
                  aria-expanded={detailOpen}
                  onClick={(e) => {
                    // Ignore clicks on action buttons
                    const target = e.target as HTMLElement;
                    if (target.closest("button")) return;
                    selectSlot(index, e);
                  }}
                  onDragStart={(e) => {
                    let ids = selectedIds;
                    if (!ids.has(slot.id)) {
                      ids = new Set([slot.id]);
                      setSelectedIds(ids);
                      setSelectionAnchorId(slot.id);
                    }
                    setDraggingIds(new Set(ids));
                    setInsertAt(null);
                    e.dataTransfer.effectAllowed = "move";
                    try {
                      e.dataTransfer.setData(
                        "text/plain",
                        [...ids].join(","),
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                  onDragEnd={() => {
                    setDraggingIds(new Set());
                    setInsertAt(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateInsertFromPoint(index, e);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    const fallback =
                      e.clientY < rect.top + rect.height / 2
                        ? index
                        : index + 1;
                    commitDrop(insertAt !== null ? insertAt : fallback);
                  }}
                  className={
                    isDragging
                      ? "flex cursor-grabbing items-start gap-3 px-3 py-3 opacity-40 select-none"
                      : isSelected
                        ? "flex cursor-grab items-start gap-3 bg-ember/10 px-3 py-3 transition-colors select-none"
                        : "flex cursor-grab items-start gap-3 px-3 py-3 transition-colors hover:bg-ember/5 select-none"
                  }
                >
                  <span
                    className="mt-1 select-none font-mono text-xs text-muted"
                    aria-hidden
                  >
                    ⋮⋮
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{slot.title}</p>
                    <p className="truncate font-mono text-xs text-muted">
                      {slot.name || "(none)"} · {slot.address}
                    </p>
                    {pickerOpenFor === index ? (
                      <PickerPanel
                        query={pickerQuery}
                        onQueryChange={setPickerQuery}
                        items={filteredCatalog}
                        byPicker={byPicker}
                        onPick={(t) => setSlotTrait(index, t)}
                        onClose={() => {
                          setPickerOpenFor(null);
                          setPickerQuery("");
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                      onClick={() => {
                        setPickerOpenFor(index);
                        setPickerQuery("");
                      }}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                      onClick={() => clearSlot(index)}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                      onClick={() => removeSlot(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {detailOpen ? (
                  <TraitDefinitionPanel
                    trait={definition}
                    pickerName={slot.name}
                  />
                ) : null}
              </div>
              {index === slots.length - 1 &&
              draggingIds.size > 0 &&
              insertAt === slots.length ? (
                <div
                  className="pointer-events-none my-1 h-1 rounded-full bg-ember shadow-[0_0_8px_rgba(224,138,69,0.7)]"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TraitDefinitionPanel({
  trait,
  pickerName,
}: {
  trait: Trait | undefined;
  pickerName: string | null;
}) {
  if (!pickerName) {
    return (
      <div className="border-t border-line px-3 py-3 text-sm text-muted">
        Empty slot — no trait definition.
      </div>
    );
  }
  if (!trait) {
    return (
      <div className="border-t border-line px-3 py-3 text-sm text-muted">
        No local definition for{" "}
        <span className="font-mono text-foreground">{pickerName}</span> in
        traits.json.
      </div>
    );
  }

  const roles = traitRoles(trait);
  return (
    <div className="border-t border-line px-3 py-4">
      <dl className="space-y-4">
        <div>
          <dt className="text-xs font-medium tracking-wide text-ember uppercase">
            Utility
          </dt>
          <dd className="mt-1 text-[15px] leading-relaxed text-foreground">
            {trait.Utility}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-ember uppercase">
            Offensive bonus
          </dt>
          <dd className="mt-1 text-[15px] leading-relaxed text-foreground">
            {trait["Offensive bonus"]}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-ember uppercase">
            Defensive bonus
          </dt>
          <dd className="mt-1 text-[15px] leading-relaxed text-foreground">
            {trait["Defensive bonus"]}
          </dd>
        </div>
      </dl>
      <dl className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">
            Class trait
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {displayValue(trait["Class trait"])}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">
            Tribe trait
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {displayValue(trait["Tribe trait"])}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">
            Recommended for
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {roles.map((role) => (
              <span
                key={role}
                className="rounded-full border border-line px-2 py-0.5 text-xs text-foreground"
              >
                {role}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function PickerPanel({
  query,
  onQueryChange,
  items,
  byPicker,
  onPick,
  onClose,
  allowEmpty,
  onEmpty,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  items: CeCatalogTrait[];
  byPicker: Map<string, Trait>;
  onPick: (t: CeCatalogTrait) => void;
  onClose: () => void;
  allowEmpty?: boolean;
  onEmpty?: () => void;
}) {
  return (
    <div className="mt-3 mb-4 rounded-lg border border-line bg-ink/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search picker traits…"
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none focus:border-ember"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-2 text-sm text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
      {allowEmpty && onEmpty ? (
        <button
          type="button"
          onClick={onEmpty}
          className="mb-2 w-full rounded-md border border-dashed border-line px-3 py-2 text-left text-sm text-muted hover:border-ember/50 hover:text-foreground"
        >
          Add empty slot
        </button>
      ) : null}
      <ul className="max-h-56 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-2 py-3 text-sm text-muted">No matches.</li>
        ) : null}
        {items.map((t) => (
          <li key={t.address}>
            <button
              type="button"
              onClick={() => onPick(t)}
              className="w-full rounded-md px-2 py-2 text-left hover:bg-raised"
            >
              <span className="block text-sm text-foreground">
                {enrichTitle(t.name, byPicker)}
              </span>
              <span className="block truncate font-mono text-xs text-muted">
                {t.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
