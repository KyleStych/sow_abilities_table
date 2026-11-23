/** Elemental weapon / status tokens used across marker and picker names. */
export const ELEMENT_TYPES = ["Curse", "Fire", "Poison"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/**
 * Team Damage Boost uses asymmetric names:
 * Curse → ExploitedEnemies, Fire → OnFireEnemies, Poison → PoisonedEnemies.
 */
export const TEAM_DAMAGE_BOOST_BY_ELEMENT: Record<ElementType, string> = {
  Curse: "Picker_ET_TeamDamageBoostExploitedEnemies",
  Fire: "Picker_ET_TeamDamageBoostOnFireEnemies",
  Poison: "Picker_ET_TeamDamageBoostPoisonedEnemies",
};

const TEAM_DAMAGE_BOOST_TO_ELEMENT: Record<string, ElementType> = {
  Picker_ET_TeamDamageBoostExploitedEnemies: "Curse",
  Picker_ET_TeamDamageBoostOnFireEnemies: "Fire",
  Picker_ET_TeamDamageBoostPoisonedEnemies: "Poison",
};

/** Curse/Fire/Poison as a path segment or CamelCase stem (CurseMaster). */
const ELEMENT_TOKEN = /(^|_)(Curse|Fire|Poison)(?=_|[A-Z]|$)/;

/** Proof/immune resists stay on the orc together and are not elemental loadouts. */
const ELEMENT_IMMUNE_RESIST_RE =
  /^Picker_Resist_(Curse|Fire|Poison)_Immune$/;

export function isTeamDamageBoostName(
  name: string | null | undefined,
): boolean {
  return Boolean(name && name in TEAM_DAMAGE_BOOST_TO_ELEMENT);
}

export function isElementImmuneResist(
  name: string | null | undefined,
): boolean {
  return Boolean(name && ELEMENT_IMMUNE_RESIST_RE.test(name));
}

export function elementFromName(
  name: string | null | undefined,
): ElementType | null {
  if (!name) return null;
  if (isElementImmuneResist(name)) return null;
  const boost = TEAM_DAMAGE_BOOST_TO_ELEMENT[name];
  if (boost) return boost;
  const match = name.match(ELEMENT_TOKEN);
  return match ? (match[2] as ElementType) : null;
}

/**
 * Rename an elemental marker/picker for the target element.
 * Returns null when the name has no elemental token or already matches.
 */
export function swapElementName(
  name: string,
  target: ElementType,
): string | null {
  if (isElementImmuneResist(name)) return null;
  if (isTeamDamageBoostName(name)) {
    const next = TEAM_DAMAGE_BOOST_BY_ELEMENT[target];
    return next === name ? null : next;
  }
  if (!ELEMENT_TOKEN.test(name)) return null;
  const next = name.replace(
    new RegExp(ELEMENT_TOKEN.source, "g"),
    `$1${target}`,
  );
  return next === name ? null : next;
}

/** True when a Team Damage Boost rename lands on the asymmetric Curse name. */
export function needsExploitedBoostConfirm(
  fromName: string,
  target: ElementType,
): boolean {
  if (target !== "Curse") return false;
  if (!isTeamDamageBoostName(fromName)) return false;
  return fromName !== TEAM_DAMAGE_BOOST_BY_ELEMENT.Curse;
}
