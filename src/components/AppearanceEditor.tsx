"use client";

import {
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APPEARANCE_COLORS,
  APPEARANCE_FIELDS,
  AppearanceField,
  BODY_TYPES,
  BodyType,
  TAG_LIST_ID,
  WOUND_LIST_ID,
  appearanceFieldLocked,
  swapBodyTypeName,
  argbParts,
  toArgb,
} from "@/lib/appearance";
import { OrcCsvAbilityRow, parseOrcCsv } from "@/lib/orc-csv";
import {
  AppearanceColorValue,
  AppearanceFieldValue,
  AppearancePointer,
  AppearanceWriteBody,
  CeCatalogTrait,
  getAppearance,
  getAppearanceCatalog,
  postAppearance,
} from "@/lib/ce-bridge";

type Slot = AppearancePointer & { key: string; error?: string };

type SearchTarget =
  | { kind: "field"; id: string }
  | { kind: "tag"; index: number }
  | { kind: "wound"; index: number }
  | { kind: "add-tag" }
  | { kind: "add-wound" };

const buttonClass =
  "rounded-md border border-line px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-40";

let slotSerial = 0;

function nextSlot(pointer?: AppearancePointer): Slot {
  slotSerial += 1;
  return {
    key: `slot-${slotSerial}`,
    name: pointer?.name ?? null,
    address: pointer?.address ?? "0x0",
  };
}

function moveToGap<T>(items: T[], from: number, gap: number): T[] {
  if (from < 0 || from >= items.length || gap < 0 || gap > items.length) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(from, 1);
  const dest = from < gap ? gap - 1 : gap;
  next.splice(dest, 0, item);
  return next;
}

function visibleOptions(items: CeCatalogTrait[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items.length <= 40 ? items : [];
  }
  const out: CeCatalogTrait[] = [];
  for (const item of items) {
    if (item.name.toLowerCase().includes(q)) {
      out.push(item);
      if (out.length >= 40) break;
    }
  }
  return out;
}

