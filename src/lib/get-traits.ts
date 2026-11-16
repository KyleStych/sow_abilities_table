import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Trait } from "@/types/trait";

export const TRAITS_PATH = path.join(process.cwd(), "src/data/traits.json");

/** Reads traits.json from disk on every request (not bundled at build). */
export async function getTraits(): Promise<Trait[]> {
  const raw = await readFile(TRAITS_PATH, "utf-8");
  return JSON.parse(raw) as Trait[];
}

export function sortTraitsByPicker(traits: Trait[]): Trait[] {
  return [...traits].sort((a, b) =>
    a.Picker.localeCompare(b.Picker, "en", { sensitivity: "base" }),
  );
}

/** Sorts traits.json alphabetically by Picker and writes it back. */
export async function sortTraitsFile(): Promise<{ count: number }> {
  const traits = await getTraits();
  const sorted = sortTraitsByPicker(traits);
  await writeFile(TRAITS_PATH, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
  return { count: sorted.length };
}
