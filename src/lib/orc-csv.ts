/**
 * Parses SeiKur0 / ce_bridge CSV exports.
 *
 * IMPORTANT: HexValue columns are only valid for the game session that
 * produced the CSV. Always resolve traits by the Name string against the
 * live Faction/Traits/Picker and Faction/Traits/Marker catalogs from CE
 * before writing memory.
 */

export type OrcCsvAbilityRow = {
  slot: string;
  name: string;
  /** Session-specific; do not write this address across launches. */
  hexValue: string;
};

export type OrcCsvPickerRow = OrcCsvAbilityRow;

export type OrcCsvParseResult = {
  orcName: string | null;
  pickers: OrcCsvAbilityRow[];
  markers: OrcCsvAbilityRow[];
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
    return { orcName: null, pickers: [], markers: [] };
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
  const pickers: OrcCsvAbilityRow[] = [];
  const markers: OrcCsvAbilityRow[] = [];

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

    const bucket =
      category === "Picker Abilities"
        ? pickers
        : category === "Marker Abilities"
          ? markers
          : null;
    if (!bucket) {
      continue;
    }

    const lower = name.toLowerCase();
    if (SKIP_NAMES.has(lower) || lower === "<none>") {
      continue;
    }

    bucket.push({
      slot: slot.trim() || `entry ${bucket.length + 1}`,
      name,
      hexValue: hexValue.trim(),
    });
  }

  return { orcName, pickers, markers };
}
