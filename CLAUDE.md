# DAW MCP Project

MCP server for controlling DAWs (Bitwig Studio, Ableton Live) from Claude.

## Scope: Session View / Clip Launcher Only

**This project intentionally targets only the clip launcher (Bitwig) / session view (Ableton) paradigm.** Arrangement view is out of scope.

**Rationale:**
- Clip launcher provides discrete, addressable units (track × slot) - ideal for AI-driven workflows
- Arrangement view has continuous timeline addressing - fragile, less intuitive for AI
- Bitwig's Control Surface API doesn't expose arrangement clips at all
- Ableton's API has arrangement access, but asymmetric support across DAWs is undesirable
- The user arranges clips into songs - that's human creative territory

**Implications:**
- No arrangement clip creation, reading, or note manipulation
- No Reaper support (Reaper lacks a clip launcher paradigm entirely)
- MIDI/OSC alternatives were considered but rejected - not worth the complexity

**Workflow:** AI generates clips in launcher slots → User arranges them into songs on timeline.

## Project Structure

- `bitwig-extension/` - Java extension for Bitwig Studio (TCP server on port 8181)
- `ableton-extension/` - Python MIDI Remote Script for Ableton Live (port 8182)
- `mcp-server/` - TypeScript MCP server that bridges Claude to DAW extensions

## Building (Development)

```bash
# Bitwig extension
cd bitwig-extension && gradle build && gradle copyExtension

# MCP server
cd mcp-server && npm install && npm run build
```

## Testing

Smoke tests only - none of these talk to a real DAW.

```bash
# MCP server: grid math, Euclidean generation, browser matching, note format conversion
cd mcp-server && npm test

# Bitwig extension: DeviceHandler validation logic, mocked via Mockito
cd bitwig-extension && gradle test

# Ableton extension: DeviceHandler validation + value normalization, faked Live API
python tests/test_ableton_device_handler.py -v
```

## Release Build

Creates a distributable ZIP with all components:

```bash
./scripts/release.sh 1.0.0
```

**Output:** `release/daw-mcp-1.0.0.zip` (~325KB)

**Contents:**
- `BitwigMCP.bwextension` - Java extension (cross-platform, single file)
- `AbletonMCP/` - Python Remote Scripts (cross-platform)
- `mcp-server.js` - Bundled MCP server (~215KB, requires Node.js)
- `config.example.json` - Example configuration
- `README.md` - Installation instructions

**How it works:**
1. Builds Bitwig extension via Gradle
2. Bundles MCP server with esbuild into single JS file
3. Copies Ableton Python scripts
4. Creates ZIP archive

**User installation:**
1. Extract ZIP
2. Copy `BitwigMCP.bwextension` to Bitwig extensions folder
3. Copy `AbletonMCP/` to Ableton Remote Scripts folder
4. Add to Claude config:
   ```json
   {
     "mcpServers": {
       "daw": {
         "command": "node",
         "args": ["/path/to/mcp-server.js"]
       }
     }
   }
   ```

## Architecture

```
Claude <-> MCP Server (stdio) <-> TCP <-> DAW Extension <-> DAW API
                                   │
                                   ├── :8181 Bitwig (Java)
                                   └── :8182 Ableton (Python)
```

## Key Files

### Bitwig Extension (Java)

| File | Purpose |
|------|---------|
| `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java` | Main extension entry point, creates API objects |
| `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/server/MCPServer.java` | TCP server, JSON-RPC handling |
| `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/ClipHandler.java` | MIDI note read/write operations |
| `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/CommandDispatcher.java` | Routes commands to handlers |
| `bitwig-extension/.../config/ConfigReader.java` | Java config file loading |

### Ableton Extension (Python)

| File | Purpose |
|------|---------|
| `ableton-extension/__init__.py` | Entry point for Live Remote Script |
| `ableton-extension/manager.py` | ControlSurface subclass, tick scheduler |
| `ableton-extension/tcp_server.py` | Non-blocking TCP server |
| `ableton-extension/handlers/clip.py` | MIDI note operations |

