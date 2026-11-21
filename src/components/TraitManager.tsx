"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  getCatalog,
  getHealth,
  getMarkerCatalog,
  getMarkersFromGame,
  getTraitsFromGame,
  postMarkersToGame,
  postTraitsToGame,
  type CeCatalogResponse,
  type CeCatalogTrait,
  type CeHealth,
  type CeTraitsResponse,
} from "@/lib/ce-bridge";
import { parseOrcCsv, type OrcCsvAbilityRow } from "@/lib/orc-csv";
import { displayValue, readableLabel, traitLinkClass, traitRoles } from "@/lib/traits";
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

type SectionId = "markers" | "pickers";

/** SeiKur0 picker table exposes 56 slots; never exceed this in the editor. */
const MAX_PICKER_SLOTS = 56;
/** SeiKur0 marker table exposes entry 01–48. */
const MAX_MARKER_SLOTS = 48;
const PICKER_RAIL_ROWS = 28;
const PICKER_RAIL_COUNT = PICKER_RAIL_ROWS * 2;

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

function slotsToBaseline(list: ManagedSlot[]) {
  return JSON.stringify(
    list.map((s) => ({ name: s.name, address: s.address })),
  );
}

function slotsFromGame(
  data: CeTraitsResponse,
  byPicker: Map<string, Trait>,
): ManagedSlot[] {
  return data.traits.map((t) => ({
    id: makeId(),
    name: t.name,
    address: t.address,
    title: enrichTitle(t.name, byPicker),
  }));
}

type AbilityEditorOptions = {
  label: string;
  noun: string;
  byPicker: Map<string, Trait>;
  hardCap: number;
  fetchCatalog: () => Promise<{
    data?: CeCatalogResponse;
    error: string | null;
  }>;
  fetchFromGame: () => Promise<{
    data?: CeTraitsResponse;
    error: string | null;
  }>;
  postToGame: (
    traits: Array<{ address?: string; name?: string } | null>,
  ) => Promise<{
    data?: CeTraitsResponse;
    error: string | null;
    status: number;
  }>;
};

