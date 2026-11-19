/**
 * Parses SeiKur0 / ce_bridge CSV exports.
 *
 * IMPORTANT: HexValue columns are only valid for the game session that
 * produced the CSV. Always resolve traits by the Name string against the
 * live Faction/Traits/Picker catalog from CE before writing memory.
 */

export type OrcCsvPickerRow = {
  slot: string;
  name: string;
  /** Session-specific; do not write this address across launches. */
  hexValue: string;
};

export type OrcCsvParseResult = {
  orcName: string | null;
  pickers: OrcCsvPickerRow[];
};

const SKIP_NAMES = new Set([
  "",
  "<none>",
  "<none>",
  "<unresolved>",
  "<invalid>",
]);

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

export function parseOrcCsv(text: string): OrcCsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { orcName: null, pickers: [] };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const catIdx = header.indexOf("category");
  const slotIdx = header.indexOf("property/slot");
  const nameIdx = header.indexOf("name");
  const hexIdx = header.indexOf("hexvalue");

  if (catIdx < 0 || nameIdx < 0) {
    throw new Error(
      "CSV missing required columns (expected Category, Property/Slot, Name, HexValue)",
    );
  }

  let orcName: string | null = null;
  const pickers: OrcCsvPickerRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const category = (cells[catIdx] || "").trim();
    const slot = (slotIdx >= 0 ? cells[slotIdx] : "") || "";
    const name = (cells[nameIdx] || "").trim();
    const hexValue = (hexIdx >= 0 ? cells[hexIdx] : "") || "";

    if (
      category === "Identity" &&
      slot.trim().toLowerCase() === "name" &&
      name
    ) {
      orcName = name;
      continue;
    }

    if (category !== "Picker Abilities") {
      continue;
    }

    const lower = name.toLowerCase();
    if (SKIP_NAMES.has(lower) || lower === "<none>") {
      continue;
    }

    pickers.push({
      slot: slot.trim() || `entry ${pickers.length + 1}`,
      name,
      hexValue: hexValue.trim(),
    });
  }

  return { orcName, pickers };
}
