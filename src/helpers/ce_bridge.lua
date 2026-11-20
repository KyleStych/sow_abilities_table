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

local function get_list_base_from_list_id(listid)
  local ok_db, db_addr = pcall(getAddress, "p_gamedb")
  if not ok_db or db_addr == nil or db_addr == 0 then
    return nil
  end
  local listind = 0
  while listind < 3000 do
    local listnum = string.format("%X", listind)
    local ok_b, base = pcall(getAddress, "[p_gamedb+50]+58*" .. listnum)
    if ok_b and base ~= nil and base ~= 0 then
      local namePtr = readPointer(base)
      if namePtr and namePtr ~= 0 then
        local name = readString(namePtr)
        if name == listid then
          return base
        end
      end
    end
    listind = listind + 1
  end
  return nil
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
  print("  Routes: GET /health, GET /catalog, GET /traits, POST /traits, GET /markers, POST /markers, GET /marker-catalog")
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