function useAbilityEditor({
  label,
  noun,
  byPicker,
  hardCap,
  fetchCatalog,
  fetchFromGame,
  postToGame,
}: AbilityEditorOptions) {
  const [slots, setSlots] = useState<ManagedSlot[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [catalog, setCatalog] = useState<CeCatalogTrait[]>([]);
  const [maxLength, setMaxLength] = useState(hardCap);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [draggingIds, setDraggingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [detailSlotId, setDetailSlotId] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const slotCap = Math.min(maxLength > 0 ? maxLength : hardCap, hardCap);
  const atCapacity = slots.length >= slotCap;

  const dirty = useMemo(() => {
    return baseline !== "" && slotsToBaseline(slots) !== baseline;
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

  const filteredCatalog = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((t) => {
      const title = enrichTitle(t.name, byPicker).toLowerCase();
      return t.name.toLowerCase().includes(q) || title.includes(q);
    });
  }, [catalog, pickerQuery, byPicker]);

  const clearSelectionState = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
    setDetailSlotId(null);
  }, []);

  const loadCatalog = useCallback(async () => {
    const { data, error } = await fetchCatalog();
    if (error || !data) {
      return {
        traits: [] as CeCatalogTrait[],
        error: error || `Failed to load ${noun} catalog`,
      };
    }
    setCatalog(data.traits);
    return { traits: data.traits, error: null };
  }, [fetchCatalog, noun]);

  const refreshFromGame = useCallback(async () => {
    const { data, error } = await fetchFromGame();
    if (error || !data) {
      return {
        ok: false,
        message: `${label}: ${error || `Failed to read ${noun}s`}`,
      };
    }
    const next = slotsFromGame(data, byPicker);
    setSlots(next);
    clearSelectionState();
    setMaxLength(data.max_length || hardCap);
    setBaseline(slotsToBaseline(next));
    return {
      ok: true,
      message: `Loaded ${next.length} ${noun}(s) from game.`,
    };
  }, [byPicker, clearSelectionState, fetchFromGame, hardCap, label, noun]);

  const applyToGame = useCallback(async () => {
    if (baseline === "" || slotsToBaseline(slots) === baseline) {
      return { ok: true, wrote: false, message: "" };
    }
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
    console.info(`[TraitManager] Apply ${label}`, {
      slotCount: slots.length,
      payload,
    });
    const { data, error, status } = await postToGame(payload);
    if (error || !data) {
      const msg = error || `Failed to write ${noun}s`;
      console.error(`[TraitManager] Apply ${label} failed`, {
        status,
        error: msg,
        data,
      });
      return {
        ok: false,
        wrote: false,
        message: `${label} apply failed (${status || "?"}): ${msg}`,
      };
    }
    const next = slotsFromGame(data, byPicker);
    setSlots(next);
    setBaseline(slotsToBaseline(next));
    return {
      ok: true,
      wrote: true,
      message: `Applied ${next.length} ${noun}(s).`,
    };
  }, [baseline, byPicker, label, noun, postToGame, slots]);

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

  function selectSlot(
    index: number,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) {
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

  function addSlot(trait?: CeCatalogTrait): string | null {
    if (slots.length >= slotCap) {
      setPickerOpenFor(null);
      setPickerQuery("");
      return `At capacity (${slotCap} ${noun} slots). Remove one before adding.`;
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
    return null;
  }

  function beginAdd(): string | null {
    if (atCapacity) {
      return `At capacity (${slotCap} ${noun} slots). Remove one before adding.`;
    }
    setPickerOpenFor(-1);
    setPickerQuery("");
    return null;
  }

  function removeDuplicateTraits(): string {
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
      return `No duplicate ${noun}s found.`;
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
    return `Removed ${removed} duplicate ${noun}(s); kept the first of each name.`;
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionAnchorId(null);
  }

  function closePicker() {
    setPickerOpenFor(null);
    setPickerQuery("");
  }

  function beginDrag(slotId: string) {
    let ids = selectedIds;
    if (!ids.has(slotId)) {
      ids = new Set([slotId]);
      setSelectedIds(ids);
      setSelectionAnchorId(slotId);
    }
    setDraggingIds(new Set(ids));
    setInsertAt(null);
  }

  function endDrag() {
    setDraggingIds(new Set());
    setInsertAt(null);
  }

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

  function importSelection(
    rows: CsvImportRow[],
    mode: "replace" | "append",
  ): string {
    const selected = rows.filter((r) => r.selected && !r.unresolved);
    if (selected.length === 0) {
      return `Select at least one resolved ${noun} to load.`;
    }
    if (mode === "append" && slots.length + selected.length > slotCap) {
      return `Appending ${noun}s would exceed capacity (${slots.length}+${selected.length} > ${slotCap}).`;
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
      clearSelectionState();
      return truncated > 0
        ? `Loaded ${mapped.length} ${noun}(s) from CSV (trimmed ${truncated} over the ${slotCap}-slot cap). Click Apply to Game to write.`
        : `Loaded ${mapped.length} ${noun}(s) from CSV. Click Apply to Game to write.`;
    }

    setSlots((current) => [...current, ...mapped].slice(0, slotCap));
    return `Appended ${mapped.length} ${noun}(s) from CSV. Click Apply to Game to write.`;
  }

  return {
    label,
    noun,
    slots,
    catalog,
    slotCap,
    hardCap,
    atCapacity,
    dirty,
    duplicateCount,
    selectedIds,
    selectedCount: selectedIds.size,
    draggingIds,
    insertAt,
    detailSlotId,
    pickerOpenFor,
    pickerQuery,
    filteredCatalog,
    byPicker,
    loadCatalog,
    refreshFromGame,
    applyToGame,
    clearSlot,
    removeSlot,
    selectSlot,
    setSlotTrait,
    addSlot,
    beginAdd,
    removeDuplicateTraits,
    clearSelection,
    closePicker,
    setPickerQuery,
    openPicker: (index: number) => {
      setPickerOpenFor(index);
      setPickerQuery("");
    },
    beginDrag,
    endDrag,
    updateInsertFromPoint,
    commitDrop,
    importSelection,
  };
}

type AbilityEditor = ReturnType<typeof useAbilityEditor>;

export function TraitManager({ traits }: TraitManagerProps) {
  const byPicker = useMemo(() => {
    const map = new Map<string, Trait>();
    for (const t of traits) {
      map.set(t.Picker, t);
    }
    return map;
  }, [traits]);

  const markers = useAbilityEditor({
    label: "Markers",
    noun: "marker",
    byPicker,
    hardCap: MAX_MARKER_SLOTS,
    fetchCatalog: getMarkerCatalog,
    fetchFromGame: getMarkersFromGame,
    postToGame: postMarkersToGame,
  });
  const pickers = useAbilityEditor({
    label: "Pickers",
    noun: "picker",
    byPicker,
    hardCap: MAX_PICKER_SLOTS,
    fetchCatalog: getCatalog,
    fetchFromGame: getTraitsFromGame,
    postToGame: postTraitsToGame,
  });

  const [health, setHealth] = useState<CeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);
  const [pickersOpen, setPickersOpen] = useState(true);
  const [sectionInView, setSectionInView] = useState<SectionId>("pickers");
  const [markerCsv, setMarkerCsv] = useState<CsvImportRow[]>([]);
  const [pickerCsv, setPickerCsv] = useState<CsvImportRow[]>([]);
  const [csvOrcName, setCsvOrcName] = useState<string | null>(null);
  const [csvDragOver, setCsvDragOver] = useState(false);

  const markersRef = useRef<HTMLElement>(null);
  const pickersRef = useRef<HTMLElement>(null);
  const viewLock = useRef<SectionId | null>(null);
  const visibleHeight = useRef({ markers: 0, pickers: 0 });

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

  useEffect(() => {
    void refreshHealth();
    void (async () => {
      const markerCatalog = await markers.loadCatalog();
      if (markerCatalog.error && /not found/i.test(markerCatalog.error)) {
        setStatus(
          "Marker catalog is unavailable. Re-run src/helpers/ce_bridge.lua in Cheat Engine, then reload this page.",
        );
      }
      await pickers.loadCatalog();
    })();
  }, [refreshHealth, markers.loadCatalog, pickers.loadCatalog]);

  useEffect(() => {
    const nodes = [markersRef.current, pickersRef.current].filter(
      (node): node is HTMLElement => Boolean(node),
    );
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section;
          if (id === "markers" || id === "pickers") {
            visibleHeight.current[id] = entry.intersectionRect.height;
          }
        }
        if (viewLock.current) return;
        const next: SectionId =
          visibleHeight.current.markers > visibleHeight.current.pickers
            ? "markers"
            : "pickers";
        setSectionInView(next);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const dirty = markers.dirty || pickers.dirty;
  const connected = health?.ok === true;

  async function refreshFromGame() {
    setBusy(true);
    setStatus(null);
    await refreshHealth();
    const markerResult = await markers.refreshFromGame();
    const pickerResult = await pickers.refreshFromGame();
    const markerMessage = /not found/i.test(markerResult.message)
      ? "Markers: re-run src/helpers/ce_bridge.lua in Cheat Engine, then refresh again."
      : markerResult.message;
    setStatus(`${markerMessage} ${pickerResult.message}`);
    setBusy(false);
  }

  async function applyToGame() {
    setBusy(true);
    setStatus(null);
    const messages: string[] = [];
    let wrote = false;
    if (markers.dirty) {
      const result = await markers.applyToGame();
      if (result.message) messages.push(result.message);
      wrote = wrote || result.wrote;
    }
    if (pickers.dirty) {
      const result = await pickers.applyToGame();
      if (result.message) messages.push(result.message);
      wrote = wrote || result.wrote;
    }
    if (messages.length === 0) {
      setStatus("Nothing to apply.");
    } else if (wrote) {
      setStatus(
        `${messages.join(" ")} If the army view looks right, advance time or change equipment to confirm they stick.`,
      );
    } else {
      setStatus(messages.join(" "));
    }
    await refreshHealth();
    setBusy(false);
  }

  function buildCsvRows(
    parsed: OrcCsvAbilityRow[],
    catalog: CeCatalogTrait[],
  ): CsvImportRow[] {
    const byName = new Map(catalog.map((t) => [t.name, t]));
    return parsed.map((row) => {
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
  }

  async function handleCsvFile(file: File) {
    setStatus(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("Please drop a .csv orc export.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseOrcCsv(text);
      const [markerCatalog, pickerCatalog] = await Promise.all([
        markers.catalog.length > 0
          ? Promise.resolve({ traits: markers.catalog, error: null })
          : markers.loadCatalog(),
        pickers.catalog.length > 0
          ? Promise.resolve({ traits: pickers.catalog, error: null })
          : pickers.loadCatalog(),
      ]);
      const markerRows = buildCsvRows(parsed.markers, markerCatalog.traits);
      const pickerRows = buildCsvRows(parsed.pickers, pickerCatalog.traits);
      setCsvOrcName(parsed.orcName);
      setMarkerCsv(markerRows);
      setPickerCsv(pickerRows);
      const unresolved =
        markerRows.filter((r) => r.unresolved).length +
        pickerRows.filter((r) => r.unresolved).length;
      const catalogNote =
        markerCatalog.error || pickerCatalog.error
          ? " Catalog lookup failed for one list, so those names stayed unresolved."
          : "";
      setStatus(
        unresolved > 0
          ? `Loaded ${markerRows.length} marker row(s) and ${pickerRows.length} picker row(s) from CSV · ${unresolved} unresolved against live catalogs (hex ignored).${catalogNote}`
          : `Loaded ${markerRows.length} marker row(s) and ${pickerRows.length} picker row(s) from CSV · all resolved against live catalogs.${catalogNote}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to parse CSV");
      setMarkerCsv([]);
      setPickerCsv([]);
      setCsvOrcName(null);
    }
  }

  function jumpTo(section: SectionId) {
    viewLock.current = section;
    setSectionInView(section);
    if (section === "markers") setMarkersOpen(true);
    else setPickersOpen(true);
    window.setTimeout(() => {
      const el =
        section === "markers" ? markersRef.current : pickersRef.current;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    window.setTimeout(() => {
      if (viewLock.current === section) viewLock.current = null;
    }, 900);
  }

  function loadCsv(section: SectionId, mode: "replace" | "append") {
    const message =
      section === "markers"
        ? markers.importSelection(markerCsv, mode)
        : pickers.importSelection(pickerCsv, mode);
    setStatus(message);
    if (section === "markers") setMarkersOpen(true);
    else setPickersOpen(true);
  }

  return (
    <div className="relative mx-auto w-full max-w-[110rem] px-4 pb-16">
      <div className="lg:grid lg:grid-cols-[minmax(9rem,1fr)_minmax(0,48rem)_minmax(18rem,24rem)] lg:gap-8">
        <div className="hidden lg:block" aria-hidden />

        <div className="min-w-0">
          <header className="pt-10 pb-6">
            <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
              Markers & Pickers
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
              Drag to reorder marker and picker traits.{" "}
              <span className="text-foreground/90">
                Ctrl/Cmd+click or Shift+click
              </span>{" "}
              to multi-select and move a group together. Drop an orc CSV to
              import either list. Markers start collapsed; both sections can
              stay open.
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

          <div className="sticky top-0 z-40 -mx-1 mb-6 bg-background/85 px-1 py-3 backdrop-blur-sm">
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>

          <div className="mb-6 flex gap-2 lg:hidden">
            <JumpButton
              active={sectionInView === "markers"}
              onClick={() => jumpTo("markers")}
            >
              Markers
            </JumpButton>
            <JumpButton
              active={sectionInView === "pickers"}
              onClick={() => jumpTo("pickers")}
            >
              Pickers
            </JumpButton>
          </div>

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
              Marker and picker names are matched to the live CE catalogs. CSV
              hex addresses are ignored so a different game launch cannot write
              stale pointers.
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

          {markerCsv.length > 0 || pickerCsv.length > 0 ? (
            <section className="mb-8 rounded-lg border border-line bg-ink/40 p-4">
              <h2 className="mb-4 text-sm font-medium text-foreground">
                CSV import{csvOrcName ? ` · ${csvOrcName}` : ""}
              </h2>
              <div className="space-y-6">
                <CsvGroup
                  title="Markers"
                  rows={markerCsv}
                  setRows={setMarkerCsv}
                  onLoad={(mode) => loadCsv("markers", mode)}
                />
                <CsvGroup
                  title="Pickers"
                  rows={pickerCsv}
                  setRows={setPickerCsv}
                  onLoad={(mode) => loadCsv("pickers", mode)}
                />
              </div>
            </section>
          ) : null}

          {status ? (
            <p className="mb-4 text-sm text-muted" role="status">
              {status}
            </p>
          ) : null}

          <AbilitySection
            editor={markers}
            open={markersOpen}
            onToggle={() => setMarkersOpen((open) => !open)}
            sectionRef={markersRef}
            busy={busy}
            onStatus={setStatus}
            emptyMessage="No markers loaded. Select an orc in the army menu, then Refresh from Game — or drop a CSV above."
          />
          <AbilitySection
            editor={pickers}
            open={pickersOpen}
            onToggle={() => setPickersOpen((open) => !open)}
            sectionRef={pickersRef}
            busy={busy}
            onStatus={setStatus}
            emptyMessage="No traits loaded. Select an orc in the army menu, then Refresh from Game — or drop a CSV above."
          />
        </div>

        <div className="hidden lg:block" aria-hidden />
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 hidden h-dvh lg:block">
        <div className="mx-auto grid h-full max-w-[110rem] grid-cols-[minmax(9rem,1fr)_minmax(0,48rem)_minmax(18rem,24rem)] gap-8 px-4">
          <div className="flex items-center justify-end">
            <div className="pointer-events-auto mr-[30%] flex flex-col gap-2">
              <JumpButton
                active={sectionInView === "markers"}
                onClick={() => jumpTo("markers")}
              >
                Markers
              </JumpButton>
              <JumpButton
                active={sectionInView === "pickers"}
                onClick={() => jumpTo("pickers")}
              >
                Pickers
              </JumpButton>
            </div>
          </div>
          <div />
          <aside className="flex items-center">
            <div className="pointer-events-auto max-h-[calc(100dvh-2rem)] w-full overflow-y-auto">
              <ReferenceRail
                sectionInView={sectionInView}
                markerSlots={markers.slots}
                pickerSlots={pickers.slots}
                byPicker={byPicker}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function JumpButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-md border border-ember bg-ember/15 px-2.5 py-1 text-xs font-medium text-foreground"
          : "rounded-md border border-line bg-raised/80 px-2.5 py-1 text-xs font-medium text-muted hover:border-ember/60 hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

function AbilitySection({
  editor,
  open,
  onToggle,
  sectionRef,
  busy,
  onStatus,
  emptyMessage,
}: {
  editor: AbilityEditor;
  open: boolean;
  onToggle: () => void;
  sectionRef: RefObject<HTMLElement | null>;
  busy: boolean;
  onStatus: (message: string) => void;
  emptyMessage: string;
}) {
  const sectionId = editor.noun === "marker" ? "markers" : "pickers";

  return (
    <section
      id={sectionId}
      data-section={sectionId}
      ref={sectionRef}
      className="mb-10 scroll-mt-6"
    >
      <div className="mb-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex items-center gap-3 text-left font-serif text-4xl tracking-tight text-foreground hover:text-ember sm:text-5xl"
        >
          <span
            className="inline-block text-[1.25em] leading-none text-muted"
            aria-hidden
          >
            {open ? "▾" : "▸"}
          </span>
          {editor.label}
          <span className="font-sans font-mono text-sm tracking-normal text-muted">
            {editor.slots.length}/{editor.slotCap}
          </span>
        </button>
        {open ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || editor.atCapacity}
              title={
                editor.atCapacity
                  ? `List is full (${editor.slotCap}/${editor.hardCap})`
                  : `Add a ${editor.noun}`
              }
              onClick={() => {
                const message = editor.beginAdd();
                if (message) onStatus(message);
              }}
              className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-50"
            >
              Add trait
              {editor.atCapacity
                ? ` (${editor.slotCap}/${editor.hardCap})`
                : ""}
            </button>
            <button
              type="button"
              disabled={busy || editor.duplicateCount === 0}
              title={
                editor.duplicateCount === 0
                  ? `No duplicate ${editor.noun} names`
                  : `Remove ${editor.duplicateCount} later duplicate(s)`
              }
              onClick={() => onStatus(editor.removeDuplicateTraits())}
              className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-50"
            >
              Remove duplicates
              {editor.duplicateCount > 0 ? ` (${editor.duplicateCount})` : ""}
            </button>
            {editor.selectedCount > 0 ? (
              <button
                type="button"
                onClick={() => editor.clearSelection()}
                className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground"
              >
                Clear selection ({editor.selectedCount})
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {open && editor.pickerOpenFor === -1 && !editor.atCapacity ? (
        <PickerPanel
          query={editor.pickerQuery}
          onQueryChange={editor.setPickerQuery}
          items={editor.filteredCatalog}
          byPicker={editor.byPicker}
          placeholder={`Search ${editor.noun} traits…`}
          onPick={(t) => {
            const message = editor.addSlot(t);
            if (message) onStatus(message);
          }}
          onClose={editor.closePicker}
          allowEmpty
          onEmpty={() => {
            const message = editor.addSlot();
            if (message) onStatus(message);
          }}
        />
      ) : null}

      {open ? (
        <ul
          className="flex flex-col"
          onDragOver={(e) => {
            if (editor.draggingIds.size > 0) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            editor.commitDrop(editor.insertAt);
          }}
        >
          {editor.slots.length === 0 ? (
            <li className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              {emptyMessage}
            </li>
          ) : null}

          {editor.slots.map((slot, index) => {
            const isSelected = editor.selectedIds.has(slot.id);
            const isDragging = editor.draggingIds.has(slot.id);
            const detailOpen = editor.detailSlotId === slot.id;
            const definition = slot.name
              ? editor.byPicker.get(slot.name)
              : undefined;
            return (
              <li key={slot.id} className="relative">
                {editor.draggingIds.size > 0 && editor.insertAt === index ? (
                  <div
                    className="pointer-events-none my-1 h-1 rounded-full bg-ember shadow-[0_0_8px_rgba(224,138,69,0.7)]"
                    aria-hidden
                  />
                ) : (
                  <div className="h-1" aria-hidden />
                )}
                <div
                  className={
                    detailOpen || isSelected || !slot.name
                      ? "overflow-hidden rounded-lg border border-ember bg-raised/70"
                      : "overflow-hidden rounded-lg border border-line bg-raised/70"
                  }
                >
                  <div
                    draggable
                    aria-selected={isSelected}
                    aria-expanded={detailOpen}
                    onClick={(e: MouseEvent) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("button")) return;
                      editor.selectSlot(index, e);
                    }}
                    onDragStart={(e) => {
                      editor.beginDrag(slot.id);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", slot.id);
                      } catch {
                        /* ignore */
                      }
                    }}
                    onDragEnd={() => editor.endDrag()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      editor.updateInsertFromPoint(index, e);
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
                      editor.commitDrop(
                        editor.insertAt !== null ? editor.insertAt : fallback,
                      );
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
                      <p className="font-medium text-foreground">
                        {slot.title}
                      </p>
                      <p className="truncate font-mono text-xs text-muted">
                        {slot.name || "(none)"} · {slot.address}
                      </p>
                      {editor.pickerOpenFor === index ? (
                        <PickerPanel
                          query={editor.pickerQuery}
                          onQueryChange={editor.setPickerQuery}
                          items={editor.filteredCatalog}
                          byPicker={editor.byPicker}
                          placeholder={`Search ${editor.noun} traits…`}
                          onPick={(t) => editor.setSlotTrait(index, t)}
                          onClose={editor.closePicker}
                        />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                        onClick={() => editor.openPicker(index)}
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                        onClick={() => editor.clearSlot(index)}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/40 hover:text-foreground"
                        onClick={() => editor.removeSlot(index)}
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
                {index === editor.slots.length - 1 &&
                editor.draggingIds.size > 0 &&
                editor.insertAt === editor.slots.length ? (
                  <div
                    className="pointer-events-none my-1 h-1 rounded-full bg-ember shadow-[0_0_8px_rgba(224,138,69,0.7)]"
                    aria-hidden
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function ReferenceRail({
  sectionInView,
  markerSlots,
  pickerSlots,
  byPicker,
}: {
  sectionInView: SectionId;
  markerSlots: ManagedSlot[];
  pickerSlots: ManagedSlot[];
  byPicker: Map<string, Trait>;
}) {
  const showingMarkers = sectionInView === "pickers";
  const specSuffixes = new Set<string>();
  const classSuffixes = new Set<string>();
  for (const slot of markerSlots) {
    const spec = slot.name?.match(/Specialization_(.+)$/);
    if (spec) specSuffixes.add(spec[1]);
    const cls = slot.name?.match(/^ClassMarker_(.+)$/);
    if (cls) classSuffixes.add(cls[1]);
  }

  function rowClass(name: string | null | undefined) {
    const base = name?.match(/^Picker_BaseStrength_(.+)$/);
    if (base) {
      if (specSuffixes.has(base[1])) return "text-violet-300";
      if (classSuffixes.has(base[1])) return "text-emerald-300";
    }
    return traitLinkClass(name);
  }

  const markerRows = markerSlots
    .filter((slot) => slot.name)
    .map((slot) => ({
      name: slot.name,
      label: readableLabel(slot.name, byPicker),
    }));

  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        {showingMarkers ? "Markers" : "Pickers"}
      </h2>
      <p className="mb-3 flex flex-wrap gap-x-3 text-[10px] font-medium tracking-wide uppercase">
        <span className="text-sky-300">Element</span>
        <span className="text-emerald-300">Class</span>
        <span className="text-violet-300">Specialization</span>
      </p>
      {showingMarkers ? (
        markerRows.length === 0 ? (
          <p className="text-xs text-muted">No markers selected.</p>
        ) : (
          <ul className="space-y-1">
            {markerRows.map((row, index) => (
              <li
                key={`${row.label}-${index}`}
                className={`truncate text-sm ${rowClass(row.name)}`}
                title={row.label}
              >
                {row.label}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="grid grid-flow-col grid-cols-2 grid-rows-[repeat(28,minmax(1.25rem,auto))] gap-x-3">
          {Array.from({ length: PICKER_RAIL_COUNT }, (_, index) => {
            const name = pickerSlots[index]?.name;
            const label = readableLabel(name, byPicker);
            return (
              <p
                key={index}
                className={`truncate text-xs leading-5 ${rowClass(name)}`}
                title={label || undefined}
              >
                {label || "\u00a0"}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CsvGroup({
  title,
  rows,
  setRows,
  onLoad,
}: {
  title: string;
  rows: CsvImportRow[];
  setRows: (update: (rows: CsvImportRow[]) => CsvImportRow[]) => void;
  onLoad: (mode: "replace" | "append") => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedCount = rows.filter((r) => r.selected && !r.unresolved).length;
  const unresolvedCount = rows.filter((r) => r.unresolved).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-base leading-none text-muted" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span>
            <span className="block text-sm font-medium text-foreground">{title}</span>
            <span className="block text-xs text-muted">
              {rows.length === 0
                ? "None in this CSV"
                : `${selectedCount} selected · ${unresolvedCount} unresolved`}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={rows.length === 0}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            onClick={() =>
              setRows((current) =>
                current.map((r) => ({
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
            disabled={rows.length === 0}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            onClick={() =>
              setRows((current) =>
                current.map((r) => ({ ...r, selected: false })),
              )
            }
          >
            Clear
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-foreground disabled:opacity-40"
            onClick={() => onLoad("replace")}
          >
            Replace list
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            className="rounded-md bg-ember px-2 py-1 text-xs font-medium text-ink disabled:opacity-40"
            onClick={() => onLoad("append")}
          >
            Append selected
          </button>
        </div>
      </div>
      {open && rows.length > 0 ? (
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
          {rows.map((row) => (
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
                    setRows((current) =>
                      current.map((r) =>
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
      ) : null}
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
  placeholder,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  items: CeCatalogTrait[];
  byPicker: Map<string, Trait>;
  onPick: (t: CeCatalogTrait) => void;
  onClose: () => void;
  allowEmpty?: boolean;
  onEmpty?: () => void;
  placeholder: string;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setActiveIndex((current) =>
        current < 0 ? 0 : Math.min(current + 1, items.length - 1),
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((current) => (current <= 0 ? -1 : current - 1));
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0 && items[activeIndex]) {
      e.preventDefault();
      onPick(items[activeIndex]);
    }
  }

  return (
    <div className="mt-3 mb-4 rounded-lg border border-line bg-ink/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-result-${activeIndex}` : undefined
          }
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
      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        className="max-h-56 overflow-y-auto"
      >
        {items.length === 0 ? (
          <li className="px-2 py-3 text-sm text-muted">No matches.</li>
        ) : null}
        {items.map((t, index) => {
          const active = index === activeIndex;
          return (
            <li key={`${t.name}-${t.address}`} role="presentation">
              <button
                id={`${listId}-result-${index}`}
                type="button"
                role="option"
                data-result-index={index}
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onPick(t)}
                className={
                  active
                    ? "w-full rounded-md bg-ember/20 px-2 py-2 text-left"
                    : "w-full rounded-md px-2 py-2 text-left hover:bg-raised"
                }
              >
                <span className="block text-sm text-foreground">
                  {enrichTitle(t.name, byPicker)}
                </span>
                <span className="block truncate font-mono text-xs text-muted">
                  {t.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