**Linux Development:** Ableton Live 12 runs via Lutris in Wine prefix at `/home/pta/Games/ableton`. Note: Wine doesn't follow symlinks, so files must be copied:
```bash
cp -r /home/pta/Develop/audio/daw-mcp/ableton-extension/* \
  /home/pta/Games/ableton/drive_c/users/pta/Documents/Ableton/User\ Library/Remote\ Scripts/AbletonMCP/
```

### MCP Server (TypeScript)

| File | Purpose |
|------|---------|
| `mcp-server/src/index.ts` | MCP tool definitions and command mapping |
| `mcp-server/src/daw-client.ts` | TCP client for DAW communication (lazy connections) |
| `mcp-server/src/config.ts` | Configuration file loading |
| `mcp-server/src/music-analysis.ts` | Tonal.js chord/scale/key detection |
| `mcp-server/src/euclidean.ts` | Euclidean rhythm generation (uses Tonal.js RhythmPattern) |

## Configuration

Both extensions and the MCP server read from a shared config file:

| Platform | Path |
|----------|------|
| Linux | `~/.config/daw-mcp/config.json` |
| macOS | `~/Library/Application Support/daw-mcp/config.json` |
| Windows | `%APPDATA%\daw-mcp\config.json` |

**Example config:**
```json
{
  "defaultDaw": "bitwig",
  "gridResolution": 16,
  "bitwig": {
    "port": 8181,
    "cursorClipLengthBeats": 128,
    "scenes": 128
  },
  "ableton": {
    "port": 8182
  },
  "mcp": {
    "selectionDelayMs": 400,
    "requestTimeoutMs": 10000
  },
  "tools": {
    "transpose_clip": true,
    "batch_move_notes": false
  }
}
```

### Grid Resolution

The global `gridResolution` setting affects both DAWs:

| gridResolution | stepSize | Musical Value |
|----------------|----------|---------------|
| 4              | 1.0      | 1/4 note      |
| 8              | 0.5      | 1/8 note      |
| 16             | 0.25     | 1/16 note     |
| 32             | 0.125    | 1/32 note     |

**Formulas:**
- `stepSize = 4 / gridResolution`
- `clipSteps = cursorClipLengthBeats × (gridResolution / 4)`

**Per-DAW behavior:**
- **Bitwig:** Notes are quantized to the grid (API limitation). The step size determines note positioning precision.
- **Ableton:** Notes can be placed at arbitrary positions. The grid is used only for `get_clip_stats` calculations (`beatGrid` and `density`).

**Defaults:** If config file is missing, all defaults are used. If a section is missing, that section uses defaults. Tools not listed default to enabled.

**Tool filtering:** Set any tool to `false` to disable it. Disabled tools won't appear in MCP tools list.

## Protocol

JSON-RPC 2.0 over TCP. Methods use dot notation: `track.list`, `clip.setNote`, `clip.getNotes`, etc.

## Unified Tool API

Tools use unified names (no DAW prefix) with an optional `daw` parameter:

```typescript
// Uses default DAW from config
batch_get_notes()
batch_list_clips()

// Explicit DAW selection for interop
batch_get_notes({daw: "ableton"})
batch_set_notes({daw: "bitwig", notes: [[0, 60, 100, 0.5]]})
```

### Available Tools (Enabled by Default)

| Category | Tools |
|----------|-------|
| Discovery | `get_daws` - check connected DAWs and default |
| Project | `get_project_info` |
| Tracks | `list_tracks` |
| Clips | `batch_list_clips`, `batch_create_clips`, `batch_delete_clips`, `set_clip_length` |
| Devices | `list_devices`, `select_device`, `get_device_parameters`, `set_device_parameter`, `delete_device`, `list_parameter_pages`, `select_parameter_page` |
| Device Loading | `load_device`, `search_browser` |
| MIDI Notes | `batch_get_notes`, `batch_set_notes`, `batch_clear_notes` |
| Analysis | `get_clip_stats` - stats + Tonal.js chord/scale/key detection |
| Generative | `batch_create_euclid_pattern` - Euclidean rhythms (multi-track/clip) |

