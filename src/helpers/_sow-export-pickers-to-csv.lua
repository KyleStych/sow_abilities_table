local targetDir = "C:\\Users\\lurch\\Pictures\\Shadow of War\\Characters"
os.execute('if not exist "' .. targetDir .. '" mkdir "' .. targetDir .. '"')

-- Dereferences a gamedb entry pointer (+0x20 -> string) just like SeiKur0's Master Script
local function resolveGamedbName(hexStr, record)
    if not hexStr or hexStr == "" or hexStr == "??" then
        return "<Invalid>"
    end

    local addr = tonumber(hexStr, 16)
    if not addr or addr == 0 then
        return "<None>"
    end

    -- 1. Try reading the string pointer at [entryBase + 0x20]
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
    if ok and str then return str end

    -- 2. Fallback: look up the hex key in the MemoryRecord's DropDownList if populated
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

-- Helper to get list_maxlength from a group record
local function getMaxLength(record, fallback)
    for i = 0, record.Count - 1 do
        local c = record.Child[i]
        if c and c.Description == "list_maxlength" then
            local val = tonumber(c.Value)
            if val then return val end
        end
    end
    return fallback
end

-- Helper to format hex values cleanly (and prevent Excel from stripping leading zeroes if desired)
local function cleanVal(val)
    if not val or val == "" then return "<None>" end
    return val
end

local function exportCompleteOrcProfile()
    local al = getAddressList()

    -- Grab Orc Name
    local orcName = "Unknown_Orc"
    local nameRecord = al.getMemoryRecordByDescription("Name (visual)")
    if nameRecord and nameRecord.Value and nameRecord.Value ~= "" then
        orcName = nameRecord.Value
    end
    local safeFileName = orcName:gsub("[<>:\"/\\|?*]", "")
    if safeFileName == "" then safeFileName = "Unknown_Orc" end

    local filename = targetDir .. "\\" .. safeFileName .. "_" .. os.time() .. ".csv"
    local file = io.open(filename, "w")
    if not file then
        print("Error: Could not open file for writing at " .. filename)
        return
    end

    file:write("Category,Property/Slot,Name,HexValue\n")

    local function writeRow(category, slot, name, hexVal)
        -- Escape commas if any appear in names
        name = tostring(name):gsub(",", ";")
        hexVal = tostring(hexVal):gsub(",", ";")
        file:write(string.format("%s,%s,%s,%s\n", category, slot, name, hexVal))
    end

    -- 1. IDENTITY
    writeRow("Identity", "Name", orcName, "")
    local lvlRec = al.getMemoryRecordByDescription("Level-1")
    if lvlRec and tonumber(lvlRec.Value) then
        writeRow("Identity", "Level", tostring(tonumber(lvlRec.Value) + 1), lvlRec.Value)
    end

    -- 2. ADDITIONAL PROPERTIES
    local addRec = al.getMemoryRecordByDescription("Additional Properties")
    if addRec then
        for i = 0, addRec.Count - 1 do
            local child = addRec.Child[i]
            if child then
                local desc = child.Description
                local val = cleanVal(child.Value)
                if desc == "Orc Rarity (visual)" then
                    writeRow("Additional Properties", desc, val, "")
                else
                    writeRow("Additional Properties", desc, resolveGamedbName(val, child), val)
                end
            end
        end
    end

    -- 3. EQUIPMENT / LOOKS (Tags, Wounds, Colors, and Gear/Models)
    local equipRec = al.getMemoryRecordByDescription("Equipment/Looks")
    if equipRec then
        for i = 0, equipRec.Count - 1 do
            local child = equipRec.Child[i]
            if child then
                local desc = child.Description

                if desc == "Tags" then
                    local maxTags = math.min(getMaxLength(child, 16), 16)
                    for j = 0, child.Count - 1 do
                        local sub = child.Child[j]
                        if sub then
                            local slotNum = tonumber(sub.Description:match("%d+"))
                            if slotNum and slotNum <= maxTags then
                                local val = cleanVal(sub.Value)
                                writeRow("Equipment - Tags", sub.Description, resolveGamedbName(val, sub), val)
                            end
                        end
                    end

                elseif desc == "Wounds" then
                    local maxWounds = math.min(getMaxLength(child, 8), 8)
                    for j = 0, child.Count - 1 do
                        local sub = child.Child[j]
                        if sub then
                            local slotNum = tonumber(sub.Description:match("%d+"))
                            if slotNum and slotNum <= maxWounds then
                                local val = cleanVal(sub.Value)
                                writeRow("Equipment - Wounds", sub.Description, resolveGamedbName(val, sub), val)
                            end
                        end
                    end

                elseif desc == "Colors (ARGB)" then
                    for j = 0, child.Count - 1 do
                        local sub = child.Child[j]
                        if sub then
                            local val = cleanVal(sub.Value)
                            writeRow("Equipment - Colors (ARGB)", sub.Description, val, val)
                        end
                    end

                else
                    -- Direct gear, model, and appearance entries (helmet, chest, body model, etc.)
                    local val = cleanVal(child.Value)
                    writeRow("Equipment and Looks", desc, resolveGamedbName(val, child), val)
                end
            end
        end
    end

    -- 4. MARKER ABILITIES (Bounded by list_maxlength, capped at 32)
    local markerRec = al.getMemoryRecordByDescription("Marker abilities")
    if markerRec then
        local maxMarkers = math.min(getMaxLength(markerRec, 32), 32)
        for i = 0, markerRec.Count - 1 do
            local child = markerRec.Child[i]
            if child then
                local slotNum = tonumber(child.Description:match("%d+"))
                if slotNum and slotNum <= maxMarkers then
                    local val = cleanVal(child.Value)
                    writeRow("Marker Abilities", child.Description, resolveGamedbName(val, child), val)
                end
            end
        end
    end

    -- 5. PICKER ABILITIES (Always read all 56 slots in SeiKur0's table)
    local pickerRec = al.getMemoryRecordByDescription("Picker abilities")
    if pickerRec then
        for i = 0, pickerRec.Count - 1 do
            local child = pickerRec.Child[i]
            if child then
                local slotNum = tonumber(child.Description:match("%d+"))
                if slotNum and slotNum <= 56 then
                    local val = cleanVal(child.Value)
                    writeRow("Picker Abilities", child.Description, resolveGamedbName(val, child), val)
                end
            end
        end
    end

    file:close()
    print("Successfully exported complete profile to: " .. filename)
end

exportCompleteOrcProfile()