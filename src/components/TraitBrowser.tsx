"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { SortReloadButton } from "@/components/SortReloadButton";
import { TraitCard } from "@/components/TraitCard";
import { filterTraits, type FilterOption } from "@/lib/traits";
import type { Trait } from "@/types/trait";

type TraitBrowserProps = {
  traits: Trait[];
  classOptions: FilterOption[];
  tribeOptions: FilterOption[];
  roleOptions: FilterOption[];
};

export function TraitBrowser({
  traits,
  classOptions,
  tribeOptions,
  roleOptions,
}: TraitBrowserProps) {
  const [query, setQuery] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [tribes, setTribes] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);

  const matches = useMemo(
    () => filterTraits(traits, { query, classes, tribes, roles }),
    [traits, query, classes, tribes, roles],
  );

  const canClear =
    query.trim().length > 0 ||
    classes.length > 0 ||
    tribes.length > 0 ||
    roles.length > 0;

  function toggle(current: string[], value: string): string[] {
    return current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="pt-10 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
            Shadow of War Picker Traits
          </h1>
          <SortReloadButton />
        </div>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
          Each card explains one picker trait. The heading is the internal
          picker id, and the line under it is the in-game title. Open a card to
          read what the trait does and where it helps in a siege.
        </p>
      </header>
      <FilterBar
        query={query}
        onQueryChange={setQuery}
        classes={classOptions}
        tribes={tribeOptions}
        roles={roleOptions}
        selectedClasses={classes}
        selectedTribes={tribes}
        selectedRoles={roles}
        onToggleClass={(value) => setClasses((current) => toggle(current, value))}
        onToggleTribe={(value) => setTribes((current) => toggle(current, value))}
        onToggleRole={(value) => setRoles((current) => toggle(current, value))}
        matchCount={matches.length}
        totalCount={traits.length}
        canClear={canClear}
        onClear={() => {
          setQuery("");
          setClasses([]);
          setTribes([]);
          setRoles([]);
        }}
      />
      {matches.length === 0 ? (
        <p className="px-1 py-10 text-center text-muted">
          No traits match these filters.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {matches.map((trait) => (
            <li key={trait.Picker}>
              <TraitCard trait={trait} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
