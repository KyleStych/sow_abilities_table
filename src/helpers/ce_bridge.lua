--[[
  Shadow of War Trait Manager — Cheat Engine File IPC Bridge + CSV Exporter
  =========================================================================
  - Polls C:\Temp\sow_bridge\ via createTimer and writes atomic res_<id>.json
  - Exposes _G.__sow_trait_bridge.exportCsv() to dump full Orc CSVs on demand

  STOP bridge:
    if _G.__sow_trait_bridge then _G.__sow_trait_bridge.stop() end

  EXPORT CSV while bridge is running (run in Lua Engine window):
    if _G.__sow_trait_bridge then _G.__sow_trait_bridge.exportCsv() end
]]

local BRIDGE_DIR = "C:\\Temp\\sow_bridge"
local CSV_DIR = "C:\\Users\\lurch\\Pictures\\Shadow of War\\Characters"
local POLL_INTERVAL_MS = 75
local SLOT_STRIDE = 0x20
local MAX_SLOTS = 56
local PICKER_LIST_ID = "Faction/Traits/Picker"
-- Marker abilities are packed 8-byte pointers (SeiKur0 "Marker abilities":
-- list [[p_uruk]+1B0], list_end p_uruk+1B8, list_maxlength p_uruk+1C0).
local MARKER_STRIDE = 8
local MAX_MARKER_SLOTS = 48
local MARKER_LIST_ID = "Faction/Traits/Marker"
local MARKER_LIST_OFF = 0x1B0
local MARKER_END_OFF = 0x1B8
local MARKER_MAX_OFF = 0x1C0

os.execute('if not exist "' .. BRIDGE_DIR .. '" mkdir "' .. BRIDGE_DIR .. '"')
os.execute('if not exist "' .. CSV_DIR .. '" mkdir "' .. CSV_DIR .. '"')

if _G.__sow_trait_bridge and _G.__sow_trait_bridge.stop then
  pcall(function()
    _G.__sow_trait_bridge.stop()
  end)
end

local bridge = {
  running = false,
  timer = nil,
  busy = false,
}
_G.__sow_trait_bridge = bridge

