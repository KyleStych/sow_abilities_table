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
  const recommended = trait["Recommended for"];
  if (typeof recommended !== "string" || recommended.length === 0) return [];
  return recommended
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

const READABLE_PREFIXES = [
  "PersonalityMarker_",
  "ClassMarker_",
  "Picker_",
  "Marker_",
];

/** Advanced classes. BaseStrength with these suffixes pairs with Marker_Specialization_. */
const SPECIALIZATION_SUFFIXES = new Set(["Marksman", "Tracker"]);

export type TraitLinkKind = "element" | "class" | "spec";

/**
 * Groups the marker and picker that decide the same orc fact, so both rails
 * can use one text color: elemental weapon, class, or specialization.
 */
export function traitLinkKind(
  name: string | null | undefined,
): TraitLinkKind | null {
  if (!name) return null;
  if (/StatusEffect_/i.test(name) || /_Weapon$/i.test(name)) return "element";
  if (/Specialization_/i.test(name)) return "spec";
  if (/^ClassMarker_/i.test(name)) return "class";
  const base = name.match(/^Picker_BaseStrength_(.+)$/);
  if (base) {
    return SPECIALIZATION_SUFFIXES.has(base[1]) ? "spec" : "class";
  }
  return null;
}

export function traitLinkClass(name: string | null | undefined): string {
  switch (traitLinkKind(name)) {
    case "element":
      return "text-sky-300";
    case "class":
      return "text-emerald-300";
    case "spec":
      return "text-violet-300";
    default:
      return "text-foreground";
  }
}

/** Game visual title when we have one; otherwise a short label from the id. */
export function readableLabel(
  name: string | null | undefined,
  byPicker?: Map<string, Trait>,
): string {
  if (!name) return "";
  const title = byPicker?.get(name)?.["Game visual title"];
  if (title) return title;
  let text = name;
  for (const prefix of READABLE_PREFIXES) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  return text.replace(/_/g, " ");
}