### Optional Tools (Disabled by Default)

Enable in config with `"tool_name": true`:

| Tool | Use Case |
|------|----------|
| `batch_move_notes` | Shift note positions |
| `batch_set_note_properties` | Velocity, duration, MPE properties |
| `transpose_clip` | Transpose all notes in clip |
| `transpose_range` | Transpose notes in step range |
| `batch_create_tracks` | Create multiple tracks |
| `batch_delete_tracks` | Delete multiple tracks |
| `batch_set_track_properties` | Volume, pan, mute, solo |
| `browser_open` | Precise browser filter control |
| `browser_set_content_type` | Diagnostic only - verified non-functional in Bitwig |
| `browser_set_filter` | Precise browser filter control |
| `browser_get_results` | Precise browser filter control |
| `browser_select` | Precise browser filter control |
| `browser_commit` | Precise browser filter control |
| `browser_cancel` | Clear a stuck browser popup |
| `browser_get_state` | Inspect browser session state |

## Bitwig API Documentation

Local JavaDoc: `/opt/bitwig-studio/resources/doc/control-surface/api/index.html`

Key interfaces for MIDI note manipulation:
- `Clip` - clip operations, note grid, observers
- `CursorClip` - extends Clip with navigation (created in init, used for note editing)
- `NoteStep` - individual note properties (velocity, duration, pan, gain, chance, timbre, transpose, etc.)

### Bitwig API Constraints

Many Bitwig API objects can only be created during `init()`:
- `createLauncherCursorClip()` - must be called in init
- `addNoteStepObserver()` - must be registered in init
- Track banks, cursor tracks, transport - all created in init

The extension creates these during initialization and handlers use the pre-created objects.

### Optional Clip Selection - Cursor Follows User

All clip-related operations support optional `trackIndex/slotIndex` parameters. When omitted, operations use the cursor selection (the clip selected in DAW's UI).

**How it works:**
- The cursor clip is created from `cursorTrack` which follows user selection
- When `trackIndex/slotIndex` are omitted, the MCP server calls `clip.getSelection` to get current cursor position
- If no clip is selected, a clear error message is returned

**Examples:**
```typescript
// Use cursor selection (whatever user has selected in DAW)
batch_get_notes()
batch_set_notes({notes: [[0, 60, 100, 0.5]]})

// Explicit selection (1-based: track 1 = first track, slot 3 = third slot)
batch_get_notes({trackIndex: 1, slotIndex: 3})
batch_set_notes({trackIndex: 1, slotIndex: 3, notes: [[0, 60, 100, 0.5]]})

// List clips from cursor track
batch_list_clips()  // Uses cursor track
batch_list_clips({trackIndex: 4})  // Fourth track

// Cross-DAW operations
batch_get_notes({daw: "bitwig", trackIndex: 1, slotIndex: 1})
batch_set_notes({daw: "ableton", notes: [[0, 60, 100, 0.5]]})
```

**Affected tools:**
- `batch_get_notes`, `batch_set_notes`, `batch_clear_notes`, `set_clip_length`
- `batch_list_clips` (trackIndex only)
- `get_clip_stats`, `batch_create_euclid_pattern`
- Optional: `transpose_clip`, `batch_move_notes`, `batch_set_note_properties`, `transpose_range`

### Device Control - Cursor Device Model

Device operations act on the **cursor track's** device chain — whatever
track is currently selected in Bitwig's UI. There is no `trackIndex`
parameter for device tools (unlike clip tools); to control devices on a
different track, select that track in Bitwig first, or call `select_device`
after switching tracks via other means.

Within that device chain, `select_device` moves a second cursor (the
**cursor device**) to a specific device by 1-based position — this cursor
follows Bitwig's own device-selection UI, so selecting a device in Bitwig
also updates what `get_device_parameters`/`set_device_parameter` operate on.

**Parameters** are exposed via Bitwig's generic 8-slot "remote controls
page" (`createCursorRemoteControlsPage(8)`), which works uniformly across
any plugin type without per-plugin parameter typing. Parameter `index` is
0-7 and is NOT converted to 1-based (unlike track/device/clip indices) —
it's treated like a fixed array slot, matching the note `x`/`y` convention.

**Examples:**
```typescript
list_devices()                              // Devices on cursor track
select_device({index: 2})                   // Move cursor device to 2nd device
get_device_parameters()                     // Read cursor device's 8 params
set_device_parameter({index: 0, value: 0.75})  // Set first remote control
```

**Parameter pages.** The 8 slots are ONE page of several. Polysynth, for
example, has 9 pages - OSC1, OSC2, MIX, FILTER, FILTER/EG, AMP, Envelope,
Common, Vibrato - so reading only the first page reaches 8 of roughly 72
parameters and misses the filter and envelope entirely. Use
`list_parameter_pages` to see them and `select_parameter_page` to switch
which page `get_device_parameters`/`set_device_parameter` act on.

```typescript
list_parameter_pages()                         // 9 pages on Polysynth
select_parameter_page({index: 4})              // FILTER (1-based)
get_device_parameters()                        // Filt Freq, Reso, Keytrack...
set_device_parameter({index: 0, value: 0.32})  // 132 Hz
```

**Limitations:** Bitwig's 8-slot remote controls page is empty until a
remote controls page/macro mapping exists on the device — Bitwig auto-builds
one for many devices, but some plugins need manual mapping in Bitwig's UI
first. Bypass/enable toggling and per-plugin native parameter lists are out
of scope (see design spec).

### Device Loading - Browser Session Model

Loading a device goes through Bitwig's **popup browser**. Bitwig exposes no
way to look up a device's UUID at runtime (`createSpecificBitwigDevice`
consumes a UUID but nothing yields one), so direct insertion would require a
hardcoded ID table — the browser is the only reliable mechanism.

