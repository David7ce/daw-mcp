# Device/Parameter Control — Design Spec

Date: 2026-08-17

## Goal

Add device (plugin/instrument/effect chain) discovery and parameter
read/write to the Bitwig MCP extension, so Claude can inspect and tweak
sound-design parameters (macros, EQ, synth params) without leaving the
clip-launcher-only scope already established for this project.

## Scope

- Cursor-only addressing: all device operations act on the device
  chain of `cursorTrack` (whatever track is selected in Bitwig's UI),
  matching the existing cursor-follows-selection model used for clips.
  No arbitrary `trackIndex` parameter for device ops.
- Device chain listing (position, name, type, enabled state).
- Cursor device selection by chain index.
- Generic 8-parameter "remote controls page" read/write — works
  uniformly across any plugin type without per-plugin parameter
  typing.
- Out of scope: bypass/enable toggle, per-plugin native parameter
  lists (beyond the 8-slot remote page), nested device chains
  (devices inside devices/racks).

## Architecture

### Bitwig extension (Java)

`BitwigMCPExtension.java` additions, created in `init()` (Bitwig API
objects must be created there):

- `cursorDevice = cursorTrack.createCursorDevice("MCP_DEVICE", "MCP Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION)`
- `deviceBank = cursorTrack.createDeviceBank(N)` — for listing the
  device chain (N configurable, default reasonable size e.g. 8)
- `remoteControls = cursorDevice.createCursorRemoteControlsPage(8)` —
  8 generic parameters
- `markInterested()` on: device bank items' `name()`/`exists()`/
  `position()`; remote control params' `name()`/`value()`/
  `displayedValue()`
- Getters: `getCursorDevice()`, `getDeviceBank()`, `getRemoteControls()`
  (same pattern as `getCursorClip()`)

New `handlers/DeviceHandler.java`, following `TrackHandler.java`'s
shape (index validation via `getValidatedX` helper, `successResponse()`
for writes):

| Action | Params | Behavior |
|---|---|---|
| `list` | none | Iterate `deviceBank`, return existing devices with position/name/type |
| `select` | `index` | `deviceBank.getItemAt(index).selectInEditor()` to move cursor device |
| `getParameters` | none | Return 8 remote control params: name, value (0.0-1.0), displayedValue (string) |
| `setParameter` | `index` (0-7), `value` (0.0-1.0) | `remoteControls.getParameter(index).value().set(value)`, clamped |

`CommandDispatcher.java`: add `case "device": return deviceHandler.handle(action, params);`

### MCP server (TypeScript)

New tools in `mcp-server/src/index.ts`, mapped to `device.*` JSON-RPC
methods, added to the enabled-by-default tool table:

- `list_devices` → `device.list`
- `select_device` → `device.select`
- `get_device_parameters` → `device.getParameters`
- `set_device_parameter` → `device.setParameter`

No `daw` prefix needed beyond the existing unified `{daw?: "bitwig"|"ableton"}`
convention — these tools are Bitwig-only for now (Ableton parity is a
separate future task, not blocking this one, consistent with existing
optional-tool asymmetry in the project).

## Error handling

- No device selected in Bitwig UI → clear error message (mirrors
  clip's no-selection error): `"No device selected. Select a device in Bitwig."`
- `select` with out-of-range `index` → `IllegalArgumentException`,
  same style as `TrackHandler.getValidatedTrack`.
- `setParameter` with `index` outside 0-7 → `IllegalArgumentException`.
- `value` clamped to [0.0, 1.0] the same way `track.volume()`/`track.pan()`
  are clamped in `TrackHandler`.

## Testing

Project has no Java unit tests currently — verification is manual/E2E
(per existing `73ce8e3` commit pattern). Test plan:

1. Build extension (`gradle build && gradle copyExtension`), reload in
   Bitwig.
2. Load a track with an instrument or effect that has a device chain.
3. Select a device in Bitwig's UI, exercise `device.list` — verify
   chain contents match.
4. `device.select` a different index — verify Bitwig UI cursor moves.
5. `device.getParameters` — verify names/values match the 8 remote
   control slots (may need to build a remote controls page on the
   device in Bitwig if none exists by default).
6. `device.setParameter` — verify value changes reflect in Bitwig UI.
7. No-selection case — verify clear error, not a crash.

## Documentation updates

`CLAUDE.md`: add device tools to "Available Tools" table, add a
"Device Control" subsection near "Optional Clip Selection" explaining
the cursor-device model, matching the existing prose style.
