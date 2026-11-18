# Project Plan: Shadow of War Web-Based Trait Manager

## 1. Objective
Build a lightweight, local web-based UI to view, reorder (via drag-and-drop), and modify Orc Captain/Follower traits in *Middle-earth: Shadow of War* without fighting Cheat Engine's rigid native tree-view UI. 

## 2. Core Architecture
Instead of rewriting SeiKur0’s entire cheat table or writing a C# memory scanner from scratch, we will use a **Bridge Architecture**:
1. **Memory Backend (Cheat Engine + Lua):** Cheat Engine remains attached to `ShadowOfWar.exe` to resolve pointers and read/write memory. A minimal Lua script runs a local HTTP server (or WebSocket) inside CE to expose read/write endpoints.
2. **Web Frontend (Local Web App):** A lightweight HTML/JS (or React/Vite) interface that fetches the selected Orc's trait array from the Lua server, renders a drag-and-drop list, and sends the reordered array back to CE to overwrite the memory slots.

---

## 3. Implementation Phases

### Phase 1: Inspect SeiKur0's `.CT` File (Pointer Extraction)
* **Goal:** Identify how SeiKur0's table locates the currently highlighted/selected Orc and its trait array in memory.
* **Action Items:**
  * Open SeiKur0's `.CT` file in a text editor (it is plain XML).
  * Search for the XML nodes corresponding to "Selected Orc" or "Traits" (e.g., `Trait 1`, `Trait 2`, etc.).
  * Document the base pointer symbol (e.g., `pSelectedOrc` or similar AOB-injected symbol) and the exact hexadecimal offsets for the trait slots (usually 4-byte or 8-byte pointers/IDs spaced sequentially).

### Phase 2: Cheat Engine Lua HTTP Bridge (`ce_bridge.lua`)
* **Goal:** Create a lightweight local server inside Cheat Engine that accepts JSON payloads to read/write the trait memory offsets.
* **Action Items:**
  * Use Cheat Engine's built-in Lua `sockets` or `createTCPServer` API to listen on `127.0.0.1:8080`.
  * **Endpoint `GET /traits`:** Reads the memory addresses for Trait Slots 1 through $N$ using CE's `readInteger()` / `readQword()`, maps them to readable names (if a lookup dictionary is extracted from the `.CT` dropdown list), and returns a JSON array.
  * **Endpoint `POST /traits`:** Accepts an ordered JSON array of trait IDs/pointers and writes them sequentially back into the Orc's trait memory slots using `writeInteger()` / `writeQword()`.
  * Include CORS headers (`Access-Control-Allow-Origin: *`) in the Lua HTTP response so the local browser UI can communicate without blocked requests.

### Phase 3: Web Frontend (`index.html` / `app.js` or Minimal React)
* **Goal:** Build a clean, single-page drag-and-drop UI to manage the trait order.
* **Action Items:**
  * Fetch current traits from `http://127.0.0.1:8080/traits` via a "Refresh from Game" button.
  * Render the traits as vertical cards using **SortableJS** (CDN) or native HTML5 Drag-and-Drop.
  * Add a trait selector/search dropdown (populated from the `.CT` dropdown list) so traits can also be swapped, added, or cleared (`0x00000000`).
  * On "Apply to Game" (or automatically on drop), `POST` the newly ordered array back to the Lua bridge.

---

## 4. Cursor / AI Prompting Strategy (Credit-Saver Tips)
To keep token usage low and prevent weaker models from hallucinating Cheat Engine Lua APIs:
1. **Feed the XML Snippet First:** Copy *only* the relevant `<CheatEntry>` XML block for Traits from SeiKur0's `.CT` file into your Cursor context. Do not paste the whole file.
2. **Use Vanilla HTML/JS + SortableJS:** Avoid heavy frameworks (Next.js, Tailwind build steps) unless you already have a template ready. A single `index.html` file with CDN SortableJS requires zero build tooling and ~150 lines of code.
3. **Verify CE Lua Socket Syntax:** Cheat Engine uses a custom Lua implementation (`createTCPServer` or `luasocket` depending on CE version). Have the AI write a 20-line "Hello World" TCP/HTTP test script first to verify CE responds to `curl http://127.0.0.1:8080` before building the memory-writing logic.

---

## 5. Next Immediate Step
Open SeiKur0's `.CT` file in Cursor, search for the trait entries, and isolate the XML block showing the memory offsets and dropdown IDs for an Orc's traits.