**Two layers:**

- **Atomic** (enabled by default): `load_device`, `search_browser`. Each
  opens a session, does its work, and always closes the popup before
  returning.
- **Session** (disabled by default): `browser_open`, `browser_set_filter`,
  `browser_get_results`, `browser_select`, `browser_commit`,
  `browser_cancel`, `browser_get_state`. Enable in config only when you need
  filter-column control the atomic tools do not expose.

**Two invariants:**

1. `load_device` never leaves the popup open — every failure path cancels
   it. The popup is modal in Bitwig's UI, so a leaked session would block
   you.
2. `search_browser` never commits — discovery cannot modify the project.

**Match selection** is deterministic: exact case-insensitive name match,
else a unique substring match, else the shortest substring match (with the
alternatives reported). The response always names what was actually loaded.

**Async results:** browser results populate asynchronously, and Bitwig's
observers cannot fire while a Java handler blocks. So the Java layer only
exposes non-blocking primitives, and the MCP server inserts
`mcp.selectionDelayMs` waits between steps. If searches come back
unexpectedly empty, raising that config value is the first thing to try.

**Result window:** `bitwig.browserResults` (default 4096) sizes the results
bank. It is deliberately large enough to hold a whole result set rather than
a window - a stock instrument browse reports 2284 entries, and reading all
2284 costs the same ~130ms as reading 256, because the round-trip dominates
rather than the item count. `search_browser` still reports `totalAvailable`
and a `truncated` flag, so a result set that does exceed the bank is visible
rather than silent.

**Browse results are scoped by insertion context.** Browsing at the end of an
empty instrument track offers instruments; browsing after an instrument
already in the chain offers audio effects. So `load_device({name: "Compressor"})`
legitimately finds nothing on an empty instrument track - that is Bitwig
scoping the browse, not a bug. Select a track whose chain already has an
instrument to reach audio effects.

**Filter columns work** (verified: `category` = "Bass" narrowed 2284 results
to 15). Values are host-specific and not guessable - `browser_set_filter`
rejects an unknown value with the column name, which is the practical way to
probe what exists. Note `deviceType` did not visibly narrow an
instrument-context browse, so filter behavior can itself depend on context.

### Known Bitwig API limitations (verified live, not theoretical)

These were found by testing against a running Bitwig instance. Each is a
call that **returns success while doing nothing** — assume nothing about
untested write paths.

