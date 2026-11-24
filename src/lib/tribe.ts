/** Additional Properties stores TribeDef_<Name>. Tribe attacks are Picker_TribeAttack_<Name>. */

/**
 * Dev rename: Additional Properties still uses Sorcerous while tribe attacks
 * and in-game labels use Mystic.
 */
export function canonicalTribe(tribe: string): string {
  return tribe === "Sorcerous" ? "Mystic" : tribe;
}

export function tribesMatch(a: string, b: string): boolean {
  return canonicalTribe(a) === canonicalTribe(b);
}

export function tribeFromAttackName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const match = name.match(/^Picker_TribeAttack_([A-Za-z]+)$/);
  return match ? match[1] : null;
}

export function tribeFromPropertyName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const match = name.match(/^TribeDef_([A-Za-z]+)$/);
  return match ? match[1] : null;
}

export function tribeAttackPickerName(tribe: string): string {
  return `Picker_TribeAttack_${canonicalTribe(tribe)}`;
}
