"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCatalog,
  getHealth,
  getTraitsFromGame,
  postTraitsToGame,
  type CeCatalogTrait,
  type CeHealth,
} from "@/lib/ce-bridge";
import type { Trait } from "@/types/trait";

type ManagedSlot = {
  id: string;
  name: string | null;
  address: string;
  title: string;
};

type TraitManagerProps = {
  traits: Trait[];
};

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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const dirty = useMemo(() => {
    const current = JSON.stringify(
      slots.map((s) => ({ name: s.name, address: s.address })),
    );
    return baseline !== "" && current !== baseline;
  }, [slots, baseline]);

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
    const payload = slots.map((s) =>
      s.address === "0x0" || s.address === "0" || !s.address
        ? null
        : { address: s.address },
    );
    const { data, error } = await postTraitsToGame(payload);
    if (error || !data) {
      setStatus(error || "Failed to write traits");
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
    setStatus(`Applied ${next.length} trait(s) to game.`);
    await refreshHealth();
    setBusy(false);
  }, [slots, byPicker, refreshHealth]);

  useEffect(() => {
    void refreshHealth();
    void loadCatalog();
  }, [refreshHealth, loadCatalog]);

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setSlots((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

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
    setSlots((current) => current.filter((_, i) => i !== index));
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
    if (slots.length >= maxLength) {
      setStatus(`At capacity (${maxLength} slots).`);
      return;
    }
    const name = trait?.name ?? null;
    const address = trait?.address ?? "0x0";
    setSlots((current) => [
      ...current,
      {
        id: makeId(),
        name,
        address,
        title: enrichTitle(name, byPicker),
      },
    ]);
    setPickerOpenFor(null);
    setPickerQuery("");
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
          Trait Manager
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
          Drag to reorder the selected orc&apos;s picker traits, then Apply to
          write them through the local Cheat Engine bridge.
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
          disabled={busy || slots.length >= maxLength}
          onClick={() => {
            setPickerOpenFor(-1);
            setPickerQuery("");
          }}
          className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:border-ember/60 hover:text-foreground disabled:opacity-50"
        >
          Add trait
        </button>
      </div>

      {status ? (
        <p className="mb-4 text-sm text-muted" role="status">
          {status}
        </p>
      ) : null}

      {pickerOpenFor === -1 ? (
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

      <ul className="flex flex-col gap-2">
        {slots.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            No traits loaded. Select an orc in the army menu, then Refresh from
            Game.
          </li>
        ) : null}
        {slots.map((slot, index) => (
          <li key={slot.id}>
            <div
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) {
                  reorder(dragIndex, index);
                }
                setDragIndex(null);
              }}
              className={
                dragIndex === index
                  ? "flex cursor-grab items-start gap-3 rounded-lg border border-ember bg-raised px-3 py-3 opacity-70"
                  : "flex cursor-grab items-start gap-3 rounded-lg border border-line bg-raised/70 px-3 py-3 transition-colors hover:border-ember/40 active:cursor-grabbing"
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
          </li>
        ))}
      </ul>
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
