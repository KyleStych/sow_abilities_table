import { elementFromName } from "@/lib/element";

export const MARKER_NO_STATUS_EFFECT = "Marker_NoStatusEffect";
export const MARKER_NO_HATES = "Marker_NoHates";

export function isHatePicker(name: string | null | undefined): boolean {
  return Boolean(name && /^Picker_Hate_/.test(name));
}

export function isElementalPicker(name: string | null | undefined): boolean {
  return elementFromName(name) !== null;
}
