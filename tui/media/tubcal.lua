-- Tubcal's part inside mpv: chapters, the skip-opening cue and the next-episode key.
-- Driven by script-messages from the terminal; answers with script-messages that the
-- terminal reads off the IPC socket (as client-message events).

local utils = require "mp.utils"

local skip = nil        -- {intro={start,end}, outro={start,end}, auto=bool}
local cue_on = false
local cue_kind = nil
local auto_done = false
local has_next = false

local function seconds(t)
    return tonumber(t) or 0
end

local function hide_cue()
    if cue_on then
        mp.remove_key_binding("tubcal-skip")
        mp.osd_message("", 0)
        cue_on, cue_kind = false, nil
    end
end

local function show_cue(kind, target)
    if cue_on and cue_kind == kind then return end
    hide_cue()
    local label = kind == "intro" and "Skip opening" or (has_next and "Next episode" or "Skip ending")
    mp.add_forced_key_binding("s", "tubcal-skip", function()
        hide_cue()
        if kind == "outro" and has_next then
            mp.commandv("script-message", "tubcal-event", "next")
        else
            mp.commandv("seek", tostring(target), "absolute")
        end
    end)
    mp.osd_message(label .. "  ·  s", 3600)
    cue_on, cue_kind = true, kind
end

mp.observe_property("time-pos", "number", function(_, pos)
    if not skip or not pos then return end
    local intro, outro = skip.intro, skip.outro
    if intro and pos >= seconds(intro.start) and pos < seconds(intro["end"]) - 1 then
        if skip.auto and not auto_done then
            auto_done = true
            mp.commandv("seek", tostring(seconds(intro["end"])), "absolute")
            mp.osd_message("Skipped the opening", 2)
            return
        end
        show_cue("intro", seconds(intro["end"]))
    elseif outro and pos >= seconds(outro.start) and pos < seconds(outro["end"]) - 1 then
        show_cue("outro", seconds(outro["end"]))
    else
        hide_cue()
    end
end)

mp.register_script_message("tubcal-chapters", function(json)
    local list = utils.parse_json(json or "[]") or {}
    local chapters = {}
    for _, c in ipairs(list) do
        chapters[#chapters + 1] = {time = seconds(c.start), title = c.title or ""}
    end
    mp.set_property_native("chapter-list", chapters)
end)

mp.register_script_message("tubcal-skip", function(json)
    skip = utils.parse_json(json or "null")
    auto_done = false
    hide_cue()
end)

mp.register_script_message("tubcal-has-next", function(flag)
    has_next = flag == "yes"
end)

mp.add_key_binding("N", "tubcal-next", function()
    mp.commandv("script-message", "tubcal-event", "next")
end)

mp.register_event("end-file", function()
    skip, auto_done = nil, false
    hide_cue()
end)