| API | Behavior | Consequence |
|-----|----------|-------------|
| `SettableRangedValue.set(double)` | Subject to the controller's take over strategy; one-shot programmatic writes never "catch up" and are discarded | Use `setImmediately(double)` — done for track volume/pan and device parameters |
| `PopupBrowser.selectedContentTypeIndex().set(int)` | Inert — the index reads back unchanged (set to 2, still reads 0) and the results column never updates | Presets unreachable via the popup browser |
| `Device.createDeviceBrowser(int, int)` | Returns a `Browser` whose `exists()` is false, with a zero-size results bank, regardless of the sizes passed | The legacy `Browser`/`BrowsingSession` API — including `getPresetSession()` — is unusable |
| `Device.switchToNextPreset()` / `switchToPreviousPreset()` | Deprecated **and** inert | `next_preset`/`previous_preset` were removed |

`browser_set_content_type` is kept only as a diagnostic; it does not work.

**Preset loading is not currently achievable** through the Bitwig Controller
API. All three documented routes were tested against a running instance and
all three are dead: the popup browser cannot switch to a preset content type,
the legacy `Browser` API never instantiates, and `Device.switchToNextPreset()`
is deprecated and inert. `load_preset`, `next_preset` and `previous_preset`
were removed rather than shipped as tools that silently do nothing. Revisit
only if a future Bitwig release changes one of the three rows above.

**Examples:**
```typescript
search_browser({query: "poly"})              // Discover, loads nothing
load_device({name: "Polysynth"})             // Append to cursor track's chain
load_device({name: "EQ+", trackIndex: 2})    // Onto a specific track
```

**Config:** `bitwig.browserResults` (default 4096) sizes the results bank;
`bitwig.browserFilterSize` (default 32) sizes the filter column banks.

### Note positions are always beats

Every note tool takes `x` (and `dx`) as a **beat position**, never a step
index - `batch_set_notes`, `batch_clear_notes`, `batch_move_notes`,
`batch_set_note_properties`. A note written at `x: 2` is addressed as `x: 2`
by all of them, and fractional values like `1.5` are fine.

The Java layer converts beats to Bitwig's step grid internally. Two handlers
used to read `x` as a raw step index instead, so the same value addressed
different notes depending on the tool; that is fixed, and the schemas now
type `x` as `number` rather than `integer`.

### Shortening a clip is non-destructive

`set_clip_length` to a shorter value hides the notes past the new end -
they stop appearing in `batch_get_notes` and `get_clip_stats` - but they are
not deleted. Lengthening the clip again brings them back unchanged. Verified
live: an 8-beat clip with 5 notes reported 3 notes at length 4, then all 5
again at length 8.

### Note Reading (Pull-Based)

Notes are read via direct `getStep()` queries (not observer-based):
1. `ClipHandler.getNotes()` iterates through all step positions
2. For each position, `clip.getStep(channel, x, y).state()` is checked
3. Notes with `NoteOn` state are collected and returned

This pull-based approach is reliable and synchronous, avoiding race conditions with the async observer pattern.

### Clip Selection Timing

When providing explicit `trackIndex/slotIndex` parameters (instead of using cursor), a delay is added to allow the cursor clip to follow the selection (configurable via `mcp.selectionDelayMs`, default 400ms). This only applies when parameters are explicitly provided. Using cursor selection (omitting parameters) is instant. An observer-based settlement detection approach (replacing the fixed delay with a signal that the cursor has actually moved) was considered and deferred — no ETA.

### Ultra-Lean Note Format

**Read (`batch_get_notes`)** - default format:
```json
{"notes": [[0, 60, 100, 0.5], [4, 64, 80, 0.25]], "count": 2}
```
Format: `[x, y, velocity (0-127), duration]`. Use `verbose=true` for full properties.

**Write (`batch_set_notes`)** - accepts both:
```json
{"notes": [[0, 60, 100, 0.5]]}           // Ultra-lean (preferred)
{"notes": [{"x": 0, "y": 60, ...}]}      // Object format
```

~10-15x token reduction vs verbose format.

