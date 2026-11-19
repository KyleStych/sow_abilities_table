# CSV drop zone — trait overwrite rules

Exported orc CSVs (from `ce_bridge.lua` / `_sow-export-pickers-to-csv.lua`) look like:

```text
Category,Property/Slot,Name,HexValue
Picker Abilities,entry 01,Picker_Deadly,000000005594FD80
```

## Do not trust HexValue across sessions

`HexValue` is a pointer into the live game DB for **that** launch of Shadow of War + Cheat Engine. After a restart those addresses move.

When importing a CSV into the Trait Manager:

1. Read picker rows from the `Picker Abilities` category.
2. Ignore `<None>`, `<Unresolved>`, and empty names.
3. Resolve each `Name` (e.g. `Picker_Deadly`) against the **live** `GET /catalog` map from CE (`Faction/Traits/Picker`).
4. Write memory using the resolved live address (or POST `{ "name": "Picker_Deadly" }` and let the bridge resolve).
5. Surface any names that are not in the current catalog as unresolved — do not fall back to the CSV hex.

## UI expectation

- Drop zone accepts `.csv` files.
- Show checkboxes so the user can selectively import traits.
- Loading into the editor is a local draft; **Apply to Game** still performs the write.
