# DAW MCP Protocol Specification

JSON-RPC 2.0 protocol over TCP for communication between the MCP server and DAW extensions.

> **Version 0.8.4** - Core MIDI note manipulation and scene operations fully implemented. Auto-scene-creation ensures clips can always be created even when no empty slots exist. Clip stats now include grid detection with confidence scoring.

## Transport

- **Protocol**: TCP
- **Default Ports**: Bitwig 8181, Ableton 8182
- **Message Format**: JSON-RPC 2.0, newline-delimited

## Request Format

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "category.action",
  "params": {}
}
```

## Response Format

**Success:**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": { ... }
}
```

**Error:**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```

---

## Methods

### Project

#### `project.getInfo`

Get project information.

**Params:** none

**Result:**
```json
{
  "bpm": 120.0,
  "timeSignatureNumerator": 4,
  "timeSignatureDenominator": 4,
  "isPlaying": false,
  "isRecording": false
}
```

---

### Transport

#### `transport.setPosition`

Set playback position.

**Params:**
```json
{
  "beats": 4.0
}
```

**Result:** `{"success": true}`

#### `transport.togglePlay` (Bitwig only)

Toggle playback.

**Params:** none

**Result:** `{"success": true}`

#### `transport.toggleRecord` (Bitwig only)

Toggle recording.

**Params:** none

**Result:** `{"success": true}`

#### `transport.getStatus` (Bitwig only)

Get transport status.

**Params:** none

**Result:**
```json
{
  "isPlaying": true,
  "isRecording": false,
  "position": 8.0
}
```

---

### Track

#### `track.list`

List all tracks.

**Params:** none

**Result:**
```json
{
  "tracks": [
    {
      "index": 1,
      "name": "Bass",
      "type": "instrument",
      "volume": 0.8,
      "pan": 0.0,
      "mute": false,
      "solo": false
    }
  ]
}
```

#### `track.get`

Get single track info.

**Params:**
```json
{
  "trackIndex": 1
}
```

**Result:** Same as single track in `track.list`

#### `track.create`

Create a new track.

**Params:**
```json
{
  "type": "instrument",
  "name": "Synth",
  "position": -1
}
```
- `type`: "instrument", "audio", or "effect"
- `position`: 1-based index, -1 for end

**Result:** `{"success": true, "trackIndex": 5}`

#### `track.delete`

Delete a track.

**Params:**
```json
{
  "trackIndices": [1, 2]
}
```

**Result:** `{"success": true}`

#### `track.setName`

Set track name.

**Params:**
```json
{
  "trackIndex": 1,
  "name": "New Name"
}
```

**Result:** `{"success": true}`

#### `track.setVolume`

Set track volume.

**Params:**
```json
{
  "trackIndex": 1,
  "volume": 0.75
}
```

**Result:** `{"success": true}`

#### `track.setPan` (Bitwig only)

Set track pan.

**Params:**
```json
{
  "trackIndex": 1,
  "pan": 0.0
}
```

**Result:** `{"success": true}`

#### `track.setMute`

Set track mute state.

**Params:**
```json
{
  "trackIndex": 1,
  "mute": true
}
```

**Result:** `{"success": true}`

#### `track.setSolo`

Set track solo state.

**Params:**
```json
{
  "trackIndex": 1,
  "solo": true
}
```

**Result:** `{"success": true}`

#### `track.setArm` (Bitwig only)

Set track arm state.

**Params:**
```json
{
  "trackIndex": 1,
  "arm": true
}
```

**Result:** `{"success": true}`

#### `track.select`

Select a track in the DAW UI.

**Params:**
```json
{
  "trackIndex": 1
}
```

**Result:** `{"success": true}`

---

### Clip

#### `clip.list`

List clips with content in a track.

**Params:**
```json
{
  "trackIndex": 1
}
```
- `trackIndex`: optional, uses cursor track if omitted

**Result:**
```json
{
  "clips": [
    {
      "slotIndex": 1,
      "name": "Intro",
      "length": 4.0,
      "isPlaying": false,
      "isRecording": false
    }
  ]
}
```

#### `clip.create`

Create a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "lengthInBeats": 4,
  "name": "New Clip"
}
```
- `slotIndex`: optional, auto-finds empty slot if omitted

**Result:**
```json
{
  "success": true,
  "slotIndex": 1
}
```

#### `clip.delete`

Delete a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1
}
```

**Result:** `{"success": true}`

#### `clip.select`

Select a clip (moves cursor).

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1
}
```

**Result:** `{"success": true}`

#### `clip.getSelection`

Get currently selected clip position.

**Params:** none