### Minimal Success Responses

All write operations return only `{"success": true}` on success. Error details included only on failure.

### Music Analysis (Tonal.js)

`get_clip_stats` includes music theory analysis via Tonal.js:

```json
{
  "noteCount": 24,
  "pitchClasses": [0, 2, 3, 5, 7, 8, 10],
  "analysis": {
    "chords": [{"beat": 0, "chord": "Cm", "type": "minor"}, ...],
    "suggestedScales": ["C minor", "Eb major", "F dorian"],
    "suggestedKey": "C minor",
    "rootNote": "C"
  }
}
```

### Euclidean Rhythm Patterns

`batch_create_euclid_pattern` generates mathematically distributed rhythms:

```typescript
// Classic drum pattern with kick, hihat, snare
batch_create_euclid_pattern({
  lengthBeats: 4,
  patterns: [
    { hits: 4, steps: 16, pitch: 36, velocity: 100 },           // kick: 4/4
    { hits: 7, steps: 16, pitch: 38, velocity: 80 },            // hihat: euclidean 7/16
    { hits: 2, steps: 16, pitch: 37, velocity: 90, rotate: 4 }  // snare: backbeat
  ]
})
```

Common patterns: tresillo (3,8), cinquillo (5,8), west african bell (7,16).

### Safe Clip Creation

`batch_create_clips` prevents accidental overwrites with two modes:

**Mode A: Auto-find empty slots** (omit `slotIndex`)
```typescript
// Creates 3 clips at first available empty slots from cursor
batch_create_clips({
  clips: [
    {lengthInBeats: 4, name: "Intro"},
    {lengthInBeats: 8, name: "Verse A"},
    {lengthInBeats: 16}
  ]
})
// Returns: {createdClips: [{trackIndex: 1, slotIndex: 5, lengthInBeats: 4, name: "Intro"}, ...]}
```

**Mode B: Targeted creation** (provide `slotIndex`)
```typescript
// Fails if slot 3 has content (unless overwrite=true)
batch_create_clips({
  clips: [{trackIndex: 1, slotIndex: 3, lengthInBeats: 4, name: "Bass Loop"}]
})
// Error: "Slot 3 on track 1 has content. Use overwrite=true to replace."
```

**Key behaviors:**
- Empty slots are found within actual project scene count (not bank size of 128)
- Returns `createdClips` array with exact positions for subsequent note operations
- Use `overwrite: true` to explicitly replace existing clips
- Mode A advances cursor position automatically when creating multiple clips
- Optional `name` parameter sets clip name after creation

### NoteStep Properties Available

Read/write:
- velocity, duration, gain, pan, pressure, timbre, transpose
- chance (probability), muted state
- position (x = step, y = pitch)

Read-only via observer:
- state (NoteOn, NoteContinue, Empty)
- channel

### Ableton Live Limitations

Some Bitwig features are not available in Ableton's Live API:
- Note chance, timbre, transpose, gain, pan (per-note MPE properties)
- Cursor clip tracking is polling-based (~100ms vs instant in Bitwig)
- `load_device`, `search_browser`, and the `browser_*` session tools are
  Bitwig-only - device loading goes through Bitwig's popup browser, which has
  no Ableton equivalent. Calling them with `daw: "ableton"` returns a clear
  error rather than doing nothing.
- `list_parameter_pages`/`select_parameter_page` are Bitwig-only - Ableton
  devices have no equivalent of Bitwig's fixed 8-slot remote-control page.
  `get_device_parameters` on Ableton returns every parameter on the device
  directly instead of one page of 8; `set_device_parameter`'s `index` is a
  position in that full list, not a page slot.

**Device parameters are value-normalized, not passed through raw.** Bitwig's
remote controls are natively 0.0-1.0. Ableton's `DeviceParameter.value` is in
the device's native range (e.g. Hz, dB) instead, so the Ableton extension
normalizes reads/writes against `param.min`/`param.max` to keep the tool's
0.0-1.0 contract consistent across both DAWs. Quantized parameters (toggles,
enum choices) are rounded to the nearest integer step on write.
