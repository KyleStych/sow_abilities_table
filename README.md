# Shadow of War Picker Traits

Explainer for the picker traits in Middle-earth: Shadow of War, plus a local **Trait Manager** that talks to Cheat Engine for drag-and-drop reordering.

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

The site is served at http://localhost:3000. The Next.js app proxies `/api/ce/*` to the host Cheat Engine bridge at `127.0.0.1:8080` (Docker: ensure the container can reach the host, or run `npm run dev` on the host for the manager).

## Trait Manager (Cheat Engine bridge)

The manager page reads and writes the selected orc’s **Picker abilities** list through a small Lua HTTP server inside Cheat Engine. The browser calls `/api/ce/...`; Next.js forwards to CE.

### Prerequisites

1. Attach Cheat Engine to `ShadowOfWar.exe`.
2. Open SeiKur0’s table (e.g. `src/data/ShadowOfWar_SeiKur0_v21.CT`).
3. Enable **Master Script** (registers `p_gamedb`).
4. Enable **Uruk Pointer** and select an orc in the army menu so `p_uruk` is set.

### Start the bridge

1. In Cheat Engine: open **Lua Engine**.
2. Load and **Execute** [`src/helpers/ce_bridge.lua`](src/helpers/ce_bridge.lua).
3. Confirm it prints that it is listening on port `8080`.
4. Optional smoke tests:

```bash
curl http://127.0.0.1:8080/health
curl http://localhost:3000/api/ce/health
```

### Stop / restart the bridge

In Lua Engine, Execute:

```lua
if _G.__sow_trait_bridge then _G.__sow_trait_bridge.stop() end
```

That command is also commented at the top of `ce_bridge.lua`. To restart, Execute the full script again (it auto-stops a previous instance first).

### Workflow

1. Run `npm run dev` and open **Manager**.
2. Select an orc in the army view.
3. Click **Refresh from Game**.
4. Drag traits to reorder; use Change / Clear / Add as needed.
5. Click **Apply to Game** to write the list back (full `0x20` slot records + `list_end` update).