**Result:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "hasClip": true
}
```

#### `clip.hasContent`

Check if a slot has a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1
}
```

**Result:**
```json
{
  "hasContent": true
}
```

#### `clip.findEmptySlots`

Find empty slots in a track.

**Params:**
```json
{
  "trackIndex": 1,
  "count": 3,
  "startSlot": 1
}
```

**Result:**
```json
{
  "emptySlots": [2, 5, 6]
}
```

#### `clip.getSceneCount`

Get total scene count in project.

**Params:** none

**Result:**
```json
{
  "sceneCount": 16
}
```

#### `clip.createScene`

Create new scene(s) at the end of the project.

**Params:**
```json
{
  "count": 1
}
```
- `count`: Number of scenes to create (default: 1)

**Result:**
```json
{
  "success": true,
  "created": 1,
  "sceneCount": 17
}
```

#### `clip.setName`

Set clip name.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "name": "Verse A"
}
```

**Result:** `{"success": true}`

#### `clip.setLength`

Set clip length.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "lengthInBeats": 8
}
```

**Result:** `{"success": true}`

#### `clip.stop`

Stop a playing clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1
}
```

**Result:** `{"success": true}`

---

### Notes

All note methods support optional `trackIndex/slotIndex` params. If omitted, uses cursor selection.

#### `clip.getNotes`

Get MIDI notes from a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "verbose": false
}
```

**Result (lean format, default):**
```json
{
  "notes": [[0, 60, 100, 0.5], [4, 64, 80, 0.25]],
  "count": 2,
  "clipLength": 4.0
}
```
Format: `[x (step), y (pitch), velocity (0-127), duration (beats)]`
- `clipLength`: Clip length in beats (used for stats calculations)

**Result (verbose):**
```json
{
  "notes": [
    {
      "x": 0,
      "y": 60,
      "velocity": 100,
      "duration": 0.5,
      "gain": 1.0,
      "pan": 0.0,
      "pressure": 0.0,
      "timbre": 0.0,
      "transpose": 0,
      "chance": 1.0,
      "muted": false
    }
  ],
  "count": 1,
  "clipLength": 4.0
}
```

#### `clip.setNote`

Add or modify a single note.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "velocity": 100,
  "duration": 0.5
}
```

**Result:** `{"success": true}`

#### `clip.clearNote`

Remove a single note.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60
}
```

**Result:** `{"success": true}`

#### `clip.clearAllNotes`

Remove all notes from a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1
}
```

**Result:** `{"success": true}`

#### `clip.clearNotesAtPitch`

Remove all notes at a specific pitch.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "pitch": 60
}
```

**Result:** `{"success": true}`

#### `clip.moveNote`

Move a note by offset.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "dx": 4,
  "dy": 0
}
```

**Result:** `{"success": true}`

#### `clip.transpose`

Transpose all notes in a clip.

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "semitones": 5
}
```

**Result:** `{"success": true}`

### Note Property Setters

These methods modify individual properties of existing notes.

#### `clip.setNoteVelocity`

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "velocity": 0.8
}
```
- `velocity`: 0.0 to 1.0 (normalized)

**Result:** `{"success": true}`

#### `clip.setNoteDuration`

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "duration": 0.5
}
```

**Result:** `{"success": true}`

#### `clip.setNoteGain` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "gain": 1.0
}
```

**Result:** `{"success": true}`

#### `clip.setNotePan` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "pan": 0.0
}
```
- `pan`: -1.0 to 1.0

**Result:** `{"success": true}`

#### `clip.setNotePressure` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "pressure": 0.5
}
```

**Result:** `{"success": true}`

#### `clip.setNoteTimbre` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "timbre": 0.0
}
```
- `timbre`: -1.0 to 1.0

**Result:** `{"success": true}`

#### `clip.setNoteTranspose` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "transpose": 12
}
```

**Result:** `{"success": true}`

#### `clip.setNoteChance` (Bitwig only)

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "chance": 0.5
}
```
- `chance`: 0.0 to 1.0 (probability)

**Result:** `{"success": true}`

#### `clip.setNoteMuted`

**Params:**
```json
{
  "trackIndex": 1,
  "slotIndex": 1,
  "x": 0,
  "y": 60,
  "muted": true
}
```

**Result:** `{"success": true}`

---

### Utility

#### `ping`

Health check.

**Params:** none

**Result:** `{"pong": true}`

---

## Device

Device operations act on the **cursor track's** device chain - whatever track
is selected in the DAW UI. There is no `trackIndex` parameter; the MCP server
sends `track.select` first when a caller supplies one.