function CatalogSearch({
  items,
  total,
  missing,
  query,
  onQueryChange,
  onPick,
  onClose,
  placeholder,
}: {
  items: CeCatalogTrait[];
  total: number;
  missing: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onPick: (item: CeCatalogTrait) => void;
  onClose: () => void;
  placeholder: string;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const visible = useMemo(
    () => visibleOptions(items, query),
    [items, query],
  );

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visible.length === 0) return;
      setActiveIndex((current) =>
        current < 0 ? 0 : Math.min(current + 1, visible.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? -1 : current - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && visible[activeIndex]) {
      event.preventDefault();
      onPick(visible[activeIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-ink/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-result-${activeIndex}` : undefined
          }
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none focus:border-ember"
        />
        <button type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
      {missing ? (
        <p className="px-1 py-2 text-sm text-muted">
          That game-database list was not found. Enable the cheat table Master
          Script, then refresh.
        </p>
      ) : total === 0 ? (
        <p className="px-1 py-2 text-sm text-muted">
          Options are still loading from the cheat table lists.
        </p>
      ) : (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="max-h-56 overflow-y-auto"
        >
          {visible.length === 0 ? (
            <li className="px-2 py-3 text-sm text-muted">
              {query.trim()
                ? "No matches."
                : `Type to search ${total} options. Down arrow highlights a match, Enter selects it.`}
            </li>
          ) : null}
          {visible.map((item, index) => {
            const active = index === activeIndex;
            return (
              <li key={`${item.name}-${item.address}`} role="presentation">
                <button
                  id={`${listId}-result-${index}`}
                  type="button"
                  role="option"
                  data-result-index={index}
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onPick(item)}
                  className={
                    active
                      ? "w-full rounded-md bg-ember/20 px-2 py-2 text-left font-mono text-sm text-foreground"
                      : "w-full rounded-md px-2 py-2 text-left font-mono text-sm text-foreground hover:bg-raised"
                  }
                >
                  {item.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function slotUnavailable(error?: string) {
  return Boolean(error?.toLowerCase().includes("null pointer"));
}

type CsvGroupId = "property" | "equipment" | "tag" | "wound" | "color" | "rarity";

type AppearanceCsvRow = {
  key: string;
  group: CsvGroupId;
  fieldId: string | null;
  slot: string;
  name: string;
  address: string | null;
  argb: string | null;
  selected: boolean;
  unresolved: boolean;
  unavailable: boolean;
  issue?: string;
};

let csvSerial = 0;

function normalizeArgb(value: string) {
  const clean = value.replace(/^0x/i, "").trim();
  return /^[0-9a-fA-F]{8}$/.test(clean) ? clean.toUpperCase() : null;
}

const CSV_GROUP_LABELS: Record<CsvGroupId, string> = {
  property: "Additional Properties",
  equipment: "Equipment slots",
  tag: "Tags",
  wound: "Wounds",
  color: "Colors",
  rarity: "Orc Rarity",
};

function PointerRow({
  label,
  listId,
  value,
  error,
  disabled,
  unavailable,
  locked,
  searching,
  onChange,
  onClear,
}: {
  label: string;
  listId: string;
  value: AppearancePointer;
  error?: string;
  disabled: boolean;
  unavailable?: boolean;
  locked?: boolean;
  searching: boolean;
  onChange: () => void;
  onClear: () => void;
}) {
  const empty = !value.name;
  const inert = unavailable || locked;
  const problem = Boolean(error) && !inert;
  return (
    <div
      className={
        unavailable
          ? "rounded-lg border border-line/70 bg-raised/20 px-3 py-3 opacity-55"
          : (empty && !locked) || problem
            ? "rounded-lg border border-ember bg-raised/40 px-3 py-3"
            : "rounded-lg border border-line bg-raised/40 px-3 py-3"
      }
      aria-disabled={inert || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={
              unavailable
                ? "text-sm font-medium text-muted"
                : "text-sm font-medium text-foreground"
            }
          >
            {label}
          </p>
          <p className="font-mono text-[11px] text-muted" title={listId}>
            {listId}
          </p>
          <p
            className={
              unavailable
                ? "mt-1 truncate font-mono text-sm text-muted"
                : "mt-1 truncate font-mono text-sm text-foreground"
            }
          >
            {unavailable
              ? "Not available for this orc"
              : value.name || "(none)"}
          </p>
          {locked ? (
            <p className="mt-1 text-xs text-muted">
              Memory pointer. This value is left unchanged.
            </p>
          ) : null}
          {unavailable || locked || !error ? null : (
            <p className="mt-1 text-xs text-ember">{error}</p>
          )}
        </div>
        {locked ? null : (
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || unavailable}
            onClick={onChange}
          >
            {searching ? "Searching" : "Change"}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={disabled || unavailable || empty}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

export function AppearanceEditor() {
  const [orc, setOrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Refresh from the game to load this orc.");
  const [baseline, setBaseline] = useState("");
  const [fields, setFields] = useState<Record<string, AppearanceFieldValue>>({});
  const [rarity, setRarity] = useState("");
  const [rarityError, setRarityError] = useState<string | null>(null);
  const [tags, setTags] = useState<Slot[]>([]);
  const [tagCapacity, setTagCapacity] = useState(16);
  const [tagError, setTagError] = useState<string | null>(null);
  const [wounds, setWounds] = useState<Slot[]>([]);
  const [woundCapacity, setWoundCapacity] = useState(8);
  const [woundError, setWoundError] = useState<string | null>(null);
  const [colors, setColors] = useState<AppearanceColorValue[]>(
    APPEARANCE_COLORS.map((color) => ({
      ...color,
      argb: "00000000",
    })),
  );
  const [catalogs, setCatalogs] = useState<Record<string, CeCatalogTrait[]>>({});
  const [missingLists, setMissingLists] = useState<string[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [search, setSearch] = useState<SearchTarget | null>(null);
  const [query, setQuery] = useState("");
  const [tagDrag, setTagDrag] = useState<number | null>(null);
  const [tagGap, setTagGap] = useState<number | null>(null);
  const [woundDrag, setWoundDrag] = useState<number | null>(null);
  const [woundGap, setWoundGap] = useState<number | null>(null);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [csvOrcName, setCsvOrcName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<AppearanceCsvRow[]>([]);

  const signature = useMemo(
    () =>
      JSON.stringify({
        fields: APPEARANCE_FIELDS.map((field) => fields[field.id] ?? null),
        rarity,
        tags: tags.map(({ name, address }) => ({ name, address })),
        wounds: wounds.map(({ name, address }) => ({ name, address })),
        colors: colors.map((color) => ({ id: color.id, argb: color.argb })),
      }),
    [colors, fields, rarity, tags, wounds],
  );
  const dirty = loaded && signature !== baseline;

  function applyResponse(data: {
    orc: string;
    rarity: string;
    rarityError?: string;
    fields: AppearanceFieldValue[];
    tags: { capacity: number; items: AppearancePointer[]; error?: string };
    wounds: { capacity: number; items: AppearancePointer[]; error?: string };
    colors: AppearanceColorValue[];
  }) {
    const nextFields: Record<string, AppearanceFieldValue> = {};
    for (const field of data.fields) {
      nextFields[field.id] = field;
    }
    const nextColors = APPEARANCE_COLORS.map((color) => {
      const found = data.colors.find((item) => item.id === color.id);
      return found ?? { ...color, argb: "00000000" };
    });
    const nextTags = data.tags.items.map((item) => nextSlot(item));
    const nextWounds = data.wounds.items.map((item) => nextSlot(item));
    setOrc(data.orc);
    setFields(nextFields);
    setRarity(data.rarity ?? "");
    setRarityError(data.rarityError ?? null);
    setTags(nextTags);
    setTagCapacity(data.tags.capacity || 16);
    setTagError(data.tags.error ?? null);
    setWounds(nextWounds);
    setWoundCapacity(data.wounds.capacity || 8);
    setWoundError(data.wounds.error ?? null);
    setColors(nextColors);
    setLoaded(true);
    setSearch(null);
    setQuery("");
    setBaseline(
      JSON.stringify({
        fields: APPEARANCE_FIELDS.map((field) => nextFields[field.id] ?? null),
        rarity: data.rarity ?? "",
        tags: nextTags.map(({ name, address }) => ({ name, address })),
        wounds: nextWounds.map(({ name, address }) => ({ name, address })),
        colors: nextColors.map((color) => ({ id: color.id, argb: color.argb })),
      }),
    );
  }

  async function refreshFromGame() {
    setBusy(true);
    setStatus("Reading appearance from the game…");
    const appearance = await getAppearance();
    if (appearance.error || !appearance.data?.orc) {
      setLoaded(false);
      setOrc(null);
      setBusy(false);
      const hint =
        appearance.status === 404
          ? " Re-execute src/helpers/ce_bridge.lua in Cheat Engine, then refresh."
          : "";
      setStatus(
        (appearance.error || "Appearance could not be read.") + hint,
      );
      return;
    }
    applyResponse(appearance.data);
    setStatus(`Loaded appearance for orc ${appearance.data.orc}. Loading dropdown lists…`);
    const catalog = await getAppearanceCatalog();
    setBusy(false);
    if (catalog.error || !catalog.data) {
      setCatalogReady(false);
      setStatus(
        `Loaded appearance for orc ${appearance.data.orc}. Dropdown lists failed: ${catalog.error || "no catalog"}. Re-execute ce_bridge.lua if this route is missing.`,
      );
      return;
    }
    setCatalogs(catalog.data.lists ?? {});
    setMissingLists(catalog.data.missing ?? []);
    setCatalogReady(true);
    const missing = catalog.data.missing?.length
      ? ` Missing lists: ${catalog.data.missing.join(", ")}.`
      : "";
    setStatus(`Loaded appearance for orc ${appearance.data.orc}.${missing}`);
  }

  async function applyToGame() {
    const body: AppearanceWriteBody = {
      rarity,
      fields: APPEARANCE_FIELDS.filter(
        (field) => !appearanceFieldLocked(field.id),
      ).map((field) => {
        const value = fields[field.id];
        return {
          id: field.id,
          name: value?.name ?? null,
          address: value?.address ?? "0x0",
        };
      }),
      tags: tags.map(({ name, address }) => ({ name, address })),
      wounds: wounds.map(({ name, address }) => ({ name, address })),
      colors: colors.map((color) => ({ id: color.id, argb: color.argb })),
    };
    setBusy(true);
    setStatus("Writing appearance to the game…");
    const result = await postAppearance(body);
    setBusy(false);
    if (result.error || !result.data?.orc) {
      setStatus(result.error || "Apply failed.");
      return;
    }
    applyResponse(result.data);
    setStatus(`Applied appearance to orc ${result.data.orc}.`);
  }

  function fieldValue(field: AppearanceField): AppearanceFieldValue {
    return (
      fields[field.id] ?? {
        id: field.id,
        name: null,
        address: "0x0",
      }
    );
  }

  function setField(id: string, pointer: AppearancePointer) {
    setFields((current) => ({
      ...current,
      [id]: { id, name: pointer.name, address: pointer.address },
    }));
    setSearch(null);
    setQuery("");
  }

  function openSearch(target: SearchTarget) {
    setSearch(target);
    setQuery("");
  }

  function searchListId(target: SearchTarget | null) {
    if (!target) return "";
    if (target.kind === "tag" || target.kind === "add-tag") return TAG_LIST_ID;
    if (target.kind === "wound" || target.kind === "add-wound") return WOUND_LIST_ID;
    return APPEARANCE_FIELDS.find((field) => field.id === target.id)?.listId ?? "";
  }

  function pick(item: CeCatalogTrait) {
    if (!search) return;
    const pointer = { name: item.name, address: item.address };
    if (search.kind === "field") setField(search.id, pointer);
    if (search.kind === "tag") {
      setTags((current) =>
        current.map((slot, index) =>
          index === search.index ? { ...slot, ...pointer, error: undefined } : slot,
        ),
      );
    }
    if (search.kind === "wound") {
      setWounds((current) =>
        current.map((slot, index) =>
          index === search.index ? { ...slot, ...pointer, error: undefined } : slot,
        ),
      );
    }
    if (search.kind === "add-tag") setTags((current) => [...current, nextSlot(pointer)]);
    if (search.kind === "add-wound") {
      setWounds((current) => [...current, nextSlot(pointer)]);
    }
    setSearch(null);
    setQuery("");
  }

  function matchCatalog(
    listId: string,
    name: string,
    lists: Record<string, CeCatalogTrait[]>,
  ) {
    if (!name) return { address: "0x0", unresolved: false };
    const found = (lists[listId] ?? []).find((item) => item.name === name);
    if (!found) return { address: null, unresolved: true };
    return { address: found.address, unresolved: false };
  }

  function buildCsvRows(
    parsed: ReturnType<typeof parseOrcCsv>,
    lists: Record<string, CeCatalogTrait[]>,
    currentFields: Record<string, AppearanceFieldValue>,
    rarityBlocked: boolean,
  ) {
    const rows: AppearanceCsvRow[] = [];
    const pushField = (
      group: "property" | "equipment",
      row: OrcCsvAbilityRow,
    ) => {
      const field = APPEARANCE_FIELDS.find(
        (item) => item.section === group && item.label === row.slot,
      );
      if (!field || appearanceFieldLocked(field.id)) return;
      const unavailable = slotUnavailable(currentFields[field.id]?.error);
      const resolved = matchCatalog(field.listId, row.name, lists);
      rows.push({
        key: `csv-${csvSerial++}`,
        group,
        fieldId: field.id,
        slot: field.label,
        name: row.name,
        address: resolved.address,
        argb: null,
        selected: !unavailable && !resolved.unresolved,
        unresolved: resolved.unresolved,
        unavailable,
      });
    };

    if (parsed.rarity !== null) {
      rows.push({
        key: `csv-${csvSerial++}`,
        group: "rarity",
        fieldId: "rarity",
        slot: "Orc Rarity (visual)",
        name: parsed.rarity,
        address: null,
        argb: null,
        selected: !rarityBlocked,
        unresolved: false,
        unavailable: rarityBlocked,
      });
    }
    for (const row of parsed.properties) pushField("property", row);
    for (const row of parsed.equipment) pushField("equipment", row);
    for (const row of parsed.tags) {
      const resolved = matchCatalog(TAG_LIST_ID, row.name, lists);
      rows.push({
        key: `csv-${csvSerial++}`,
        group: "tag",
        fieldId: null,
        slot: row.slot,
        name: row.name,
        address: resolved.address,
        argb: null,
        selected: !resolved.unresolved,
        unresolved: resolved.unresolved,
        unavailable: false,
      });
    }
    for (const row of parsed.wounds) {
      const resolved = matchCatalog(WOUND_LIST_ID, row.name, lists);
      rows.push({
        key: `csv-${csvSerial++}`,
        group: "wound",
        fieldId: null,
        slot: row.slot,
        name: row.name,
        address: resolved.address,
        argb: null,
        selected: !resolved.unresolved,
        unresolved: resolved.unresolved,
        unavailable: false,
      });
    }
    parsed.colors.forEach((row, index) => {
      const spec = APPEARANCE_COLORS[index];
      if (!spec) return;
      const argb = normalizeArgb(row.name) || normalizeArgb(row.hexValue);
      rows.push({
        key: `csv-${csvSerial++}`,
        group: "color",
        fieldId: spec.id,
        slot: spec.label,
        name: argb ?? row.name,
        address: null,
        argb,
        selected: Boolean(argb),
        unresolved: !argb,
        unavailable: false,
      });
    });
    return rows;
  }

  async function handleCsvFile(file: File) {
    const text = await file.text();
    const parsed = parseOrcCsv(text);
    let lists = catalogs;
    if (!catalogReady) {
      const result = await getAppearanceCatalog();
      if (result.data) {
        lists = result.data.lists;
        setCatalogs(lists);
        setMissingLists(result.data.missing ?? []);
        setCatalogReady(true);
      }
    }
    const rows = buildCsvRows(parsed, lists, fields, Boolean(rarityError));
    setCsvOrcName(parsed.orcName);
    setCsvRows(rows);
    const unmatched = rows.filter((row) => row.unresolved).length;
    const blocked = rows.filter((row) => row.unavailable).length;
    setStatus(
      `Read ${file.name}${parsed.orcName ? ` (${parsed.orcName})` : ""}: ${rows.length} appearance value(s). ${unmatched} unmatched, ${blocked} unavailable on this orc. Trait Level Offset was ignored.`,
    );
  }

  function loadCsvGroup(
    group: CsvGroupId,
    mode: "replace" | "append" = "replace",
  ) {
    const chosen = csvRows.filter(
      (row) =>
        (row.group === group || (group === "property" && row.group === "rarity")) &&
        row.selected &&
        !row.unresolved &&
        !row.unavailable,
    );
    if (chosen.length === 0) {
      setStatus(`No ${CSV_GROUP_LABELS[group]} rows selected.`);
      return;
    }
    if (group === "property" || group === "equipment") {
      setFields((current) => {
        const next = { ...current };
        for (const row of chosen) {
          if (!row.fieldId || appearanceFieldLocked(row.fieldId)) continue;
          if (row.group === "rarity") continue;
          next[row.fieldId] = {
            id: row.fieldId,
            name: row.name || null,
            address: row.address || "0x0",
          };
        }
        return next;
      });
      const rarityRow = chosen.find((row) => row.group === "rarity");
      if (rarityRow) setRarity(rarityRow.name);
    } else if (group === "color") {
      setColors((current) =>
        current.map((color) => {
          const row = chosen.find((item) => item.fieldId === color.id);
          return row?.argb ? { ...color, argb: row.argb } : color;
        }),
      );
    } else if (group === "tag") {
      const slots = chosen.map((row) =>
        nextSlot({ name: row.name, address: row.address || "0x0" }),
      );
      setTags((current) =>
        (mode === "append" ? [...current, ...slots] : slots).slice(0, tagCapacity),
      );
    } else if (group === "wound") {
      const slots = chosen.map((row) =>
        nextSlot({ name: row.name, address: row.address || "0x0" }),
      );
      setWounds((current) =>
        (mode === "append" ? [...current, ...slots] : slots).slice(0, woundCapacity),
      );
    }
    setStatus(
      mode === "append"
        ? `Appended ${chosen.length} ${CSV_GROUP_LABELS[group]} into the editor. Apply to Game writes them.`
        : `Loaded ${chosen.length} ${CSV_GROUP_LABELS[group]} into the editor. Apply to Game writes them.`,
    );
  }

  async function applyBodyType(target: BodyType) {
    setBusy(true);
    setStatus(`Checking ${target} names against the live lists…`);
    let lists = catalogs;
    let missing = missingLists;
    if (!catalogReady) {
      const result = await getAppearanceCatalog();
      if (result.data) {
        lists = result.data.lists ?? {};
        missing = result.data.missing ?? [];
        setCatalogs(lists);
        setMissingLists(missing);
        setCatalogReady(true);
      }
    }

    const translate = (listId: string, renamed: string) => {
      if (missing.includes(listId) || !lists[listId]) {
        return {
          address: "0x0",
          error: `No ${target} record named ${renamed}. ${listId} is not loaded.`,
        };
      }
      const found = lists[listId].find((item) => item.name === renamed);
      if (!found) {
        return {
          address: "0x0",
          error: `No ${target} record named ${renamed}`,
        };
      }
      return { address: found.address, error: undefined as string | undefined };
    };

    let updated = 0;
    const misses: string[] = [];

    if (loaded) {
      const nextFields = { ...fields };
      for (const field of APPEARANCE_FIELDS) {
        if (appearanceFieldLocked(field.id)) continue;
        const value = fields[field.id];
        if (!value?.name || slotUnavailable(value.error)) continue;
        const renamed = swapBodyTypeName(value.name, target);
        if (!renamed) continue;
        updated += 1;
        const resolved = translate(field.listId, renamed);
        if (resolved.error) misses.push(`${field.label}: ${renamed}`);
        nextFields[field.id] = {
          id: field.id,
          name: renamed,
          address: resolved.address,
          ...(resolved.error ? { error: resolved.error } : {}),
        };
      }
      setFields(nextFields);

      const retargetSlots = (slots: Slot[], listId: string, noun: string) =>
        slots.map((slot) => {
          if (!slot.name) return slot;
          const renamed = swapBodyTypeName(slot.name, target);
          if (!renamed) return slot;
          updated += 1;
          const resolved = translate(listId, renamed);
          if (resolved.error) misses.push(`${noun}: ${renamed}`);
          return {
            ...slot,
            name: renamed,
            address: resolved.address,
            error: resolved.error,
          };
        });
      setTags(retargetSlots(tags, TAG_LIST_ID, "tag"));
      setWounds(retargetSlots(wounds, WOUND_LIST_ID, "wound"));

      if (rarity) {
        const renamedRarity = swapBodyTypeName(rarity, target);
        if (renamedRarity) {
          setRarity(renamedRarity);
          updated += 1;
        }
      }
    }

    let csvUpdated = 0;
    if (csvRows.length > 0) {
      setCsvRows(
        csvRows.map((row) => {
          if (row.group === "color" || !row.name) return row;
          const renamed = swapBodyTypeName(row.name, target);
          if (!renamed) return row;
          csvUpdated += 1;
          if (row.group === "rarity") {
            return { ...row, name: renamed, issue: undefined };
          }
          const listId =
            row.group === "tag"
              ? TAG_LIST_ID
              : row.group === "wound"
                ? WOUND_LIST_ID
                : APPEARANCE_FIELDS.find((field) => field.id === row.fieldId)?.listId;
          if (!listId) return { ...row, name: renamed };
          const resolved = translate(listId, renamed);
          if (resolved.error) misses.push(`${row.slot}: ${renamed}`);
          return {
            ...row,
            name: renamed,
            address: resolved.error ? null : resolved.address,
            unresolved: Boolean(resolved.error),
            selected: row.unavailable || Boolean(resolved.error)
              ? false
              : row.unresolved
                ? true
                : row.selected,
            issue: resolved.error,
          };
        }),
      );
    }

    setBusy(false);
    if (updated === 0 && csvUpdated === 0) {
      setStatus(`No Slim, Stk, or Buff names to change to ${target}.`);
      return;
    }
    const parts = [
      updated > 0 ? `${updated} loaded name${updated === 1 ? "" : "s"}` : "",
      csvUpdated > 0 ? `${csvUpdated} CSV name${csvUpdated === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const missNote =
      misses.length === 0
        ? ""
        : ` ${misses.length} ${misses.length === 1 ? "has" : "have"} no ${target} record: ${misses.slice(0, 4).join("; ")}${misses.length > 4 ? `; and ${misses.length - 4} more` : ""}. Apply to Game rejects unknown names.`;
    setStatus(`Set body type to ${target}. Updated ${parts.join(" and ")}.${missNote}`);
  }

  const activeListId = searchListId(search);
  const activeCatalog = catalogs[activeListId] ?? [];

  const propertyFields = APPEARANCE_FIELDS.filter((field) => field.section === "property");
  const equipmentFields = APPEARANCE_FIELDS.filter(
    (field) => field.section === "equipment",
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
          Appearance
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Additional Properties and Equipment / Looks, including Tags, Wounds,
          and Colors. Options come from the game-database lists the cheat table
          binds to each dropdown. These selections have no trait definitions.
          Tags and Wounds can be reordered. Every other field stays in its
          table position. Trait Level Offset is a memory pointer and stays
          unchanged.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised/50 px-4 py-3">
        <span
          className={
            orc
              ? "inline-block size-2.5 rounded-full bg-emerald-500"
              : "inline-block size-2.5 rounded-full bg-red-500/80"
          }
          aria-hidden
        />
        <p className="text-sm text-muted">
          {orc ? `Connected · orc ${orc}` : "Not loaded"}
          {catalogReady ? "" : loaded ? " · dropdown lists unavailable" : ""}
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
        <p className="mt-3 text-sm text-muted">{status}</p>
      </div>

      <section
        className={
          csvDragOver
            ? "mb-6 rounded-lg border-2 border-dashed border-ember bg-ember/10 px-4 py-6"
            : "mb-6 rounded-lg border-2 border-dashed border-line bg-raised/30 px-4 py-6"
        }
        onDragEnter={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          setCsvDragOver(true);
        }}
        onDragOver={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          setCsvDragOver(true);
        }}
        onDragLeave={() => setCsvDragOver(false)}
        onDrop={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          setCsvDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleCsvFile(file);
        }}
      >
        <p className="text-sm font-medium text-foreground">
          Drop an orc CSV export here
        </p>
        <p className="mt-1 text-xs text-muted">
          Names are matched to the live cheat-table lists. Hex addresses are
          ignored. Trait Level Offset is not imported, and slots this orc does
          not have stay unchanged.
        </p>
        <label className="mt-3 inline-block cursor-pointer text-sm text-ember underline-offset-2 hover:underline">
          Or browse…
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleCsvFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </section>

      <section className="mb-6 rounded-lg border border-line bg-raised/40 px-4 py-4">
        <label htmlFor="body-type" className="block text-sm font-medium text-foreground">
          Body type
        </label>
        <p className="mt-1 text-xs text-muted">
          Replaces Slim, Stk, or Buff in every loaded appearance name, and in a
          CSV import when one is open. A name with no matching record is
          highlighted.
        </p>
        <select
          id="body-type"
          value=""
          disabled={busy || (!loaded && csvRows.length === 0)}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "Slim" || value === "Stk" || value === "Buff") {
              void applyBodyType(value);
            }
          }}
          className="mt-3 w-full max-w-xs rounded-md border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none focus:border-ember disabled:opacity-50"
        >
          <option value="">Swap to…</option>
          {BODY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </section>

      {csvRows.length > 0 ? (
        <AppearanceCsvPanel
          orcName={csvOrcName}
          rows={csvRows}
          disabled={busy || !loaded}
          hint={
            loaded
              ? null
              : "Refresh from Game before loading these into the editor."
          }
          onToggle={(key, selected) =>
            setCsvRows((current) =>
              current.map((row) => (row.key === key ? { ...row, selected } : row)),
            )
          }
          onUncheckAll={() =>
            setCsvRows((current) =>
              current.map((row) => ({ ...row, selected: false })),
            )
          }
          onLoad={loadCsvGroup}
          onClearSection={(group) =>
            setCsvRows((current) =>
              current.map((row) =>
                row.group === group || (group === "property" && row.group === "rarity")
                  ? { ...row, selected: false }
                  : row,
              ),
            )
          }
        />
      ) : null}

      <section className="mb-10">
        <h2 className="font-serif text-3xl text-foreground">Additional Properties</h2>
        <div className="mt-4 flex flex-col gap-3">
          {propertyFields.map((field) => {
            const value = fieldValue(field);
            const locked = appearanceFieldLocked(field.id);
            const open = !locked && search?.kind === "field" && search.id === field.id;
            return (
              <div key={field.id}>
                <PointerRow
                  label={field.label}
                  listId={field.listId}
                  value={value}
                  error={value.error}
                  disabled={!loaded || busy}
                  locked={locked}
                  searching={open}
                  onChange={() => openSearch({ kind: "field", id: field.id })}
                  onClear={() => setField(field.id, { name: null, address: "0x0" })}
                />
                {open ? (
                  <CatalogSearch
                    items={activeCatalog}
                    total={activeCatalog.length}
                    missing={missingLists.includes(field.listId)}
                    query={query}
                    onQueryChange={setQuery}
                    onPick={pick}
                    onClose={() => setSearch(null)}
                    placeholder={`Search ${field.label}…`}
                  />
                ) : null}
              </div>
            );
          })}
          <label className="rounded-lg border border-line bg-raised/40 px-3 py-3">
            <span className="text-sm font-medium text-foreground">
              Orc Rarity (visual)
            </span>
            <span className="mt-1 block font-mono text-[11px] text-muted">
              String on the orc, not a dropdown
            </span>
            <input
              value={rarity}
              disabled={!loaded || busy}
              maxLength={63}
              onChange={(event) => setRarity(event.target.value)}
              className="mt-2 w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-ember disabled:opacity-50"
            />
            {rarityError ? (
              <span className="mt-1 block text-xs text-ember">{rarityError}</span>
            ) : null}
          </label>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-3xl text-foreground">Equipment / Looks</h2>

        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-lg font-medium text-foreground">Tags</h3>
              <p className="font-mono text-[11px] text-muted">{TAG_LIST_ID}</p>
            </div>
            <p className="text-sm text-muted">
              {tags.length} / {tagCapacity}
            </p>
          </div>
          {tagError ? <p className="mb-2 text-sm text-ember">{tagError}</p> : null}
          <ReorderList
            slots={tags}
            dragging={tagDrag}
            gap={tagGap}
            disabled={!loaded || busy || Boolean(tagError)}
            noun="tag"
            emptyLabel="No tags yet."
            search={search}
            query={query}
            catalog={catalogs[TAG_LIST_ID] ?? []}
            missing={missingLists.includes(TAG_LIST_ID)}
            onQuery={setQuery}
            onPick={pick}
            onCloseSearch={() => setSearch(null)}
            onSearch={(index) => openSearch({ kind: "tag", index })}
            onClear={(index) =>
              setTags((current) =>
                current.map((slot, slotIndex) =>
                  slotIndex === index
                    ? { ...slot, name: null, address: "0x0", error: undefined }
                    : slot,
                ),
              )
            }
            onRemove={(index) =>
              setTags((current) => current.filter((_, slotIndex) => slotIndex !== index))
            }
            onDragStart={setTagDrag}
            onGap={setTagGap}
            onDrop={(gap) => {
              if (tagDrag === null) return;
              setTags((current) => moveToGap(current, tagDrag, gap));
              setTagDrag(null);
              setTagGap(null);
            }}
            onDragEnd={() => {
              setTagDrag(null);
              setTagGap(null);
            }}
          />
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            disabled={!loaded || busy || Boolean(tagError) || tags.length >= tagCapacity}
            onClick={() => openSearch({ kind: "add-tag" })}
          >
            Add tag
          </button>
          {search?.kind === "add-tag" ? (
            <CatalogSearch
              items={catalogs[TAG_LIST_ID] ?? []}
              total={(catalogs[TAG_LIST_ID] ?? []).length}
              missing={missingLists.includes(TAG_LIST_ID)}
              query={query}
              onQueryChange={setQuery}
              onPick={pick}
              onClose={() => setSearch(null)}
              placeholder="Search tags…"
            />
          ) : null}
        </div>

        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-lg font-medium text-foreground">Wounds</h3>
              <p className="font-mono text-[11px] text-muted">{WOUND_LIST_ID}</p>
            </div>
            <p className="text-sm text-muted">
              {wounds.length} / {woundCapacity}
            </p>
          </div>
          {woundError ? <p className="mb-2 text-sm text-ember">{woundError}</p> : null}
          <ReorderList
            slots={wounds}
            dragging={woundDrag}
            gap={woundGap}
            disabled={!loaded || busy || Boolean(woundError)}
            noun="wound"
            emptyLabel="No wounds yet."
            search={search}
            query={query}
            catalog={catalogs[WOUND_LIST_ID] ?? []}
            missing={missingLists.includes(WOUND_LIST_ID)}
            onQuery={setQuery}
            onPick={pick}
            onCloseSearch={() => setSearch(null)}
            onSearch={(index) => openSearch({ kind: "wound", index })}
            onClear={(index) =>
              setWounds((current) =>
                current.map((slot, slotIndex) =>
                  slotIndex === index
                    ? { ...slot, name: null, address: "0x0", error: undefined }
                    : slot,
                ),
              )
            }
            onRemove={(index) =>
              setWounds((current) =>
                current.filter((_, slotIndex) => slotIndex !== index),
              )
            }
            onDragStart={setWoundDrag}
            onGap={setWoundGap}
            onDrop={(gap) => {
              if (woundDrag === null) return;
              setWounds((current) => moveToGap(current, woundDrag, gap));
              setWoundDrag(null);
              setWoundGap(null);
            }}
            onDragEnd={() => {
              setWoundDrag(null);
              setWoundGap(null);
            }}
          />
          <button
            type="button"
            className={`${buttonClass} mt-3`}
            disabled={
              !loaded || busy || Boolean(woundError) || wounds.length >= woundCapacity
            }
            onClick={() => openSearch({ kind: "add-wound" })}
          >
            Add wound
          </button>
          {search?.kind === "add-wound" ? (
            <CatalogSearch
              items={catalogs[WOUND_LIST_ID] ?? []}
              total={(catalogs[WOUND_LIST_ID] ?? []).length}
              missing={missingLists.includes(WOUND_LIST_ID)}
              query={query}
              onQueryChange={setQuery}
              onPick={pick}
              onClose={() => setSearch(null)}
              placeholder="Search wounds…"
            />
          ) : null}
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-medium text-foreground">Colors</h3>
          <p className="mt-1 text-sm text-muted">
            Each swatch writes an ARGB hex value, alpha first, such as FF6DA9E8.
            The unnamed rows keep the cheat table&apos;s &quot;? color&quot; labels
            and stay in offset order.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {colors.map((color) => {
              const parts = argbParts(color.argb);
              return (
                <div
                  key={color.id}
                  className="rounded-lg border border-line bg-raised/40 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {color.label}
                      </p>
                      <p className="font-mono text-[11px] text-muted">
                        +{color.offset}
                      </p>
                    </div>
                    <p className="font-mono text-sm text-foreground">{color.argb}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <input
                      type="color"
                      aria-label={`${color.label} color`}
                      disabled={!loaded || busy}
                      value={parts.rgb}
                      onChange={(event) => {
                        const argb = toArgb(event.target.value, parts.alpha);
                        setColors((current) =>
                          current.map((item) =>
                            item.id === color.id ? { ...item, argb } : item,
                          ),
                        );
                      }}
                      className="h-10 w-14 cursor-pointer rounded border border-line bg-transparent disabled:opacity-40"
                    />
                    <label className="flex min-w-48 flex-1 items-center gap-3 text-xs text-muted">
                      Alpha {parts.alpha.toString(16).padStart(2, "0").toUpperCase()}
                      <input
                        type="range"
                        min={0}
                        max={255}
                        disabled={!loaded || busy}
                        value={parts.alpha}
                        aria-label={`${color.label} alpha`}
                        onChange={(event) => {
                          const argb = toArgb(
                            parts.rgb,
                            Number(event.target.value),
                          );
                          setColors((current) =>
                            current.map((item) =>
                              item.id === color.id ? { ...item, argb } : item,
                            ),
                          );
                        }}
                        className="w-full accent-[#e08a45]"
                      />
                    </label>
                  </div>
                  {color.error ? (
                    <p className="mt-2 text-xs text-ember">{color.error}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-medium text-foreground">Equipment slots</h3>
          <p className="mt-1 text-sm text-muted">
            These stay in cheat-table order. Item, model, and appearance rows
            are separate fixed fields.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {equipmentFields.map((field) => {
              const value = fieldValue(field);
              const unavailable = slotUnavailable(value.error);
              const open =
                !unavailable && search?.kind === "field" && search.id === field.id;
              return (
                <div key={field.id}>
                  <PointerRow
                    label={field.label}
                    listId={field.listId}
                    value={value}
                    error={value.error}
                    disabled={!loaded || busy}
                    unavailable={unavailable}
                    searching={open}
                    onChange={() => {
                      if (unavailable) return;
                      openSearch({ kind: "field", id: field.id });
                    }}
                    onClear={() => {
                      if (unavailable) return;
                      setField(field.id, { name: null, address: "0x0" });
                    }}
                  />
                  {open ? (
                    <CatalogSearch
                      items={activeCatalog}
                      total={activeCatalog.length}
                      missing={missingLists.includes(field.listId)}
                      query={query}
                      onQueryChange={setQuery}
                      onPick={pick}
                      onClose={() => setSearch(null)}
                      placeholder={`Search ${field.label}…`}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReorderList({
  slots,
  dragging,
  gap,
  disabled,
  noun,
  emptyLabel,
  search,
  query,
  catalog,
  missing,
  onQuery,
  onPick,
  onCloseSearch,
  onSearch,
  onClear,
  onRemove,
  onDragStart,
  onGap,
  onDrop,
  onDragEnd,
}: {
  slots: Slot[];
  dragging: number | null;
  gap: number | null;
  disabled: boolean;
  noun: string;
  emptyLabel: string;
  search: SearchTarget | null;
  query: string;
  catalog: CeCatalogTrait[];
  missing: boolean;
  onQuery: (value: string) => void;
  onPick: (item: CeCatalogTrait) => void;
  onCloseSearch: () => void;
  onSearch: (index: number) => void;
  onClear: (index: number) => void;
  onRemove: (index: number) => void;
  onDragStart: (index: number) => void;
  onGap: (gap: number) => void;
  onDrop: (gap: number) => void;
  onDragEnd: () => void;
}) {
  return (
    <ul
      className="flex flex-col"
      onDragOver={(event) => {
        if (dragging !== null) event.preventDefault();
      }}
    >
      {slots.length === 0 ? (
        <li className="rounded-lg border border-dashed border-ember px-4 py-6 text-center text-sm text-muted">
          {emptyLabel}
        </li>
      ) : null}
      {slots.map((slot, index) => {
        const open =
          (noun === "tag" && search?.kind === "tag" && search.index === index) ||
          (noun === "wound" && search?.kind === "wound" && search.index === index);
        return (
          <li key={slot.key} className="relative">
            {dragging !== null && gap === index ? (
              <div className="my-1 h-1 rounded-full bg-ember" aria-hidden />
            ) : (
              <div className="h-1" aria-hidden />
            )}
            <div
              className={
                slot.error || !slot.name
                  ? "rounded-lg border border-ember bg-raised/70"
                  : "rounded-lg border border-line bg-raised/70"
              }
            >
              <div
                draggable={!disabled}
                onDragStart={(event) => {
                  onDragStart(index);
                  event.dataTransfer.effectAllowed = "move";
                  try {
                    event.dataTransfer.setData("text/plain", slot.key);
                  } catch {
                    /* ignore */
                  }
                }}
                onDragEnd={onDragEnd}
                onDragOver={(event) => {
                  event.preventDefault();
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  onGap(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  const nextGap =
                    event.clientY < rect.top + rect.height / 2 ? index : index + 1;
                  onDrop(nextGap);
                }}
                className={
                  dragging === index
                    ? "flex cursor-grabbing items-start gap-3 px-3 py-3 opacity-40"
                    : "flex cursor-grab items-start gap-3 px-3 py-3"
                }
              >
                <span className="mt-1 font-mono text-xs text-muted" aria-hidden>
                  ⋮⋮
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-foreground">
                    {slot.name || "(none)"}
                  </p>
                  {slot.error ? (
                    <p className="mt-1 text-xs text-ember">{slot.error}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled}
                    onClick={() => onSearch(index)}
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled || !slot.name}
                    onClick={() => onClear(index)}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {open ? (
                <div className="px-3 pb-3">
                  <CatalogSearch
                    items={catalog}
                    total={catalog.length}
                    missing={missing}
                    query={query}
                    onQueryChange={onQuery}
                    onPick={onPick}
                    onClose={onCloseSearch}
                    placeholder={`Search ${noun}s…`}
                  />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
      {dragging !== null && gap === slots.length ? (
        <li className="my-1 h-1 rounded-full bg-ember" aria-hidden />
      ) : null}
    </ul>
  );
}

const CSV_SECTIONS: { id: CsvGroupId; append?: boolean; also?: CsvGroupId }[] = [
  { id: "property", also: "rarity" },
  { id: "equipment" },
  { id: "tag", append: true },
  { id: "wound", append: true },
  { id: "color" },
];

function AppearanceCsvPanel({
  orcName,
  rows,
  disabled,
  hint,
  onToggle,
  onUncheckAll,
  onLoad,
  onClearSection,
}: {
  orcName: string | null;
  rows: AppearanceCsvRow[];
  disabled: boolean;
  hint: string | null;
  onToggle: (key: string, selected: boolean) => void;
  onUncheckAll: () => void;
  onLoad: (group: CsvGroupId, mode?: "replace" | "append") => void;
  onClearSection: (group: CsvGroupId) => void;
}) {
  const [open, setOpen] = useState<Partial<Record<CsvGroupId, boolean>>>({});

  return (
    <div className="mb-8 rounded-lg border border-line bg-raised/40 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          CSV import{orcName ? ` · ${orcName}` : ""}
        </p>
        <button type="button" className={buttonClass} onClick={onUncheckAll}>
          Uncheck all
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {hint ||
          "Selected rows load into the editor. Apply to Game writes them. Unmatched names and unavailable slots stay unchecked."}
      </p>
      <div className="mt-4 flex flex-col gap-5">
        {CSV_SECTIONS.map((section) => {
          const sectionRows = rows.filter(
            (row) => row.group === section.id || row.group === section.also,
          );
          if (sectionRows.length === 0) return null;
          const expanded = open[section.id] ?? false;
          const selectedCount = sectionRows.filter((row) => row.selected).length;
          return (
            <div key={section.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((current) => ({
                      ...current,
                      [section.id]: !expanded,
                    }))
                  }
                  className="flex items-center gap-2 text-left text-sm font-medium text-foreground"
                >
                  <span className="text-base leading-none text-muted" aria-hidden>
                    {expanded ? "▾" : "▸"}
                  </span>
                  {CSV_GROUP_LABELS[section.id]}
                  <span className="font-sans text-xs font-normal text-muted">
                    {selectedCount}/{sectionRows.length}
                  </span>
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={disabled}
                    onClick={() => onLoad(section.id, "replace")}
                  >
                    {section.append ? "Replace list" : "Load selected"}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={selectedCount === 0}
                    onClick={() => onClearSection(section.id)}
                  >
                    Clear selections
                  </button>
                  {section.append ? (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={disabled}
                      onClick={() => onLoad(section.id, "append")}
                    >
                      Append selected
                    </button>
                  ) : null}
                </div>
              </div>
              {expanded ? (
              <ul className="mt-2 flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
                {sectionRows.map((row) => (
                  <li
                    key={row.key}
                    className={
                      row.unresolved || row.issue
                        ? "flex items-start gap-2 rounded-md bg-ember/10 px-2 py-1 text-sm"
                        : "flex items-start gap-2 text-sm"
                    }
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={row.selected}
                      disabled={row.unresolved || row.unavailable}
                      onChange={(event) => onToggle(row.key, event.target.checked)}
                    />
                    <span className="min-w-0 text-foreground">
                      <span className="text-muted">{row.slot}: </span>
                      {row.name || "(none)"}
                      {row.issue ? (
                        <span className="text-ember"> · {row.issue}</span>
                      ) : row.unresolved ? (
                        <span className="text-ember"> · not in the live list</span>
                      ) : null}
                      {row.unavailable ? (
                        <span className="text-muted"> · not available for this orc</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
