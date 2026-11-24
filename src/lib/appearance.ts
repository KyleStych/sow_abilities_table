/**
 * Appearance fields follow SeiKur0's cheat table.
 * Dropdown options are the game-database lists that table binds with addDD,
 * not entries from traits.json. Colors are ARGB dwords. Orc rarity is a string.
 * Offset comments are Cheat Engine order: first value is the final displacement.
 */

export type AppearanceField = {
  id: string;
  label: string;
  listId: string;
  section: "property" | "equipment";
};

/** PickerLevelRemap pointer. Shown for reference and never written or imported. */
export const LOCKED_APPEARANCE_FIELD_ID = "trait-level";

export function appearanceFieldLocked(id: string) {
  return id === LOCKED_APPEARANCE_FIELD_ID;
}

export const APPEARANCE_FIELDS: AppearanceField[] = [
  { id: "ai", label: "AI", listId: "Combat/Tree", section: "property" },
  {
    id: "trait-level",
    label: "Trait Level Offset",
    listId: "Faction/Traits/PickerLevelRemap",
    section: "property",
  },
  {
    id: "tribe",
    label: "Tribe",
    listId: "Faction/Tribes/Definitions",
    section: "property",
  },
  {
    id: "role",
    label: "Role (second part of name)",
    listId: "Faction/Roles/Definitions",
    section: "property",
  },
  {
    id: "class",
    label: "Class",
    listId: "Character/Models",
    section: "property",
  },
  {
    id: "personality",
    label: "Personality",
    listId: "Faction/Personalities",
    section: "property",
  },
  { id: "base-model", label: "base model", listId: "Model", section: "equipment" },
  {
    id: "body-model-base",
    label: "body model base",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "body-model",
    label: "body model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "head-model-base",
    label: "head model base",
    listId: "Model/SimpleModelHeads",
    section: "equipment",
  },
  {
    id: "head-model",
    label: "head model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "hair-model",
    label: "hair model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  { id: "body", label: "body", listId: "Inventory/Items", section: "equipment" },
  {
    id: "body-appearance",
    label: "body (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  {
    id: "special-body",
    label: "special body",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "special-body-appearance",
    label: "special body (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  {
    id: "special-head",
    label: "special head",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "special-head-appearance",
    label: "special head (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  {
    id: "weapon-1h-left",
    label: "weapon 1H left",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "weapon-1h-left-appearance",
    label: "weapon 1H left (appearance)",
    listId: "Inventory/EquippedWeaponData",
    section: "equipment",
  },
  {
    id: "weapon-1h-right",
    label: "weapon 1H right",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "weapon-1h-right-appearance",
    label: "weapon 1H right (appearance)",
    listId: "Inventory/EquippedWeaponData",
    section: "equipment",
  },
  {
    id: "weapon-2h",
    label: "weapon 2H",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "weapon-2h-appearance",
    label: "weapon 2H (appearance)",
    listId: "Inventory/EquippedWeaponData",
    section: "equipment",
  },
  { id: "helmet", label: "helmet", listId: "Inventory/Items", section: "equipment" },
  {
    id: "helmet-model",
    label: "helmet model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "helmet-appearance",
    label: "helmet (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  {
    id: "shoulders",
    label: "shoulders",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "shoulders-model",
    label: "shoulders model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "shoulders-appearance",
    label: "shoulders (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  { id: "chest", label: "chest", listId: "Inventory/Items", section: "equipment" },
  {
    id: "chest-model",
    label: "chest model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "chest-appearance",
    label: "chest (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  { id: "arms", label: "arms", listId: "Inventory/Items", section: "equipment" },
  {
    id: "arms-model",
    label: "arms model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "arms-appearance",
    label: "arms (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  { id: "pants", label: "pants", listId: "Inventory/Items", section: "equipment" },
  {
    id: "pants-model",
    label: "pants model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "pants-appearance",
    label: "pants (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  { id: "legs", label: "legs", listId: "Inventory/Items", section: "equipment" },
  {
    id: "legs-model",
    label: "legs model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "legs-appearance",
    label: "legs (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  { id: "quiver", label: "quiver", listId: "Inventory/Items", section: "equipment" },
  {
    id: "quiver-model",
    label: "quiver model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "quiver-appearance",
    label: "quiver (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
  {
    id: "accessory",
    label: "accessory",
    listId: "Inventory/Items",
    section: "equipment",
  },
  {
    id: "accessory-model",
    label: "accessory model",
    listId: "Model/SimpleModelPieces",
    section: "equipment",
  },
  {
    id: "accessory-appearance",
    label: "accessory (appearance)",
    listId: "Inventory/ArmorData",
    section: "equipment",
  },
];

export const TAG_LIST_ID = "Faction/AppearanceTags/Tags";
export const WOUND_LIST_ID = "Inventory/Items";

/** Body-size tokens used in model, item, and tag names, such as Orc_Stk_Body_LOD. */
export const BODY_TYPES = ["Slim", "Stk", "Buff"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

/** Marker ability that records the orc's appearance body tag. */
export const BODY_APPEARANCE_MARKER_PREFIX = "Marker_AppearanceTag_";

/** In-name tokens stay Slim/Stk/Buff; the stocky marker uses Stocky. */
const BODY_APPEARANCE_MARKER_SUFFIX: Record<BodyType, string> = {
  Slim: "Slim",
  Stk: "Stocky",
  Buff: "Buff",
};

const BODY_TYPE_TOKEN = /(^|_)(Slim|Stk|Buff)(?=_|$)/;
const BODY_APPEARANCE_MARKER_RE =
  /^Marker_AppearanceTag_(Slim|Stocky|Buff|Stk)$/;

const MARKER_SUFFIX_TO_BODY_TYPE: Record<string, BodyType> = {
  Slim: "Slim",
  Stocky: "Stk",
  Stk: "Stk",
  Buff: "Buff",
};

/** Replace Slim, Stk, or Buff tokens. Returns null when the name does not change. */
export function swapBodyTypeName(name: string, target: BodyType): string | null {
  if (!BODY_TYPE_TOKEN.test(name)) return null;
  const next = name.replace(new RegExp(BODY_TYPE_TOKEN.source, "g"), `$1${target}`);
  return next === name ? null : next;
}

/** First Slim/Stk/Buff token in a name, if any. */
export function bodyTypeFromName(
  name: string | null | undefined,
): BodyType | null {
  if (!name) return null;
  const marker = name.match(BODY_APPEARANCE_MARKER_RE);
  if (marker) return MARKER_SUFFIX_TO_BODY_TYPE[marker[1]] ?? null;
  const match = name.match(BODY_TYPE_TOKEN);
  return match ? (match[2] as BodyType) : null;
}

export function isBodyAppearanceMarker(
  name: string | null | undefined,
): name is string {
  return Boolean(name && BODY_APPEARANCE_MARKER_RE.test(name));
}

export function bodyAppearanceMarkerName(target: BodyType) {
  return `${BODY_APPEARANCE_MARKER_PREFIX}${BODY_APPEARANCE_MARKER_SUFFIX[target]}`;
}

export const APPEARANCE_COLORS = [
  { id: "color-0", label: "body color", offset: "178" },
  { id: "color-1", label: "? color", offset: "17C" },
  { id: "color-2", label: "hair color", offset: "180" },
  { id: "color-3", label: "tattoo color", offset: "184" },
  { id: "color-4", label: "? color", offset: "188" },
  { id: "color-5", label: "? color", offset: "18C" },
  { id: "color-6", label: "? color", offset: "190" },
  { id: "color-7", label: "? color", offset: "194" },
  { id: "color-8", label: "? color", offset: "198" },
  { id: "color-9", label: "? color", offset: "19C" },
  { id: "color-10", label: "? color", offset: "1A0" },
  { id: "color-11", label: "? color", offset: "1A4" },
  { id: "color-12", label: "? color", offset: "1A8" },
  { id: "color-13", label: "? color", offset: "1AC" },
  { id: "color-14", label: "? color", offset: "1B0" },
  { id: "color-15", label: "? color", offset: "1B4" },
  { id: "color-16", label: "? color", offset: "1B8" },
] as const;

export function argbParts(argb: string): { rgb: string; alpha: number } {
  const clean = argb.replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "");
  const padded = clean.padStart(8, "0").slice(-8).toUpperCase();
  const alpha = Number.parseInt(padded.slice(0, 2), 16);
  return {
    rgb: `#${padded.slice(2).toLowerCase()}`,
    alpha: Number.isFinite(alpha) ? alpha : 255,
  };
}

export function toArgb(rgb: string, alpha: number): string {
  const hex = rgb.replace("#", "").slice(0, 6).padStart(6, "0");
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  return a.toString(16).padStart(2, "0").toUpperCase() + hex.toUpperCase();
}

/** Opaque ARGB. An all-zero slot stays clear; every other color is forced to FF. */
export function lockAlpha(argb: string): string {
  const parts = argbParts(argb);
  if (parts.alpha === 0 && parts.rgb.toLowerCase() === "#000000") {
    return "00000000";
  }
  return toArgb(parts.rgb, 255);
}

/** Accept RRGGBB or AARRGGBB. Alpha is written as FF, except an all-zero value. */
export function parseColorHex(input: string): string | null {
  const clean = input.replace(/^#/, "").replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return lockAlpha(`FF${clean}`);
  if (/^[0-9a-fA-F]{8}$/.test(clean)) return lockAlpha(clean);
  return null;
}