`list`, `select`, `delete`, `getParameters`, and `setParameter` are
implemented on both DAWs. `listParameterPages`/`selectParameterPage` are
Bitwig only - Ableton devices have no remote-control-page concept, so
`device.getParameters` on Ableton returns every parameter on the device
directly (not one page of 8), and Ableton normalizes each parameter's native
range to 0.0-1.0 to match Bitwig's contract.

#### `device.list`

List devices in the cursor track's chain.

**Params:** `{}`

**Result:**
```json
{
  "devices": [{"index": 0, "name": "Polysynth"}],
  "count": 1
}
```

#### `device.select`

Move the cursor device to a chain position.

**Params:**
```json
{
  "index": 0
}
```

**Result:** `{"success": true}`

#### `device.delete`

Delete the device at a chain position.

**Params:**
```json
{
  "index": 0
}
```

**Result:** `{"success": true}`

#### `device.listParameterPages` (Bitwig only)

List the cursor device's remote control pages. The 8 parameters returned by
`device.getParameters` belong to one page.

**Params:** `{}`

**Result:**
```json
{
  "pages": [{"index": 0, "name": "OSC1"}, {"index": 3, "name": "FILTER"}],
  "count": 9,
  "selectedIndex": 0
}
```

#### `device.selectParameterPage` (Bitwig only)

Switch the active page.

**Params:**
```json
{
  "index": 3
}
```

**Result:** `{"success": true}`

#### `device.getParameters`

Read the cursor device's 8 generic remote control parameters.

**Params:** `{}`

**Result:**
```json
{
  "parameters": [
    {"index": 0, "name": "Cutoff", "value": 1.0, "displayedValue": "100 %"}
  ],
  "count": 8
}
```

#### `device.setParameter`

Set a remote control parameter. `index` is a fixed slot 0-7 and is **not**
index-converted. Uses `setImmediately` internally - see the note under
Error Handling about `set(double)` being discarded by take over mode.

**Params:**
```json
{
  "index": 1,
  "value": 0.65
}
```

**Result:** `{"success": true}`

---

## Browser

Thin, non-blocking primitives over Bitwig's popup browser. Results populate
asynchronously and Bitwig observers cannot fire while a handler blocks, so
each step returns immediately and the MCP server inserts `selectionDelayMs`
waits between calls.

#### `browser.open`

Open a browser session, cancelling any stale one first.

**Params:**
```json
{
  "mode": "end",
  "position": 0
}
```

`mode` is `end` (append to the cursor track's chain), `position` (insert at a
chain slot, requires `position`), or `replace` (open against the cursor
device).

**Result:** `{"success": true}`

**Note:** what the browser offers is scoped by insertion context. An empty
instrument track offers instruments; a chain that already has an instrument
offers audio effects.

#### `browser.getState`

**Params:** `{}`

**Result:**
```json
{
  "isOpen": true,
  "title": "Select content to insert into device chain",
  "contentType": "",
  "resultCount": 2284,
  "contentTypes": ["Devices", "Plug-ins", "Bitwig Presets", "Plug-in Presets", "Samples", "Multisamples", "Music", "Impulses", "Wavetables"]
}
```

`contentTypes` is present only while a session is open.

#### `browser.getResults`

Read the results column. Indices are 0-based.

**Params:** `{}`

**Result:**
```json
{
  "results": [{"index": 0, "name": "Chain", "isSelected": false}],
  "count": 2284,
  "totalCount": 2284
}
```

`count` is what the bank window holds, `totalCount` the true entry count.
They differ only when a result set exceeds `bitwig.browserResults`.

#### `browser.setFilter`

Select an entry in a filter column. An empty `value` selects the wildcard,
clearing that filter.

**Params:**
```json
{
  "column": "category",
  "value": "Bass"
}
```

`column` is one of `category`, `creator`, `tag`, `device`, `deviceType`,
`fileType`, `location`, `smartCollection`. Values are host-specific;
an unknown value is rejected with the column name, which is the practical
way to probe what exists.

**Result:** `{"success": true}`

#### `browser.select`

Select a result by 0-based index. Does not load it.

**Params:**
```json
{
  "index": 8
}
```

**Result:** `{"success": true}`

#### `browser.commit`

Commit the selection, loading it, and close the popup.

**Params:** `{}`

**Result:** `{"success": true}`

#### `browser.cancel`

Close without loading. Safe to call when no session is open.

**Params:** `{}`

**Result:** `{"success": true}`

#### `browser.setContentType` (non-functional)

Kept for diagnostics only. Verified against Bitwig: the call succeeds but the
results column does not change, by name or by index.

**Params:** `{"name": "Bitwig Presets"}` or `{"index": 2}`

