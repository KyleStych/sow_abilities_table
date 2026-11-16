"use server";

import { revalidatePath } from "next/cache";
import { sortTraitsFile } from "@/lib/get-traits";

export type SortTraitsResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function sortAndReloadTraits(): Promise<SortTraitsResult> {
  try {
    const { count } = await sortTraitsFile();
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sort traits.json";
    return { ok: false, error: message };
  }
}
