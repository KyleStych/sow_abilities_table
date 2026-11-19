--[[
  Shadow of War Trait Manager — Cheat Engine HTTP bridge
  ========================================================
  Setup:
    1. Attach CE to ShadowOfWar.exe and open SeiKur0's .CT
    2. Enable "Master Script" (registers p_gamedb)
    3. Enable "Uruk Pointer" and select an orc in the army menu
    4. Table → Execute Lua Script… (or Lua Engine) and run this file
    5. Smoke-test:  curl http://127.0.0.1:8080/health

  Listens on TCP port 8080 via CE's built-in createSocketServer (no LuaSocket).
  Endpoints:
    GET  /health
    GET  /catalog
    GET  /traits
    POST /traits   body: { "traits": [ { "address": "0x..." } | { "name": "..." } | null ] }

  Re-run this script to restart the server (previous listener is stopped).
  Requires a recent Cheat Engine build that exposes createSocketServer.
]]

local PORT = 8080
local SLOT_STRIDE = 0x20
local MAX_SLOTS = 56
local PICKER_LIST_ID = "Faction/Traits/Picker"

-- ---------------------------------------------------------------------------
-- Stop a previous bridge instance (same Lua state / re-execute)
-- ---------------------------------------------------------------------------
if _G.__sow_trait_bridge and _G.__sow_trait_bridge.stop then
  pcall(function()
    _G.__sow_trait_bridge.stop()
  end)
end

local bridge = {
  running = false,
  server = nil,
  thread = nil,
}
_G.__sow_trait_bridge = bridge

-- ---------------------------------------------------------------------------
-- JSON helpers (minimal; enough for our payloads)
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

-- Very small JSON array/object parser for POST /traits bodies.
local function parse_traits_body(body)
  local traits = {}
  if not body or body == "" then
    return nil, "empty body"
  end

  -- Prefer the "traits" field when present; otherwise treat body as a bare array.
  local arr = body:match('"traits"%s*:%s*(%b[])') or body:match("(%b[])")
  if not arr then
    return nil, "missing traits array"
  end

  -- Walk objects / nulls inside the array
  local i = 2 -- skip '['
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
-- Memory / game-DB helpers (mirrors SeiKur0 Master Script patterns)
-- ---------------------------------------------------------------------------
local function get_orc()
  local sym = getAddress("p_uruk")
  if sym == nil or sym == 0 then
    return nil, "symbol p_uruk not found — enable Uruk Pointer"
  end
  local orc = readQword(sym)
  if orc == nil or orc == 0 then
    return nil, "p_uruk is null — select an orc in the army menu"
  end
  return orc, nil
end

local function get_list_base_from_list_id(listid)
  if getAddress("p_gamedb") == nil then
    return nil
  end
  local listind = 0
  while listind < 3000 do
    local listnum = string.format("%X", listind)
    local base = getAddress("[p_gamedb+50]+58*" .. listnum)
    if base ~= nil and base ~= 0 then
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

local function build_picker_catalog()
  local by_name = {}
  local by_addr = {}
  local items = {}

  local base = get_list_base_from_list_id(PICKER_LIST_ID)
  if base == nil then
    return by_name, by_addr, items, "Faction/Traits/Picker list not found — enable Master Script"
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

local function read_picker_state()
  local orc, err = get_orc()
  if not orc then
    return nil, err
  end

  local list_base = readPointer(orc + 0x1E0)
  local list_end = readQword(orc + 0x1E8)
  local max_length = readInteger(orc + 0x1F0) or MAX_SLOTS

  if list_base == nil or list_base == 0 then
    return nil, "picker list base is null"
  end

  local count = 0
  if list_end and list_end ~= 0 and list_end >= list_base then
    count = math.floor((list_end - list_base) / SLOT_STRIDE)
  end
  if count < 0 then
    count = 0
  end
  if count > MAX_SLOTS then
    count = MAX_SLOTS
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
  }, nil
end

local function read_slot_bytes(list_base, index0)
  local addr = list_base + index0 * SLOT_STRIDE
  local bytes = readBytes(addr, SLOT_STRIDE, true)
  if type(bytes) ~= "table" then
    bytes = {}
    for i = 0, SLOT_STRIDE - 1 do
      bytes[i + 1] = readBytes(addr + i, 1) or 0
    end
  end
  return bytes
end

local function write_slot_bytes(list_base, index0, bytes)
  local addr = list_base + index0 * SLOT_STRIDE
  if type(bytes) == "table" then
    writeBytes(addr, bytes)
  else
    for i = 0, SLOT_STRIDE - 1 do
      writeBytes(addr + i, 0)
    end
  end