-- ---------------------------------------------------------------------------
-- JSON & hex helpers
-- ---------------------------------------------------------------------------
local function json_escape(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

local function json_string(s)
  return '"' .. json_escape(s) .. '"'
end

local function hex_addr(n)
  if n == nil or n == 0 then
    return "0x0"
  end
  return string.format("0x%X", n)
end

local function parse_hex(s)
  if s == nil then
    return nil
  end
  if type(s) == "number" then
    return s
  end
  s = tostring(s):gsub("^%s+", ""):gsub("%s+$", "")
  if s == "" or s == "0" or s == "0x0" or s == "null" then
    return 0
  end
  local hex = s:match("^0[xX](%x+)$") or s:match("^(%x+)$")
  if not hex then
    return nil
  end
  return tonumber(hex, 16)
end

local function parse_traits_body(body)
  local traits = {}
  if not body or body == "" then
    return nil, "empty body"
  end

  local arr = body:match('"traits"%s*:%s*(%b[])') or body:match("(%b[])")
  if not arr then
    return nil, "missing traits array"
  end

  local i = 2
  local len = #arr
  while i <= len do
    while i <= len and arr:sub(i, i):match("[%s,]") do
      i = i + 1
    end
    if i > len or arr:sub(i, i) == "]" then
      break
    end

    if arr:sub(i, i + 3) == "null" then
      traits[#traits + 1] = { address = 0 }
      i = i + 4
    elseif arr:sub(i, i) == "{" then
      local depth = 0
      local start = i
      while i <= len do
        local c = arr:sub(i, i)
        if c == "{" then
          depth = depth + 1
        elseif c == "}" then
          depth = depth - 1
          if depth == 0 then
            break
          end
        end
        i = i + 1
      end
      local obj = arr:sub(start, i)
      i = i + 1

      local name = obj:match('"name"%s*:%s*"([^"]*)"')
      local addr_str = obj:match('"address"%s*:%s*"([^"]*)"')
        or obj:match('"address"%s*:%s*([%w]+)')
      local address = nil
      if addr_str then
        address = parse_hex(addr_str)
      end
      traits[#traits + 1] = { name = name, address = address }
    else
      return nil, "unexpected token in traits array at " .. tostring(i)
    end
  end

  return traits, nil
end

-- ---------------------------------------------------------------------------
-- Memory / game-DB helpers
-- ---------------------------------------------------------------------------
local function get_orc()
  local ok, sym = pcall(getAddress, "p_uruk")
  if not ok or sym == nil or sym == 0 then
    return nil, "symbol p_uruk not found — enable Uruk Pointer"
  end
  local orc = readQword(sym)
  if orc == nil or orc == 0 then
    return nil, "p_uruk is null — select an orc in the army menu"
  end
  return orc, nil
end

local function gamedb_lists()
  if bridge.gamedb_lists then
    return bridge.gamedb_lists, nil
  end
  local ok_db, db_addr = pcall(getAddress, "p_gamedb")
  if not ok_db or db_addr == nil or db_addr == 0 then
    return nil, "symbol p_gamedb not found — enable Master Script"
  end

  local map = {}
  local found = 0
  for listind = 0, 2999 do
    local listnum = string.format("%X", listind)
    local ok_b, base = pcall(getAddress, "[p_gamedb+50]+58*" .. listnum)
    if ok_b and base ~= nil and base ~= 0 then
      local namePtr = readPointer(base)
      if namePtr and namePtr ~= 0 then
        local name = readString(namePtr)
        if name and name ~= "" and map[name] == nil then
          map[name] = base
          found = found + 1
        end
      end
    end
  end

  if found == 0 then
    return nil, "game database lists were not readable"
  end
  bridge.gamedb_lists = map
  print(string.format("[sow_trait_bridge] indexed %d game database lists", found))
  return map, nil
end

local function get_list_base_from_list_id(listid)
  local map = gamedb_lists()
  if not map then
    return nil
  end
  return map[listid]
end

local function build_catalog(list_id, missing_message)
  local by_name = {}
  local by_addr = {}
  local items = {}

  local base = get_list_base_from_list_id(list_id)
  if base == nil then
    return by_name, by_addr, items, missing_message
  end

  local length = readInteger(base + 0x28) or 0
  local entry = readPointer(base + 0x38)
  local indx = 0
  while indx < length and entry and entry ~= 0 do
    local namePtr = readPointer(entry + 0x20)
    local name = namePtr and readString(namePtr) or nil
    if name and name ~= "" then
      by_name[name] = entry
      by_addr[entry] = name
      items[#items + 1] = { name = name, address = entry }
    end
    entry = entry + 0x28
    indx = indx + 1
  end

  table.sort(items, function(a, b)
    return a.name < b.name
  end)

  return by_name, by_addr, items, nil
end

local function build_picker_catalog()
  return build_catalog(
    PICKER_LIST_ID,
    "Faction/Traits/Picker list not found — enable Master Script"
  )
end

local function build_marker_catalog()
  return build_catalog(
    MARKER_LIST_ID,
    "Faction/Traits/Marker list not found — enable Master Script"
  )
end

local function trait_name_from_ptr(ptr, by_addr)
  if ptr == nil or ptr == 0 then
    return nil
  end
  if by_addr and by_addr[ptr] then
    return by_addr[ptr]
  end
  local namePtr = readPointer(ptr + 0x20)
  if namePtr and namePtr ~= 0 then
    return readString(namePtr)
  end
  return nil
end

-- Picker entries are 8-byte pointers at stride 0x20
-- (Address = [[p_uruk]+1E0] + n*0x20). Marker entries are packed pointers
-- at stride 8 ([[p_uruk]+1B0] + n*8). Only the pointer qword is written.
local function read_ability_state(spec)
  local orc, err = get_orc()
  if not orc then
    return nil, err
  end

  local list_base = readPointer(orc + spec.list_off)
  local list_end = readQword(orc + spec.end_off)
  local max_length = readInteger(orc + spec.max_off) or spec.hard_cap

  if list_base == nil or list_base == 0 then
    return nil, spec.null_base_error
  end

  local count = 0
  if list_end and list_end ~= 0 and list_end >= list_base then
    count = math.floor((list_end - list_base) / spec.stride)
  end
  if count < 0 then
    count = 0
  end
  if count > spec.hard_cap then
    count = spec.hard_cap
  end
  if max_length > 0 and count > max_length then
    count = max_length
  end

  return {
    orc = orc,
    list_base = list_base,
    list_end = list_end,
    max_length = max_length,
    count = count,
    stride = spec.stride,
    end_off = spec.end_off,
    hard_cap = spec.hard_cap,
  }, nil
end

local PICKER_SPEC = {
  list_off = 0x1E0,
  end_off = 0x1E8,
  max_off = 0x1F0,
  stride = SLOT_STRIDE,
  hard_cap = MAX_SLOTS,
  null_base_error = "picker list base is null",
}

local MARKER_SPEC = {
  list_off = MARKER_LIST_OFF,
  end_off = MARKER_END_OFF,
  max_off = MARKER_MAX_OFF,
  stride = MARKER_STRIDE,
  hard_cap = MAX_MARKER_SLOTS,
  null_base_error = "marker list base is null",
}

local function read_picker_state()
  return read_ability_state(PICKER_SPEC)
end

local function read_marker_state()
  return read_ability_state(MARKER_SPEC)
end

local function write_slot_ptr(list_base, index0, stride, ptr)
  writeQword(list_base + index0 * stride, ptr or 0)
end

-- ---------------------------------------------------------------------------
-- CSV export helper (callable on demand via _G.__sow_trait_bridge.exportCsv())
-- ---------------------------------------------------------------------------
local function resolve_gamedb_name(hexStr, record)
  if not hexStr or hexStr == "" or hexStr == "??" then
    return "<Invalid>"
  end

  local addr = tonumber(hexStr, 16)
  if not addr or addr == 0 then
    return "<None>"
  end

  local ok, str = pcall(function()
    local strPtr = readPointer(addr + 0x20)
    if strPtr and strPtr ~= 0 then
      local s = readString(strPtr, 128)
      if s and s ~= "" and s:match("^[%w%_%-%s%.]+$") then
        return s
      end
    end
    return nil
  end)
  if ok and str then
    return str
  end

  if record and record.DropDownCount and record.DropDownCount > 0 then
    local upperHex = string.format("%016X", addr)
    local lowerHex = string.format("%016x", addr)
    for i = 0, record.DropDownCount - 1 do
      local item = record.DropDownList[i]
      if item then
        local k, v = item:match("^([^:]+):(.+)$")
        if k == upperHex or k == lowerHex then
          return v
        end
      end
    end
  end

  return "<Unresolved>"
end

local function get_max_length(record, fallback)
  for i = 0, record.Count - 1 do
    local c = record.Child[i]
    if c and c.Description == "list_maxlength" then
      local val = tonumber(c.Value)
      if val then
        return val
      end
    end
  end
  return fallback
end

local function clean_val(val)
  if not val or val == "" then
    return "<None>"
  end
  return val
end

function bridge.exportCsv()
  local al = getAddressList()
  local orcName = "Unknown_Orc"
  local nameRecord = al.getMemoryRecordByDescription("Name (visual)")
  if nameRecord and nameRecord.Value and nameRecord.Value ~= "" then
    orcName = nameRecord.Value
  end
  local safeFileName = orcName:gsub('[<>:"/\\|?*]', "")
  if safeFileName == "" then
    safeFileName = "Unknown_Orc"
  end

  local filename = CSV_DIR .. "\\" .. safeFileName .. "_" .. os.time() .. ".csv"
  local file = io.open(filename, "w")
  if not file then
    print("[sow_trait_bridge] ERROR: Could not write CSV to " .. filename)
    return nil
  end

  file:write("Category,Property/Slot,Name,HexValue\n")

  local function writeRow(category, slot, name, hexVal)
    name = tostring(name):gsub(",", ";")
    hexVal = tostring(hexVal):gsub(",", ";")
    file:write(string.format("%s,%s,%s,%s\n", category, slot, name, hexVal))
  end

  writeRow("Identity", "Name", orcName, "")
  local lvlRec = al.getMemoryRecordByDescription("Level-1")
  if lvlRec and tonumber(lvlRec.Value) then
    writeRow("Identity", "Level", tostring(tonumber(lvlRec.Value) + 1), lvlRec.Value)
  end

  local addRec = al.getMemoryRecordByDescription("Additional Properties")
  if addRec then
    for i = 0, addRec.Count - 1 do
      local child = addRec.Child[i]
      if child then
        local desc = child.Description
        local val = clean_val(child.Value)
        if desc == "Orc Rarity (visual)" then
          writeRow("Additional Properties", desc, val, "")
        else
          writeRow("Additional Properties", desc, resolve_gamedb_name(val, child), val)
        end
      end
    end
  end

  local equipRec = al.getMemoryRecordByDescription("Equipment/Looks")
  if equipRec then
    for i = 0, equipRec.Count - 1 do
      local child = equipRec.Child[i]
      if child then
        local desc = child.Description
        if desc == "Tags" then
          local maxTags = math.min(get_max_length(child, 16), 16)
          for j = 0, child.Count - 1 do
            local sub = child.Child[j]
            if sub then
              local slotNum = tonumber(sub.Description:match("%d+"))
              if slotNum and slotNum <= maxTags then
                local val = clean_val(sub.Value)
                writeRow("Equipment - Tags", sub.Description, resolve_gamedb_name(val, sub), val)
              end
            end
          end
        elseif desc == "Wounds" then
          local maxWounds = math.min(get_max_length(child, 8), 8)
          for j = 0, child.Count - 1 do
            local sub = child.Child[j]
            if sub then
              local slotNum = tonumber(sub.Description:match("%d+"))
              if slotNum and slotNum <= maxWounds then
                local val = clean_val(sub.Value)
                writeRow("Equipment - Wounds", sub.Description, resolve_gamedb_name(val, sub), val)
              end
            end
          end
        elseif desc == "Colors (ARGB)" then
          for j = 0, child.Count - 1 do
            local sub = child.Child[j]
            if sub then
              local val = clean_val(sub.Value)
              writeRow("Equipment - Colors (ARGB)", sub.Description, val, val)
            end
          end
        else
          local val = clean_val(child.Value)
          writeRow("Equipment and Looks", desc, resolve_gamedb_name(val, child), val)
        end
      end
    end
  end

  local markerRec = al.getMemoryRecordByDescription("Marker abilities")
  if markerRec then
    local maxMarkers = math.min(get_max_length(markerRec, 32), 32)
    for i = 0, markerRec.Count - 1 do
      local child = markerRec.Child[i]
      if child then
        local slotNum = tonumber(child.Description:match("%d+"))
        if slotNum and slotNum <= maxMarkers then
          local val = clean_val(child.Value)
          writeRow("Marker Abilities", child.Description, resolve_gamedb_name(val, child), val)
        end
      end
    end
  end

  local pickerRec = al.getMemoryRecordByDescription("Picker abilities")
  if pickerRec then
    for i = 0, pickerRec.Count - 1 do
      local child = pickerRec.Child[i]
      if child then
        local slotNum = tonumber(child.Description:match("%d+"))
        if slotNum and slotNum <= MAX_SLOTS then
          local val = clean_val(child.Value)
          writeRow("Picker Abilities", child.Description, resolve_gamedb_name(val, child), val)
        end
      end
    end
  end

  file:close()
  print("[sow_trait_bridge] Exported CSV to: " .. filename)
  return filename
end

-- ---------------------------------------------------------------------------
-- Bridge endpoint handlers
-- ---------------------------------------------------------------------------
local function handle_health()
  local state, err = read_picker_state()
  if not state then
    return 200, string.format(
      '{"ok":false,"error":%s,"p_uruk":null,"count":0}',
      json_string(err)
    )
  end
  return 200, string.format(
    '{"ok":true,"p_uruk":%s,"count":%d,"max_length":%d}',
    json_string(hex_addr(state.orc)),
    state.count,
    state.max_length
  )
end

local function handle_catalog_response(items, err)
  if err and #items == 0 then
    return 503, string.format('{"error":%s,"traits":[]}', json_string(err))
  end
  local parts = {}
  for i = 1, #items do
    local t = items[i]
    parts[#parts + 1] = string.format(
      '{"name":%s,"address":%s}',
      json_string(t.name),
      json_string(hex_addr(t.address))
    )
  end
  return 200, '{"traits":[' .. table.concat(parts, ",") .. "]}"
end

local function handle_catalog()
  local _, _, items, err = build_picker_catalog()
  return handle_catalog_response(items, err)
end

local function handle_marker_catalog()
  local _, _, items, err = build_marker_catalog()
  return handle_catalog_response(items, err)
end

local function handle_get_ability(read_state, build_cat)
  local state, err = read_state()
  if not state then
    return 503, string.format('{"error":%s}', json_string(err))
  end

  local _, by_addr = build_cat()
  local parts = {}
  for i = 0, state.count - 1 do
    local slot_addr = state.list_base + i * state.stride
    local ptr = readQword(slot_addr) or 0
    local name = trait_name_from_ptr(ptr, by_addr)
    parts[#parts + 1] = string.format(
      '{"index":%d,"name":%s,"address":%s}',
      i + 1,
      name and json_string(name) or "null",
      json_string(hex_addr(ptr))
    )
  end

  return 200, string.format(
    '{"orc":%s,"count":%d,"max_length":%d,"traits":[%s]}',
    json_string(hex_addr(state.orc)),
    state.count,
    state.max_length,
    table.concat(parts, ",")
  )
end

local function handle_get_traits()
  return handle_get_ability(read_picker_state, build_picker_catalog)
end

local function handle_get_markers()
  return handle_get_ability(read_marker_state, build_marker_catalog)
end

local function handle_post_ability(body, route_label, read_state, build_cat, reread)
  local incoming, perr = parse_traits_body(body)
  if not incoming then
    print("[sow_trait_bridge] POST " .. route_label .. " parse failed: " .. tostring(perr)
      .. " body_preview=" .. json_escape((body or ""):sub(1, 180)))
    return 400, string.format('{"error":%s}', json_string(perr or "bad json"))
  end

  local state, err = read_state()
  if not state then
    return 503, string.format('{"error":%s}', json_string(err))
  end

  local capacity = state.max_length
  if capacity <= 0 or capacity > state.hard_cap then
    capacity = state.hard_cap
  end
  if #incoming > capacity then
    return 400, string.format(
      '{"error":%s}',
      json_string(string.format("too many traits (%d > capacity %d)", #incoming, capacity))
    )
  end

  local by_name = build_cat()

  local resolved = {}
  for i = 1, #incoming do
    local item = incoming[i]
    local addr = nil

    -- Resolve by live catalog name when possible; fall back to the address
    -- already read from this session (reorder-safe, matches CE copy/paste).
    if item.name ~= nil and item.name ~= "" then
      addr = by_name[item.name]
      if addr == nil and item.address ~= nil and item.address ~= 0 then
        addr = item.address
        print("[sow_trait_bridge] catalog miss for " .. item.name .. ", using session address")
      elseif addr == nil then
        return 400, string.format('{"error":%s}', json_string("unknown trait name: " .. item.name))
      end
    elseif item.address ~= nil then
      addr = item.address
    else
      addr = 0
    end
    resolved[#resolved + 1] = addr
  end

  print(string.format("[sow_trait_bridge] POST %s writing %d slot(s)", route_label, #resolved))

  local new_count = #resolved
  while new_count > 0 and resolved[new_count] == 0 do
    new_count = new_count - 1
  end

  -- Write only the pointer qword (same as changing the CE dropdown).
  for i = 1, new_count do
    write_slot_ptr(state.list_base, i - 1, state.stride, resolved[i])
  end

  -- Clear pointers that fell off the active list. Do not touch slots beyond
  -- the previous end / new end.
  local clear_until = state.count
  if new_count > clear_until then
    clear_until = new_count
  end
  for i = new_count + 1, clear_until do
    write_slot_ptr(state.list_base, i - 1, state.stride, 0)
  end

  -- list_end = address immediately after the last active entry (SeiKur0).
  writeQword(state.orc + state.end_off, state.list_base + new_count * state.stride)

  return reread()
end

local function handle_post_traits(body)
  return handle_post_ability(
    body,
    "/traits",
    read_picker_state,
    build_picker_catalog,
    handle_get_traits
  )
end

local function handle_post_markers(body)
  return handle_post_ability(
    body,
    "/markers",
    read_marker_state,
    build_marker_catalog,
    handle_get_markers
  )
end

-- ---------------------------------------------------------------------------
-- Appearance: Additional Properties + Equipment/Looks
-- Offsets and dropdown list ids follow SeiKur0's cheat table.
-- Offsets are Cheat Engine order: the first entry is the final address
-- displacement, and each later entry is dereferenced from the base upward.
-- ---------------------------------------------------------------------------
local JSON_NULL = {}
local TAG_LIST_ID = "Faction/AppearanceTags/Tags"
local WOUND_LIST_ID = "Inventory/Items"
local MAX_TAGS = 16
local MAX_WOUNDS = 8
local TAG_STRIDE = 0x10
local WOUND_STRIDE = 8
local APPEARANCE_RECORD_OFF = 0x2D8

local APPEARANCE_FIELDS = {
  { id = "ai", label = "AI", list_id = "Combat/Tree", offsets = { 0x188 } },
  { id = "trait-level", label = "Trait Level Offset", list_id = "Faction/Traits/PickerLevelRemap", offsets = { 0x280 } },
  { id = "tribe", label = "Tribe", list_id = "Faction/Tribes/Definitions", offsets = { 0x328 } },
  { id = "role", label = "Role (second part of name)", list_id = "Faction/Roles/Definitions", offsets = { 0x318 } },
  { id = "class", label = "Class", list_id = "Character/Models", offsets = { 0x278 } },
  { id = "personality", label = "Personality", list_id = "Faction/Personalities", offsets = { 0x270 } },
  { id = "base-model", label = "base model", list_id = "Model", offsets = { 0x20, 0x2D8 } },
  { id = "body-model-base", label = "body model base", list_id = "Model/SimpleModelPieces", offsets = { 0x90, 0x2D8 } },
  { id = "body-model", label = "body model", list_id = "Model/SimpleModelPieces", offsets = { 0x28, 0x2D8 } },
  { id = "head-model-base", label = "head model base", list_id = "Model/SimpleModelHeads", offsets = { 0x150, 0x2D8 } },
  { id = "head-model", label = "head model", list_id = "Model/SimpleModelPieces", offsets = { 0x30, 0x2D8 } },
  { id = "hair-model", label = "hair model", list_id = "Model/SimpleModelPieces", offsets = { 0x38, 0x2D8 } },
  { id = "body", label = "body", list_id = "Inventory/Items", offsets = { 0x38, 0xE0 } },
  { id = "body-appearance", label = "body (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xE0 } },
  { id = "special-body", label = "special body", list_id = "Inventory/Items", offsets = { 0x38, 0xF0 } },
  { id = "special-body-appearance", label = "special body (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xF0 } },
  { id = "special-head", label = "special head", list_id = "Inventory/Items", offsets = { 0x38, 0xF8 } },
  { id = "special-head-appearance", label = "special head (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xF8 } },
  { id = "weapon-1h-left", label = "weapon 1H left", list_id = "Inventory/Items", offsets = { 0x38, 0x50 } },
  { id = "weapon-1h-left-appearance", label = "weapon 1H left (appearance)", list_id = "Inventory/EquippedWeaponData", offsets = { 0x40, 0x50 } },
  { id = "weapon-1h-right", label = "weapon 1H right", list_id = "Inventory/Items", offsets = { 0x38, 0x60 } },
  { id = "weapon-1h-right-appearance", label = "weapon 1H right (appearance)", list_id = "Inventory/EquippedWeaponData", offsets = { 0x40, 0x60 } },
  { id = "weapon-2h", label = "weapon 2H", list_id = "Inventory/Items", offsets = { 0x38, 0x68 } },
  { id = "weapon-2h-appearance", label = "weapon 2H (appearance)", list_id = "Inventory/EquippedWeaponData", offsets = { 0x40, 0x68 } },
  { id = "helmet", label = "helmet", list_id = "Inventory/Items", offsets = { 0x38, 0xA0 } },
  { id = "helmet-model", label = "helmet model", list_id = "Model/SimpleModelPieces", offsets = { 0x60, 0x2D8 } },
  { id = "helmet-appearance", label = "helmet (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xA0 } },
  { id = "shoulders", label = "shoulders", list_id = "Inventory/Items", offsets = { 0x38, 0xA8 } },
  { id = "shoulders-model", label = "shoulders model", list_id = "Model/SimpleModelPieces", offsets = { 0x68, 0x2D8 } },
  { id = "shoulders-appearance", label = "shoulders (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xA8 } },
  { id = "chest", label = "chest", list_id = "Inventory/Items", offsets = { 0x38, 0xB0 } },
  { id = "chest-model", label = "chest model", list_id = "Model/SimpleModelPieces", offsets = { 0x70, 0x2D8 } },
  { id = "chest-appearance", label = "chest (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xB0 } },
  { id = "arms", label = "arms", list_id = "Inventory/Items", offsets = { 0x38, 0xB8 } },
  { id = "arms-model", label = "arms model", list_id = "Model/SimpleModelPieces", offsets = { 0x78, 0x2D8 } },
  { id = "arms-appearance", label = "arms (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xB8 } },
  { id = "pants", label = "pants", list_id = "Inventory/Items", offsets = { 0x38, 0xC0 } },
  { id = "pants-model", label = "pants model", list_id = "Model/SimpleModelPieces", offsets = { 0x80, 0x2D8 } },
  { id = "pants-appearance", label = "pants (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xC0 } },
  { id = "legs", label = "legs", list_id = "Inventory/Items", offsets = { 0x38, 0xC8 } },
  { id = "legs-model", label = "legs model", list_id = "Model/SimpleModelPieces", offsets = { 0x88, 0x2D8 } },
  { id = "legs-appearance", label = "legs (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xC8 } },
  { id = "quiver", label = "quiver", list_id = "Inventory/Items", offsets = { 0x38, 0xD0 } },
  { id = "quiver-model", label = "quiver model", list_id = "Model/SimpleModelPieces", offsets = { 0x40, 0x2D8 } },
  { id = "quiver-appearance", label = "quiver (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xD0 } },
  { id = "accessory", label = "accessory", list_id = "Inventory/Items", offsets = { 0x38, 0xD8 } },
  { id = "accessory-model", label = "accessory model", list_id = "Model/SimpleModelPieces", offsets = { 0x48, 0x2D8 } },
  { id = "accessory-appearance", label = "accessory (appearance)", list_id = "Inventory/ArmorData", offsets = { 0x48, 0xD8 } },
}

local APPEARANCE_COLOR_LABELS = {
  [0] = "body color",
  [1] = "? color",
  [2] = "hair color",
  [3] = "tattoo color",
}

local function json_parse(s)
  local i = 1
  local n = #s
  local parse_value

  local function skip()
    while i <= n do
      local c = s:sub(i, i)
      if c ~= " " and c ~= "\n" and c ~= "\r" and c ~= "\t" then
        break
      end
      i = i + 1
    end
  end

  local function parse_string()
    i = i + 1
    local parts = {}
    while i <= n do
      local c = s:sub(i, i)
      if c == '"' then
        i = i + 1
        return table.concat(parts), nil
      elseif c == "\\" then
        local e = s:sub(i + 1, i + 1)
        if e == "n" then
          parts[#parts + 1] = "\n"
        elseif e == "r" then
          parts[#parts + 1] = "\r"
        elseif e == "t" then
          parts[#parts + 1] = "\t"
        elseif e == "u" then
          local cp = tonumber(s:sub(i + 2, i + 5), 16) or 63
          parts[#parts + 1] = cp < 128 and string.char(cp) or "?"
          i = i + 4
        else
          parts[#parts + 1] = e
        end
        i = i + 2
      else
        parts[#parts + 1] = c
        i = i + 1
      end
    end
    return nil, "unterminated string"
  end

  local function parse_array()
    i = i + 1
    local arr = {}
    skip()
    if s:sub(i, i) == "]" then
      i = i + 1
      return arr, nil
    end
    while true do
      local v, err = parse_value()
      if err then
        return nil, err
      end
      arr[#arr + 1] = v
      skip()
      local c = s:sub(i, i)
      if c == "," then
        i = i + 1
      elseif c == "]" then
        i = i + 1
        return arr, nil
      else
        return nil, "expected comma or ]"
      end
    end
  end

  local function parse_object()
    i = i + 1
    local obj = {}
    skip()
    if s:sub(i, i) == "}" then
      i = i + 1
      return obj, nil
    end
    while true do
      skip()
      if s:sub(i, i) ~= '"' then
        return nil, "expected object key"
      end
      local key, err = parse_string()
      if err then
        return nil, err
      end
      skip()
      if s:sub(i, i) ~= ":" then
        return nil, "expected colon"
      end
      i = i + 1
      local v
      v, err = parse_value()
      if err then
        return nil, err
      end
      obj[key] = v
      skip()
      local c = s:sub(i, i)
      if c == "," then
        i = i + 1
      elseif c == "}" then
        i = i + 1
        return obj, nil
      else
        return nil, "expected comma or }"
      end
    end
  end

  function parse_value()
    skip()
    local c = s:sub(i, i)
    if c == '"' then
      return parse_string()
    elseif c == "{" then
      return parse_object()
    elseif c == "[" then
      return parse_array()
    elseif c == "t" and s:sub(i, i + 3) == "true" then
      i = i + 4
      return true, nil
    elseif c == "f" and s:sub(i, i + 4) == "false" then
      i = i + 5
      return false, nil
    elseif c == "n" and s:sub(i, i + 3) == "null" then
      i = i + 4
      return JSON_NULL, nil
    elseif c == "-" or (c and c:match("%d")) then
      local start = i
      i = i + 1
      while i <= n and s:sub(i, i):match("[%d%.eE%+%-]") do
        i = i + 1
      end
      local num = tonumber(s:sub(start, i - 1))
      if num == nil then
        return nil, "bad number"
      end
      return num, nil
    end
    return nil, "unexpected token"
  end

  if not s or s == "" then
    return nil, "empty body"
  end
  local value, err = parse_value()
  if err then
    return nil, err
  end
  return value, nil
end

local function is_json_null(v)
  return v == nil or v == JSON_NULL
end

local function follow_offsets(base, offsets)
  local addr = base
  if not addr or addr == 0 then
    return nil, "base pointer is null"
  end
  for index = #offsets, 2, -1 do
    addr = readQword(addr + offsets[index])
    if addr == nil or addr == 0 then
      return nil, string.format("null pointer at offset 0x%X", offsets[index])
    end
  end
  if #offsets == 0 then
    return nil, "missing offset"
  end
  return addr + offsets[1], nil
end

local function hex8(n)
  n = math.floor(n or 0) % 4294967296
  local hex = "0123456789ABCDEF"
  local out = {}
  for index = 8, 1, -1 do
    local digit = n % 16
    out[index] = hex:sub(digit + 1, digit + 1)
    n = math.floor(n / 16)
  end
  return table.concat(out)
end

local function read_u32(addr)
  local n = readInteger(addr) or 0
  if n < 0 then
    n = n + 4294967296
  end
  return math.floor(n) % 4294967296
end

local function write_u32(addr, n)
  n = math.floor(n or 0) % 4294967296
  local b1 = n % 256
  local b2 = math.floor(n / 256) % 256
  local b3 = math.floor(n / 65536) % 256
  local b4 = math.floor(n / 16777216) % 256
  writeBytes(addr, b1, b2, b3, b4)
end

local function list_count(list_base, list_end, stride, hard_cap, max_length)
  local count = 0
  if list_base and list_base ~= 0 and list_end and list_end ~= 0 and list_end >= list_base then
    count = math.floor((list_end - list_base) / stride)
  end
  if count < 0 then
    count = 0
  end
  if count > hard_cap then
    count = hard_cap
  end
  if max_length and max_length > 0 and count > max_length then
    count = max_length
  end
  return count
end

local function list_capacity(max_length, hard_cap)
  if max_length and max_length > 0 and max_length <= hard_cap then
    return max_length
  end
  return hard_cap
end

local function read_tag_state(orc)
  local record = readQword(orc + APPEARANCE_RECORD_OFF)
  if record == nil or record == 0 then
    return nil, "appearance record is null"
  end
  local list_base = readQword(record + 0x8)
  if list_base == nil or list_base == 0 then
    return nil, "tag list base is null"
  end
  local list_end = readQword(record + 0x10)
  local max_length = readInteger(record + 0x18) or MAX_TAGS
  return {
    list_base = list_base,
    list_end_addr = record + 0x10,
    list_end = list_end,
    max_length = max_length,
    count = list_count(list_base, list_end, TAG_STRIDE, MAX_TAGS, max_length),
    stride = TAG_STRIDE,
    hard_cap = MAX_TAGS,
  }, nil
end

local function read_wound_state(orc)
  local list_base = readQword(orc + 0x130)
  if list_base == nil or list_base == 0 then
    return nil, "wound list base is null"
  end
  local list_end = readQword(orc + 0x138)
  local max_length = readInteger(orc + 0x140) or MAX_WOUNDS
  return {
    list_base = list_base,
    list_end_addr = orc + 0x138,
    list_end = list_end,
    max_length = max_length,
    count = list_count(list_base, list_end, WOUND_STRIDE, MAX_WOUNDS, max_length),
    stride = WOUND_STRIDE,
    hard_cap = MAX_WOUNDS,
  }, nil
end

local function slots_json(state)
  local parts = {}
  for index = 0, state.count - 1 do
    local ptr = readQword(state.list_base + index * state.stride) or 0
    local name = trait_name_from_ptr(ptr, nil)
    parts[#parts + 1] = string.format(
      '{"name":%s,"address":%s}',
      name and json_string(name) or "null",
      json_string(hex_addr(ptr))
    )
  end
  return table.concat(parts, ",")
end

local function field_by_id(id)
  for index = 1, #APPEARANCE_FIELDS do
    if APPEARANCE_FIELDS[index].id == id then
      return APPEARANCE_FIELDS[index]
    end
  end
  return nil
end

local function catalog_from_base(base)
  local by_name = {}
  local items = {}
  if not base or base == 0 then
    return by_name, items
  end
  local length = readInteger(base + 0x28) or 0
  local entry = readPointer(base + 0x38)
  local index = 0
  while index < length and entry and entry ~= 0 do
    local namePtr = readPointer(entry + 0x20)
    local name = namePtr and readString(namePtr) or nil
    if name and name ~= "" then
      by_name[name] = entry
      items[#items + 1] = { name = name, address = entry }
    end
    entry = entry + 0x28
    index = index + 1
  end
  table.sort(items, function(a, b)
    return a.name < b.name
  end)
  return by_name, items
end

local function appearance_list_ids()
  local ids = { TAG_LIST_ID, WOUND_LIST_ID }
  local seen = { [TAG_LIST_ID] = true, [WOUND_LIST_ID] = true }
  for index = 1, #APPEARANCE_FIELDS do
    local list_id = APPEARANCE_FIELDS[index].list_id
    if not seen[list_id] then
      seen[list_id] = true
      ids[#ids + 1] = list_id
    end
  end
  return ids
end

local function items_json(items)
  local parts = {}
  for index = 1, #items do
    parts[index] = string.format(
      '{"name":%s,"address":%s}',
      json_string(items[index].name),
      json_string(hex_addr(items[index].address))
    )
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

local function handle_appearance_catalog()
  local map, err = gamedb_lists()
  if not map then
    return 503, string.format('{"error":%s,"lists":{},"missing":[]}', json_string(err))
  end

  local lists = {}
  local missing = {}
  local ids = appearance_list_ids()
  for index = 1, #ids do
    local list_id = ids[index]
    local base = map[list_id]
    if not base then
      missing[#missing + 1] = list_id
      lists[#lists + 1] = json_string(list_id) .. ":[]"
    else
      local _, items = catalog_from_base(base)
      lists[#lists + 1] = json_string(list_id) .. ":" .. items_json(items)
    end
  end

  local missing_parts = {}
  for index = 1, #missing do
    missing_parts[index] = json_string(missing[index])
  end
  return 200, string.format(
    '{"lists":{%s},"missing":[%s]}',
    table.concat(lists, ","),
    table.concat(missing_parts, ",")
  )
end

local function read_rarity(orc)
  local addr, err = follow_offsets(orc, { 0x0, 0x20, 0x390 })
  if not addr then
    return "", err
  end
  return readString(addr, 64) or "", nil
end

local function handle_get_appearance()
  local orc, err = get_orc()
  if not orc then
    return 503, string.format('{"error":%s}', json_string(err))
  end

  local fields = {}
  for index = 1, #APPEARANCE_FIELDS do
    local spec = APPEARANCE_FIELDS[index]
    local value_addr, ferr = follow_offsets(orc, spec.offsets)
    local name = nil
    local ptr = 0
    local field_err = ferr
    if value_addr then
      ptr = readQword(value_addr) or 0
      if ptr ~= 0 then
        name = trait_name_from_ptr(ptr, nil)
      end
    end
    fields[#fields + 1] = string.format(
      '{"id":%s,"name":%s,"address":%s%s}',
      json_string(spec.id),
      name and json_string(name) or "null",
      json_string(hex_addr(ptr)),
      field_err and (',"error":' .. json_string(field_err)) or ""
    )
  end

  local rarity, rarity_err = read_rarity(orc)
  local tags, tag_err = read_tag_state(orc)
  local wounds, wound_err = read_wound_state(orc)

  local color_parts = {}
  local record = readQword(orc + APPEARANCE_RECORD_OFF)
  for index = 0, 16 do
    local offset = 0x178 + index * 4
    local argb = "00000000"
    local color_err = nil
    if record == nil or record == 0 then
      color_err = "appearance record is null"
    else
      argb = hex8(read_u32(record + offset))
    end
    color_parts[#color_parts + 1] = string.format(
      '{"id":"color-%d","label":%s,"offset":"%X","argb":%s%s}',
      index,
      json_string(APPEARANCE_COLOR_LABELS[index] or "? color"),
      offset,
      json_string(argb),
      color_err and (',"error":' .. json_string(color_err)) or ""
    )
  end

  local function list_body(state, list_err)
    if not state then
      return string.format('{"capacity":0,"items":[],"error":%s}', json_string(list_err or "unavailable"))
    end
    return string.format(
      '{"capacity":%d,"items":[%s]}',
      list_capacity(state.max_length, state.hard_cap),
      slots_json(state)
    )
  end

  return 200, string.format(
    '{"orc":%s,"rarity":%s%s,"fields":[%s],"tags":%s,"wounds":%s,"colors":[%s]}',
    json_string(hex_addr(orc)),
    json_string(rarity or ""),
    rarity_err and (',"rarityError":' .. json_string(rarity_err)) or "",
    table.concat(fields, ","),
    list_body(tags, tag_err),
    list_body(wounds, wound_err),
    table.concat(color_parts, ",")
  )
end

local function resolve_pointer(item, by_name)
  if is_json_null(item) or type(item) ~= "table" then
    return 0, nil
  end
  local name = item.name
  if is_json_null(name) or type(name) ~= "string" or name == "" then
    name = nil
  end
  local address = nil
  if type(item.address) == "string" then
    address = parse_hex(item.address)
  elseif type(item.address) == "number" then
    address = item.address
  end
  if name then
    local addr = by_name and by_name[name] or nil
    if addr == nil and address and address ~= 0 then
      print("[sow_trait_bridge] appearance catalog miss for " .. name .. ", using session address")
      return address, nil
    end
    if addr == nil then
      return nil, "unknown name: " .. name
    end
    return addr, nil
  end
  return address or 0, nil
end

local function catalog_by_name(list_id, cache, lists)
  if cache[list_id] then
    return cache[list_id], nil
  end
  local base = lists and lists[list_id] or nil
  if not base then
    return nil, "game database list not found: " .. list_id
  end
  local by_name = catalog_from_base(base)
  cache[list_id] = by_name
  return by_name, nil
end

local function prepare_pointer_list(state, items, by_name)
  local capacity = list_capacity(state.max_length, state.hard_cap)
  if #items > capacity then
    return nil, "too many entries (" .. tostring(#items) .. " > " .. tostring(capacity) .. ")"
  end
  local resolved = {}
  for index = 1, #items do
    local addr, err = resolve_pointer(items[index], by_name)
    if err then
      return nil, err
    end
    resolved[index] = addr
  end
  local new_count = #resolved
  while new_count > 0 and resolved[new_count] == 0 do
    new_count = new_count - 1
  end
  return { resolved = resolved, new_count = new_count }, nil
end

local function commit_pointer_list(state, prepared)
  local resolved = prepared.resolved
  local new_count = prepared.new_count
  for index = 1, new_count do
    writeQword(state.list_base + (index - 1) * state.stride, resolved[index] or 0)
  end
  local clear_until = state.count
  if new_count > clear_until then
    clear_until = new_count
  end
  for index = new_count + 1, clear_until do
    writeQword(state.list_base + (index - 1) * state.stride, 0)
  end
  writeQword(state.list_end_addr, state.list_base + new_count * state.stride)
end

local function handle_post_appearance(body)
  local payload, perr = json_parse(body)
  if not payload or type(payload) ~= "table" then
    return 400, string.format('{"error":%s}', json_string(perr or "bad json"))
  end
  if type(payload.fields) ~= "table" or type(payload.tags) ~= "table" or type(payload.wounds) ~= "table" or type(payload.colors) ~= "table" then
    return 400, '{"error":"appearance body requires fields, tags, wounds, and colors"}'
  end

  local orc, err = get_orc()
  if not orc then
    return 503, string.format('{"error":%s}', json_string(err))
  end

  local lists, lerr = gamedb_lists()
  if not lists then
    return 503, string.format('{"error":%s}', json_string(lerr))
  end
  local catalogs = {}

  local resolved_fields = {}
  for index = 1, #payload.fields do
    local item = payload.fields[index]
    if type(item) ~= "table" or type(item.id) ~= "string" then
      return 400, '{"error":"each appearance field needs an id"}'
    end
    local spec = field_by_id(item.id)
    if not spec then
      return 400, string.format('{"error":%s}', json_string("unknown appearance field: " .. item.id))
    end
    local by_name, cerr = catalog_by_name(spec.list_id, catalogs, lists)
    if not by_name then
      return 503, string.format('{"error":%s}', json_string(cerr))
    end
    local ptr, rerr = resolve_pointer(item, by_name)
    if rerr then
      return 400, string.format('{"error":%s}', json_string(spec.label .. ": " .. rerr))
    end
    local value_addr, ferr = follow_offsets(orc, spec.offsets)
    if not value_addr then
      return 503, string.format('{"error":%s}', json_string(spec.label .. ": " .. (ferr or "null pointer")))
    end
    resolved_fields[#resolved_fields + 1] = { addr = value_addr, ptr = ptr }
  end

  local tag_state, tag_err = read_tag_state(orc)
  if not tag_state then
    return 503, string.format('{"error":%s}', json_string(tag_err))
  end
  local wound_state, wound_err = read_wound_state(orc)
  if not wound_state then
    return 503, string.format('{"error":%s}', json_string(wound_err))
  end
  local tag_names, tag_cat_err = catalog_by_name(TAG_LIST_ID, catalogs, lists)
  if not tag_names then
    return 503, string.format('{"error":%s}', json_string(tag_cat_err))
  end
  local wound_names, wound_cat_err = catalog_by_name(WOUND_LIST_ID, catalogs, lists)
  if not wound_names then
    return 503, string.format('{"error":%s}', json_string(wound_cat_err))
  end

  local record = readQword(orc + APPEARANCE_RECORD_OFF)
  if record == nil or record == 0 then
    return 503, '{"error":"appearance record is null"}'
  end
  local colors = {}
  for index = 1, #payload.colors do
    local item = payload.colors[index]
    if type(item) ~= "table" or type(item.id) ~= "string" or type(item.argb) ~= "string" then
      return 400, '{"error":"each color needs an id and an ARGB hex string"}'
    end
    local color_index = tonumber(item.id:match("^color%-(%d+)$"))
    if color_index == nil or color_index < 0 or color_index > 16 then
      return 400, string.format('{"error":%s}', json_string("unknown color: " .. item.id))
    end
    local argb = item.argb:gsub("^0[xX]", "")
    if not argb:match("^[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]$") then
      return 400, string.format('{"error":%s}', json_string("color " .. item.id .. " must be 8 hex digits"))
    end
    colors[#colors + 1] = {
      addr = record + 0x178 + color_index * 4,
      value = tonumber(argb, 16),
    }
  end

  local rarity = payload.rarity
  if is_json_null(rarity) then
    rarity = ""
  end
  if type(rarity) ~= "string" then
    return 400, '{"error":"rarity must be a string"}'
  end
  rarity = rarity:gsub("%z", ""):sub(1, 63)
  local rarity_addr, rarity_err = follow_offsets(orc, { 0x0, 0x20, 0x390 })
  if not rarity_addr and rarity ~= "" then
    return 503, string.format('{"error":%s}', json_string("Orc Rarity (visual): " .. (rarity_err or "null pointer")))
  end

  local prepared_tags, tag_write_err = prepare_pointer_list(tag_state, payload.tags, tag_names)
  if tag_write_err then
    return 400, string.format('{"error":%s}', json_string("Tags: " .. tag_write_err))
  end
  local prepared_wounds, wound_write_err = prepare_pointer_list(wound_state, payload.wounds, wound_names)
  if wound_write_err then
    return 400, string.format('{"error":%s}', json_string("Wounds: " .. wound_write_err))
  end

  for index = 1, #resolved_fields do
    writeQword(resolved_fields[index].addr, resolved_fields[index].ptr or 0)
  end
  commit_pointer_list(tag_state, prepared_tags)
  commit_pointer_list(wound_state, prepared_wounds)
  for index = 1, #colors do
    write_u32(colors[index].addr, colors[index].value)
  end
  if rarity_addr then
    writeString(rarity_addr, rarity)
  end

  print(string.format(
    "[sow_trait_bridge] POST /appearance wrote %d fields, %d tags, %d wounds, %d colors",
    #resolved_fields,
    #payload.tags,
    #payload.wounds,
    #colors
  ))
  return handle_get_appearance()
end

local function normalize_path(path)
  path = tostring(path or "")
  path = path:gsub("\\", "/")
  path = path:gsub("%s+", "")
  path = path:match("^([^%?#]+)") or path
  if path ~= "" and path:sub(1, 1) ~= "/" then
    path = "/" .. path
  end
  path = path:gsub("/+$", "")
  return path
end

local function route_request(method, path, body)
  path = normalize_path(path)
  local key = method .. " " .. path
  if key == "GET /health" then
    return handle_health()
  elseif key == "GET /catalog" then
    return handle_catalog()
  elseif key == "GET /traits" then
    return handle_get_traits()
  elseif key == "POST /traits" then
    return handle_post_traits(body)
  elseif key == "GET /marker-catalog" then
    return handle_marker_catalog()
  elseif key == "GET /markers" then
    return handle_get_markers()
  elseif key == "POST /markers" then
    return handle_post_markers(body)
  elseif key == "GET /appearance" then
    return handle_get_appearance()
  elseif key == "POST /appearance" then
    return handle_post_appearance(body)
  elseif key == "GET /appearance-catalog" then
    return handle_appearance_catalog()
  end
  print("[sow_trait_bridge] no route for [" .. key .. "]")
  return 404, '{"error":"not found"}'
end

-- ---------------------------------------------------------------------------
-- File IPC polling loop
-- ---------------------------------------------------------------------------
local function write_atomic_response(req_id, status, body)
  local envelope = string.format('{"status":%d,"body":%s}', status, body)
  local tmp_path = BRIDGE_DIR .. "\\res_" .. req_id .. ".tmp"
  local final_path = BRIDGE_DIR .. "\\res_" .. req_id .. ".json"

  local f = io.open(tmp_path, "wb")
  if not f then
    print("[sow_trait_bridge] ERROR: failed to write " .. tmp_path)
    return
  end
  f:write(envelope)
  f:close()

  os.remove(final_path)
  os.rename(tmp_path, final_path)
end

local function extract_request_body(raw)
  -- Preferred: body embedded as a JSON object/array (from Next.js JSON.parse).
  local _, end_kw = raw:find('"body"%s*:%s*', 1)
  if not end_kw then
    return ""
  end
  local i = end_kw + 1
  while i <= #raw and raw:sub(i, i):match("%s") do
    i = i + 1
  end
  local start_ch = raw:sub(i, i)
  if start_ch == "n" and raw:sub(i, i + 3) == "null" then
    return ""
  end
  if start_ch == "{" or start_ch == "[" then
    local open_ch = start_ch
    local close_ch = start_ch == "{" and "}" or "]"
    local depth = 0
    local j = i
    while j <= #raw do
      local c = raw:sub(j, j)
      if c == '"' then
        j = j + 1
        while j <= #raw do
          local cj = raw:sub(j, j)
          if cj == "\\" then
            j = j + 2
          elseif cj == '"' then
            break
          else
            j = j + 1
          end
        end
      elseif c == open_ch then
        depth = depth + 1
      elseif c == close_ch then
        depth = depth - 1
        if depth == 0 then
          return raw:sub(i, j)
        end
      end
      j = j + 1
    end
    return ""
  end
  -- Legacy: body as a JSON string value
  local body_str = raw:match('"body"%s*:%s*"((?:\\.|[^"\\])*)"')
  if body_str then
    return body_str:gsub('\\"', '"'):gsub("\\\\", "\\")
  end
  return ""
end

local function process_request_file(filename)
  local req_id = filename:match("^req_([%w%-_]+)%.json$")
  if not req_id then
    return
  end

  local full_path = BRIDGE_DIR .. "\\" .. filename
  local f = io.open(full_path, "rb")
  if not f then
    return
  end
  local raw = f:read("*a")
  f:close()
  os.remove(full_path)

  if not raw or raw == "" then
    return
  end

  local method = raw:match('"method"%s*:%s*"([^"]+)"') or "GET"
  local path = raw:match('"path"%s*:%s*"([^"]+)"') or "/health"
  local body = extract_request_body(raw)

  print(string.format(
    "[sow_trait_bridge] %s %s body_len=%d",
    method:upper(),
    path,
    #body
  ))

  local ok, status, resp_body = pcall(route_request, method:upper(), path, body)
  if not ok then
    print("[sow_trait_bridge] ERROR: " .. tostring(status))
    write_atomic_response(
      req_id,
      500,
      string.format('{"error":%s}', json_string(tostring(status)))
    )
  else
    if status >= 400 then
      print(string.format("[sow_trait_bridge] %s %s -> %d %s", method:upper(), path, status, tostring(resp_body)))
    end
    write_atomic_response(req_id, status, resp_body)
  end
end

local function poll_once()
  if not bridge.running or bridge.busy then
    return
  end
  bridge.busy = true

  pcall(function()
    if type(getFileList) == "function" then
      local files = getFileList(BRIDGE_DIR)
      if type(files) == "table" then
        for _, full in ipairs(files) do
          local name = full:match("([^\\]+)$")
          if name and name:match("^req_[%w%-_]+%.json$") then
            process_request_file(name)
          end
        end
      end
    else
      local p = io.popen('dir /b "' .. BRIDGE_DIR .. '\\req_*.json" 2>nul')
      if p then
        for line in p:lines() do
          if line and line ~= "" then
            process_request_file(line)
          end
        end
        p:close()
      end
    end
  end)

  bridge.busy = false
end

local function start_bridge()
  pcall(function()
    os.execute('del /q "' .. BRIDGE_DIR .. '\\*.json" "' .. BRIDGE_DIR .. '\\*.tmp" 2>nul')
  end)

  bridge.running = true
  local t = createTimer(nil, false)
  t.Interval = POLL_INTERVAL_MS
  t.OnTimer = function()
    poll_once()
  end
  t.Enabled = true
  bridge.timer = t

  print(string.format("[sow_trait_bridge] File IPC bridge active on %s (polling every %dms)", BRIDGE_DIR, POLL_INTERVAL_MS))
  print("  Routes: GET /health, GET /catalog, GET /traits, POST /traits, GET /markers, POST /markers, GET /marker-catalog, GET /appearance, POST /appearance, GET /appearance-catalog")
  print("  Export CSV anytime: if _G.__sow_trait_bridge then _G.__sow_trait_bridge.exportCsv() end")
  print("  Stop bridge:        if _G.__sow_trait_bridge then _G.__sow_trait_bridge.stop() end")
end

function bridge.stop()
  bridge.running = false
  if bridge.timer then
    pcall(function()
      bridge.timer.Enabled = false
      bridge.timer.destroy()
    end)
    bridge.timer = nil
  end
  print("[sow_trait_bridge] File IPC bridge stopped")
end

start_bridge()