**Result:** `{"success": true}`

---

## Index Convention

Indices on the wire are **0-based**. The MCP server converts the user-facing
1-based indices before sending, so `list_tracks` track 1 is `{"index": 0}` in
a `track.*` call.

Two exceptions are deliberately not converted, because they are fixed array
slots rather than positions:
- `device.setParameter` `index` (0-7, the remote control slot)
- `clip.setNote` `x`/`y` (step and pitch)

---

## Feature Parity

### DAW API Capabilities vs MCP Implementation

This table distinguishes between what each DAW's API supports and what's currently implemented in the MCP extensions.

#### Note Properties

| Feature | Bitwig API | Bitwig MCP | Ableton API | Ableton MCP |
|---------|------------|------------|-------------|-------------|
| Note velocity | Yes | Yes | Yes | Yes |
| Note duration | Yes | Yes | Yes | Yes |
| Note muted | Yes | Yes | Yes | Yes |
| Note gain | Yes | Yes | No | - |
| Note pan | Yes | Yes | No | - |
| Note pressure | Yes | Yes | No | - |
| Note chance | Yes | Yes | No | - |
| Note timbre | Yes | Yes | No | - |
| Note transpose | Yes | Yes | No | - |

#### Track Properties

| Feature | Bitwig API | Bitwig MCP | Ableton API | Ableton MCP |
|---------|------------|------------|-------------|-------------|
| Track name | Yes | Yes | Yes | Yes |
| Track volume | Yes | Yes | Yes | Yes |
| Track mute | Yes | Yes | Yes | Yes |
| Track solo | Yes | Yes | Yes | Yes |
| Track pan | Yes | Yes | Yes | **Not impl** |
| Track arm | Yes | Yes | Yes | **Not impl** |
| Track select | Yes | Yes | Yes* | **Not impl** |
| Track color | Yes | No | Yes | No |

*Via view API

#### Transport

| Feature | Bitwig API | Bitwig MCP | Ableton API | Ableton MCP |
|---------|------------|------------|-------------|-------------|
| Play/Stop | Yes | Yes | Yes | **Not impl** |
| Set position | Yes | Yes | Yes | Yes |
| Get tempo (BPM) | Yes | Yes | Yes | Yes |
| Set tempo (BPM) | Yes | No | Yes | **Not impl** |
| Time signature get | Yes | Yes | Yes | Yes |
| Time signature set | Yes | No | Yes | **Not impl** |
| Record toggle | Yes | Yes | Yes | **Not impl** |

#### Scene/Clip Operations

| Feature | Bitwig API | Bitwig MCP | Ableton API | Ableton MCP |
|---------|------------|------------|-------------|-------------|
| Scene count | Yes | Yes | Yes | Yes |
| Create scene | Yes | Yes | Yes | Yes |
| Delete scene | Yes | No | Yes | No |

**Legend:**
- **Yes** = Supported and implemented
- **No** = Not supported by DAW API
- **Not impl** = API supports it, but not yet implemented in MCP extension
- **-** = Not applicable

### Error Handling

Extensions return errors for unsupported features:
```json
{
  "error": {
    "code": -32001,
    "message": "Feature not supported: note.chance"
  }
}
```

---

## MCP Server Layer

The MCP server provides higher-level batch operations that call these protocol methods:

| MCP Tool | Protocol Methods Used |
|----------|----------------------|
| `batch_set_notes` | Multiple `clip.setNote` calls |
| `batch_clear_notes` | Multiple `clip.clearNote` or `clip.clearAllNotes` |
| `batch_move_notes` | Multiple `clip.moveNote` calls |
| `batch_set_note_properties` | Multiple `clip.setNote*` calls |
| `batch_create_clips` | `clip.findEmptySlots` + `clip.createScene` (if needed) + multiple `clip.create` |
| `batch_list_clips` | Multiple `clip.list` calls |
| `get_clip_stats` | `clip.getNotes` + analysis |
| `list_devices` | `track.select` (if trackIndex given) + `device.list` |
| `select_device` | `device.select` |
| `delete_device` | `device.delete` |
| `get_device_parameters` | `device.getParameters` |
| `set_device_parameter` | `device.setParameter` |
| `load_device` | `browser.open` + `browser.getResults` + `browser.select` + `browser.getResults` (verify) + `browser.commit` |
| `search_browser` | `browser.open` + `browser.setFilter` + `browser.getResults` + `browser.cancel` |
| `batch_create_euclid_pattern` | Pattern generation + `clip.create` + `clip.setNote` |
| `transpose_range` | `clip.getNotes` + filtering + `clip.moveNote` |
