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

The site is served at http://localhost:3000. The browser still calls the host Cheat Engine bridge at `127.0.0.1:8080`.

## Trait Manager (Cheat Engine bridge)

The manager page reads and writes the selected orc’s **Picker abilities** list through a small Lua HTTP server inside Cheat Engine.

### Prerequisites

1. Attach Cheat Engine to `ShadowOfWar.exe`.
2. Open SeiKur0’s table (e.g. `src/data/ShadowOfWar_SeiKur0_v21.CT`).
3. Enable **Master Script** (registers `p_gamedb`).
4. Enable **Uruk Pointer** and select an orc in the army menu so `p_uruk` is set.

### Start the bridge

1. In Cheat Engine: **Table → Execute Lua Script…** (or open Lua Engine).
2. Load and run [`ce_bridge.lua`](ce_bridge.lua) from this repo.
3. Confirm the CE console prints that it is listening on `http://127.0.0.1:8080`.
4. Optional smoke test:

```bash
curl http://127.0.0.1:8080/health
```

Requires LuaSocket (`socket` / `socket.core`), which ships with most Cheat Engine installs.

### Workflow

1. Run `npm run dev` and open **Manager**.
2. Select an orc in the army view.
3. Click **Refresh from Game**.
4. Drag traits to reorder; use Change / Clear / Add as needed.
5. Click **Apply to Game** to write the list back (full `0x20` slot records + `list_end` update).

Re-running `ce_bridge.lua` stops the previous listener and starts a new one.
