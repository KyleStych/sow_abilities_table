import type { Trait } from "@/types/trait";

export const NONE = "";

export type FilterOption = {
  value: string;
  label: string;
};

export type TraitFilters = {
  query: string;
  classes: string[];
  tribes: string[];
  roles: string[];
};

const ROLE_ORDER = [
  "Assault Leaders",
  "Overlord",
  "Throne Room Bodyguards",
  "Victory Point Defenders",
  "Warchiefs",
  "Wall Defense Warchiefs",
];

function withNoneFirst(values: string[]): FilterOption[] {
  const unique = [...new Set(values)];
  unique.sort((a, b) => {
    if (a === NONE) return -1;
    if (b === NONE) return 1;
    return a.localeCompare(b);
  });
  return unique.map((value) => ({
    value,
    label: value === NONE ? "None" : value,
  }));
}

export function traitRoles(trait: Trait): string[] {
  return trait["Recommended for"]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getClassOptions(traits: Trait[]): FilterOption[] {
  return withNoneFirst(traits.map((trait) => trait["Class trait"]));
}

export function getTribeOptions(traits: Trait[]): FilterOption[] {
  return withNoneFirst(traits.map((trait) => trait["Tribe trait"]));
}

export function getRoleOptions(traits: Trait[]): FilterOption[] {
  const found = new Set(traits.flatMap(traitRoles));
  const ordered = ROLE_ORDER.filter((role) => found.has(role));
  const extras = [...found]
    .filter((role) => !ROLE_ORDER.includes(role))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...extras].map((role) => ({ value: role, label: role }));
}

export function filterTraits(list: Trait[], filters: TraitFilters): Trait[] {
  const query = filters.query.trim().toLowerCase();

  return list.filter((trait) => {
    if (query) {
      const haystack = `${trait.Picker} ${trait["Game visual title"]}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (
      filters.classes.length > 0 &&
      !filters.classes.includes(trait["Class trait"])
    ) {
      return false;
    }

    if (
      filters.tribes.length > 0 &&
      !filters.tribes.includes(trait["Tribe trait"])
    ) {
      return false;
    }

    if (
      filters.roles.length > 0 &&
      !traitRoles(trait).some((role) => filters.roles.includes(role))
    ) {
      return false;
    }

    return true;
  });
}

export function displayValue(value: string): string {
  return value === NONE ? "None" : value;
}
