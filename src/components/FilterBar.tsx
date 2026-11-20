"use client";

import { useId, useState } from "react";
import type { FilterOption } from "@/lib/traits";

type FilterBarProps = {
  query: string;
  onQueryChange: (value: string) => void;
  classes: FilterOption[];
  tribes: FilterOption[];
  roles: FilterOption[];
  selectedClasses: string[];
  selectedTribes: string[];
  selectedRoles: string[];
  onToggleClass: (value: string) => void;
  onToggleTribe: (value: string) => void;
  onToggleRole: (value: string) => void;
  matchCount: number;
  totalCount: number;
  canClear: boolean;
  onClear: () => void;
};

export function FilterBar({
  query,
  onQueryChange,
  classes,
  tribes,
  roles,
  selectedClasses,
  selectedTribes,
  selectedRoles,
  onToggleClass,
  onToggleTribe,
  onToggleRole,
  matchCount,
  totalCount,
  canClear,
  onClear,
}: FilterBarProps) {
  return (
    <div className="sticky top-0 z-10 -mx-4 border-y border-line bg-ink/90 px-4 py-4 backdrop-blur-md">
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1 md:max-h-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block min-w-0 flex-1">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">
              Search
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Picker id or in-game title"
              className="mt-1.5 w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
            />
          </label>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <p aria-live="polite" className="text-sm text-muted">
              {matchCount} of {totalCount} traits
            </p>
            <button
              type="button"
              onClick={onClear}
              disabled={!canClear}
              className="rounded-lg border border-line px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember enabled:hover:border-ember disabled:opacity-40"
            >
              Clear filters
            </button>
          </div>
        </div>
        <ChipGroup
          label="Class"
          options={classes}
          selected={selectedClasses}
          onToggle={onToggleClass}
          defaultOpen
        />
        <ChipGroup
          label="Tribe"
          options={tribes}
          selected={selectedTribes}
          onToggle={onToggleTribe}
        />
        <ChipGroup
          label="Recommended for"
          options={roles}
          selected={selectedRoles}
          onToggle={onToggleRole}
        />
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  defaultOpen = false,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const panelId = useId();
  const visible = open
    ? options
    : options.filter((option) => selected.includes(option.value));

  return (
    <div>
      <button
        type="button"
        id={headingId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-md py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
      >
        <span className="text-xs font-medium tracking-wide text-muted uppercase">
          {label}
        </span>
        <Chevron open={open} />
      </button>
      <div
        id={panelId}
        role="group"
        aria-labelledby={headingId}
        className={
          visible.length === 0 ? "hidden" : "mt-1.5 flex flex-wrap gap-2"
        }
      >
        {visible.map((option) => {
          const pressed = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(option.value)}
              className={`rounded-full border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember ${
                pressed
                  ? "border-ember bg-ember font-medium text-ink"
                  : "border-line bg-raised text-foreground hover:border-ember"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
