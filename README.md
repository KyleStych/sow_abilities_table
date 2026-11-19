# Shadow of War Picker Traits

Explainer for the picker traits in Middle-earth: Shadow of War, plus a local **Trait Manager** that talks to Cheat Engine for drag-and-drop reordering and CSV import.

## Local

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the trait browser, or http://localhost:3000/manager for the CE-backed manager.

## Docker

```bash
docker compose up --build
```

The site is served at http://localhost:3000. The manager’s `/api/ce/*` routes talk to Cheat Engine through a **file IPC bridge** under `C:\Temp\sow_bridge` (works from Docker only if that folder is shared with the host / CE process).

## Trait Manager (Cheat Engine file bridge)

Next.js writes `req_*.json` into `C:\Temp\sow_bridge`; [`src/helpers/ce_bridge.lua`](src/helpers/ce_bridge.lua) polls every ~75ms, runs the memory read/write on CE’s Lua timer, and writes `res_*.json`. No TCP sockets inside CE.

### Prerequisites

1. Attach Cheat Engine to `ShadowOfWar.exe`.
2. Open SeiKur0’s table (e.g. `src/data/ShadowOfWar_SeiKur0_v21.CT`).
3. Enable **Master Script** (registers `p_gamedb`).
4. Enable **Uruk Pointer** and select an orc in the army menu so `p_uruk` is set.

### Start / stop / export

In **Lua Engine**, load and Execute [`src/helpers/ce_bridge.lua`](src/helpers/ce_bridge.lua).

```lua
-- STOP
if _G.__sow_trait_bridge then _G.__sow_trait_bridge.stop() end

-- EXPORT CSV (while bridge is running)
if _G.__sow_trait_bridge then _G.__sow_trait_bridge.exportCsv() end
```

Smoke-test from the site:

```bash
curl http://localhost:3000/api/ce/health
```

### Workflow

1. Run `npm run dev` and open **Manager**.
2. Select an orc in the army view → **Refresh from Game**.
3. Drag traits to reorder (ember line shows the drop slot), or drop an orc CSV and selectively import.
4. **Apply to Game** writes the list (names are resolved against the live picker catalog).
5. **Persist the edit** the SeiKur0 way: change a piece of equipment (or a training order), then quit to the menu and reload. Advancing time alone often rebuilds the orc and discards picker edits that were only in memory.

### CSV imports

Exported CSVs include `HexValue` pointers that are **only valid for that game session**. The manager matches the `Name` column to the live CE catalog and ignores CSV hex. See [`drop-zone-trait-overwrites.md`](drop-zone-trait-overwrites.md).