end

local function zero_slot(list_base, index0)
  local zeros = {}
  for i = 1, SLOT_STRIDE do
    zeros[i] = 0
  end
  write_slot_bytes(list_base, index0, zeros)
end

-- ---------------------------------------------------------------------------
-- HTTP handlers
-- ---------------------------------------------------------------------------
local function cors_headers()
  return table.concat({
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, POST, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type",
    "Access-Control-Max-Age: 86400",
  }, "\r\n")
end

local function http_response(status, body, content_type)
  body = body or ""
  content_type = content_type or "application/json; charset=utf-8"
  return table.concat({
    "HTTP/1.1 " .. status,
    "Content-Type: " .. content_type,
    "Content-Length: " .. tostring(#body),
    "Connection: close",
    cors_headers(),
    "",
    body,
  }, "\r\n")
end

local function handle_health()
  local state, err = read_picker_state()
  if not state then
    local body = string.format(
      '{"ok":false,"error":%s,"p_uruk":null,"count":0}',
      json_string(err)
    )
    return http_response("200 OK", body)
  end
  local body = string.format(
    '{"ok":true,"p_uruk":%s,"count":%d,"max_length":%d}',
    json_string(hex_addr(state.orc)),
    state.count,
    state.max_length
  )
  return http_response("200 OK", body)
end

local function handle_catalog()
  local _, _, items, err = build_picker_catalog()
  if err and #items == 0 then
    return http_response(
      "503 Service Unavailable",
      string.format('{"error":%s,"traits":[]}', json_string(err))
    )
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
  local body = '{"traits":[' .. table.concat(parts, ",") .. "]}"
  return http_response("200 OK", body)
end

local function handle_get_traits()
  local state, err = read_picker_state()
  if not state then
    return http_response(
      "503 Service Unavailable",
      string.format('{"error":%s}', json_string(err))
    )
  end

  local _, by_addr = build_picker_catalog()
  local parts = {}
  for i = 0, state.count - 1 do
    local slot_addr = state.list_base + i * SLOT_STRIDE
    local ptr = readQword(slot_addr) or 0
    local name = trait_name_from_ptr(ptr, by_addr)
    parts[#parts + 1] = string.format(
      '{"index":%d,"name":%s,"address":%s}',
      i + 1,
      name and json_string(name) or "null",
      json_string(hex_addr(ptr))
    )
  end

  local body = string.format(
    '{"orc":%s,"count":%d,"max_length":%d,"traits":[%s]}',
    json_string(hex_addr(state.orc)),
    state.count,
    state.max_length,
    table.concat(parts, ",")
  )
  return http_response("200 OK", body)
end

local function handle_post_traits(body)
  local incoming, perr = parse_traits_body(body)
  if not incoming then
    return http_response(
      "400 Bad Request",
      string.format('{"error":%s}', json_string(perr or "bad json"))
    )
  end

  local state, err = read_picker_state()
  if not state then
    return http_response(
      "503 Service Unavailable",
      string.format('{"error":%s}', json_string(err))
    )
  end

  local capacity = state.max_length
  if capacity <= 0 or capacity > MAX_SLOTS then
    capacity = MAX_SLOTS
  end
  if #incoming > capacity then
    return http_response(
      "400 Bad Request",
      string.format(
        '{"error":%s}',
        json_string(string.format("too many traits (%d > capacity %d)", #incoming, capacity))
      )
    )
  end

  local by_name, by_addr = build_picker_catalog()

  -- Snapshot existing slot payloads so reorder preserves non-pointer bytes.
  local old_by_ptr = {}
  for i = 0, state.count - 1 do
    local ptr = readQword(state.list_base + i * SLOT_STRIDE) or 0
    if ptr ~= 0 and old_by_ptr[ptr] == nil then
      old_by_ptr[ptr] = read_slot_bytes(state.list_base, i)
    end
  end

  local resolved = {}
  for i = 1, #incoming do
    local item = incoming[i]
    local addr = item.address
    if addr == nil and item.name ~= nil and item.name ~= "" then
      addr = by_name[item.name]
      if addr == nil then
        return http_response(
          "400 Bad Request",
          string.format('{"error":%s}', json_string("unknown trait name: " .. item.name))
        )
      end
    end
    if addr == nil then
      addr = 0
    end
    if addr ~= 0 and by_addr[addr] == nil and trait_name_from_ptr(addr, by_addr) == nil then
      -- Allow unknown pointers (mods) but warn in response later via name=null
    end
    resolved[#resolved + 1] = addr
  end

  -- Write slots: reuse prior 0x20 payload for known pointers; else pointer + zeros.
  for i = 1, capacity do
    local index0 = i - 1
    local addr = resolved[i]
    if addr == nil then
      zero_slot(state.list_base, index0)
    elseif addr == 0 then
      zero_slot(state.list_base, index0)
    else
      local bytes = old_by_ptr[addr]
      if bytes then
        write_slot_bytes(state.list_base, index0, bytes)
      else
        zero_slot(state.list_base, index0)
        writeQword(state.list_base + index0 * SLOT_STRIDE, addr)
      end
    end
  end

  local new_count = #resolved
  -- Trim trailing explicit clears from count (keep empties only if in the middle)
  while new_count > 0 and resolved[new_count] == 0 do
    new_count = new_count - 1
  end

  writeQword(state.orc + 0x1E8, state.list_base + new_count * SLOT_STRIDE)

  return handle_get_traits()
end

local function route_request(method, path, body)
  if method == "OPTIONS" then
    return http_response("204 No Content", "")
  end

  path = path:match("^([^%?]+)") or path

  if method == "GET" and path == "/health" then
    return handle_health()
  elseif method == "GET" and path == "/catalog" then
    return handle_catalog()
  elseif method == "GET" and path == "/traits" then
    return handle_get_traits()
  elseif method == "POST" and path == "/traits" then
    return handle_post_traits(body)
  end

  return http_response("404 Not Found", '{"error":"not found"}')
end

-- ---------------------------------------------------------------------------
-- TCP server (Cheat Engine createSocketServer)
--
-- Notes:
--  * Handle each client on the accept thread (CE sockets are not reliably
--    usable from nested createThread workers — that left ESTABLISHED hangs).
--  * Run memory read/write handlers via synchronize() on the CE main thread.
-- ---------------------------------------------------------------------------
local function bytes_to_string(bytes)
  if bytes == nil then
    return ""
  end
  if type(bytes) == "string" then
    return bytes
  end
  if type(bytes) == "table" and #bytes == 0 then
    return ""
  end
  if byteTableToString then
    local ok, s = pcall(byteTableToString, bytes)
    if ok and s then
      return s
    end
  end
  local chars = {}
  for i = 1, #bytes do
    chars[i] = string.char((bytes[i] or 0) % 256)
  end
  return table.concat(chars)
end

-- CE class methods: prefer colon calls (obj:method). Dot form is also tried
-- because some CE builds bind self automatically.
local function call_method(obj, name, ...)
  local args = { ... }
  local ok, a, b, c = pcall(function()
    local fn = obj[name]
    if type(fn) ~= "function" then
      error("no method " .. tostring(name))
    end
    return fn(obj, table.unpack(args))
  end)
  if ok then
    return true, a, b, c
  end
  ok, a, b, c = pcall(function()
    local fn = obj[name]
    if type(fn) ~= "function" then
      error("no method " .. tostring(name))
    end
    return fn(table.unpack(args))
  end)
  if ok then
    return true, a, b, c
  end
  return false, a
end

local function client_read_bytes(client, min_count)
  min_count = min_count or 1
  local ok, chunk = call_method(client, "readBytesMin", min_count)
  if not ok then
    return nil
  end
  return chunk
end

local function client_write_string(client, s)
  call_method(client, "lock")
  local ok = call_method(client, "writeString", s)
  call_method(client, "unlock")
  return ok
end

local function client_destroy(client)
  call_method(client, "destroy")
end

local function server_accept(server, wait)
  local ok, client = call_method(server, "acceptConnection", wait)
  if not ok then
    return nil, client
  end
  return client, nil
end

local function server_destroy(server)
  call_method(server, "destroy")
end

local function find_header_end(buf)
  local a = buf:find("\r\n\r\n", 1, true)
  if a then
    return a, 4
  end
  local b = buf:find("\n\n", 1, true)
  if b then
    return b, 2
  end
  return nil, nil
end

local function read_http_request(client)
  local buf = ""
  local header_end, sep_len

  while true do
    local chunk = client_read_bytes(client, 1)
    if chunk == nil then
      return nil, "connection closed before headers"
    end
    local piece = bytes_to_string(chunk)
    if piece == "" then
      return nil, "empty read while waiting for headers"
    end
    buf = buf .. piece
    header_end, sep_len = find_header_end(buf)
    if header_end then
      break
    end
    if #buf > 65536 then
      return nil, "headers too large"
    end
  end

  local header_text = buf:sub(1, header_end - 1)
  local leftover = buf:sub(header_end + sep_len)
  local lines = {}
  for line in (header_text .. "\n"):gmatch("(.-)\r?\n") do
    lines[#lines + 1] = line
  end

  local request_line = lines[1] or ""
  local method, path = request_line:match("^(%w+)%s+(%S+)")
  if not method or not path then
    return nil, "bad request line: " .. tostring(request_line)
  end

  local content_length = 0
  for i = 2, #lines do
    local cl = lines[i]:match("^[Cc][Oo][Nn][Tt][Ee][Nn][Tt]%-[Ll][Ee][Nn][Gg][Tt][Hh]%s*:%s*(%d+)")
    if cl then
      content_length = tonumber(cl) or 0
      break
    end
  end

  local body = leftover
  while #body < content_length do
    local chunk = client_read_bytes(client, 1)
    if chunk == nil then
      break
    end
    body = body .. bytes_to_string(chunk)
  end
  if content_length > 0 then
    body = body:sub(1, content_length)
  else
    body = ""
  end

  return { method = method:upper(), path = path, body = body }, nil
end

local function run_on_main(fn)
  if synchronize then
    local result
    synchronize(function()
      result = fn()
    end)
    return result
  end
  return fn()
end

local function handle_client(client)
  local ok, req_or_err = pcall(read_http_request, client)
  if not ok then
    print("[sow_trait_bridge] read error: " .. tostring(req_or_err))
    client_destroy(client)
    return
  end

  local req = req_or_err
  if not req or not req.method then
    print("[sow_trait_bridge] bad/empty request")
    client_destroy(client)
    return
  end

  print(string.format("[sow_trait_bridge] %s %s", req.method, req.path))

  local response = run_on_main(function()
    local ok2, result = pcall(route_request, req.method, req.path, req.body)
    if not ok2 then
      return http_response(
        "500 Internal Server Error",
        string.format('{"error":%s}', json_string(tostring(result)))
      )
    end
    return result
  end)

  client_write_string(
    client,
    response or http_response("500 Internal Server Error", '{"error":"no response"}')
  )
  client_destroy(client)
end

local function serve_loop(thread)
  -- IMPORTANT: create the socket server inside this thread.
  -- CE class userdata created on the main thread often becomes bare userdata
  -- (no metamethods) when used from createThread — which caused:
  --   attempt to index a userdata value (local 'server')
  local server = createSocketServer(PORT)
  if server == nil then
    print(string.format("[sow_trait_bridge] ERROR: createSocketServer(%d) failed", PORT))
    bridge.running = false
    return
  end

  bridge.server = server
  print(string.format("[sow_trait_bridge] listening on http://127.0.0.1:%d (createSocketServer)", PORT))
  print("  GET /health  GET /catalog  GET /traits  POST /traits")

  while bridge.running do
    if thread and thread.Terminated then
      break
    end

    -- false = do not block forever so bridge.stop() can flip running and
    -- this thread can destroy the server on the same thread that created it.
    local client, err = server_accept(server, false)
    if err and client == nil and bridge.running then
      -- Some CE builds only support blocking accept(true). Fall back once.
      client, err = server_accept(server, true)
      if err and client == nil then
        print("[sow_trait_bridge] accept error: " .. tostring(err))
        break
      end
    end

    if client then
      local okh, herr = pcall(handle_client, client)
      if not okh then
        print("[sow_trait_bridge] handler error: " .. tostring(herr))
        client_destroy(client)
      end
    elseif sleep then
      sleep(50)
    end
  end

  bridge.server = nil
  server_destroy(server)
  print("[sow_trait_bridge] server thread exited")
end

local function start_server()
  if type(createSocketServer) ~= "function" then
    print("[sow_trait_bridge] ERROR: createSocketServer is not available.")
    print("  Update Cheat Engine to a build that includes createSocketServer, then re-run.")
    return false
  end

  bridge.running = true

  if createThread then
    bridge.thread = createThread(function(t)
      serve_loop(t)
    end)
  else
    print("[sow_trait_bridge] WARNING: createThread missing; running blocking accept loop.")
    serve_loop(nil)
  end

  return true
end

function bridge.stop()
  -- Signal the server thread; it owns the socket and will destroy it.
  bridge.running = false
  -- If accept is blocked, poke the port so the thread can wake and exit.
  pcall(function()
    if getInternet then
      getInternet().getURL("http://127.0.0.1:" .. tostring(PORT) .. "/health")
    end
  end)
  if sleep then
    sleep(100)
  end
  print("[sow_trait_bridge] stop requested")
end

start_server()
