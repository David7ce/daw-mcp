# Ableton Live Extension

Python MIDI Remote Script for controlling Ableton Live via MCP.

## Architecture

```
Claude <-> MCP Server (TypeScript) <-> TCP :8182 <-> This Script <-> Live API
```

Key design decisions:
- Non-blocking TCP socket (Live's Python doesn't support threading)
- 100ms polling via `schedule_message()` cooperative scheduler
- JSON-RPC 2.0 protocol (same as Bitwig extension)

## Installation

Copy this folder to your Remote Scripts directory:

- **Windows:** `C:\Users\<username>\Documents\Ableton\User Library\Remote Scripts\AbletonMCP\`
- **macOS:** `/Users/<username>/Music/Ableton/User Library/Remote Scripts/AbletonMCP/`
- **Linux (Wine/Lutris):** Copy files (symlinks don't work in Wine):
  ```bash
  cp -r /path/to/daw-mcp/ableton-extension/* \
    <wine_prefix>/drive_c/users/<user>/Documents/Ableton/User\ Library/Remote\ Scripts/AbletonMCP/
  ```

Then select "AbletonMCP" as a control surface in Live's preferences (Link, Tempo, MIDI tab).

## File Structure

| File | Purpose |
|------|---------|
| `__init__.py` | Entry point, `create_instance()` |
| `manager.py` | ControlSurface subclass, tick scheduler |
| `tcp_server.py` | Non-blocking TCP server, JSON-RPC handling |
| `dispatcher.py` | Routes JSON-RPC commands to handlers |
| `handlers/base.py` | Base handler class |
| `handlers/project.py` | Project info (BPM, time signature) |
| `handlers/transport.py` | Playback position |
| `handlers/track.py` | Track list/create/delete/select/properties |
| `handlers/clip.py` | MIDI note and clip/scene operations |
| `handlers/device.py` | Device chain list/select/delete/parameters |

## Supported Commands

- `project.getInfo` - Get BPM, time signature, playback state
- `transport.setPosition` - Set playback position in beats
- `track.list` / `track.create` / `track.delete` / `track.select` - Track CRUD
- `track.setName` / `track.setVolume` / `track.setMute` / `track.setSolo` - Track properties
- `clip.list` / `clip.create` / `clip.delete` / `clip.select` / `clip.getSelection` / `clip.hasContent`
- `clip.setName` / `clip.setLength` / `clip.stop` / `clip.findEmptySlots`
- `clip.getSceneCount` / `clip.createScene`
- `clip.getNotes` / `clip.setNotes` / `clip.setNote` / `clip.moveNote` / `clip.transpose`
- `clip.clearAllNotes` / `clip.clearNotesAtPitch` / `clip.clearNote`
- `clip.setNoteVelocity` / `clip.setNoteDuration` / `clip.setNoteMuted`
- `device.list` / `device.select` / `device.delete`
- `device.getParameters` / `device.setParameter` - values normalized 0.0-1.0
- `device.listParameterPages` / `device.selectParameterPage` - always error
  (no page concept in Live's API; `device.getParameters` already returns
  every parameter)

`browser.*` methods return a clear "Bitwig-only" error - Live has no
equivalent of Bitwig's popup browser.

## Testing

Smoke tests against a faked Live API - no Ableton instance needed, and none
of them talk to the real `Live` module. Run from the repo root:

```bash
python tests/test_ableton_device_handler.py -v
python tests/test_ableton_clip_handler.py -v
python tests/test_ableton_track_handler.py -v
python tests/test_ableton_project_transport_handler.py -v
```

Also run automatically on every push/PR by `.github/workflows/test.yml`.
The fakes check this extension's own logic (validation, unit conversion,
value normalization) - not that the real Live API objects behave the way
the fakes assume, so a live smoke test is still worth doing after any
change here.

## Limitations vs Bitwig

Some Bitwig features are not available in Ableton's Live API:
- Per-note MPE properties (chance, timbre, transpose, gain, pan)
- Cursor clip tracking is polling-based (~100ms vs instant in Bitwig)
- Device parameter pages (Live devices expose one flat parameter list)
- Device loading via browser (`load_device`/`search_browser` are Bitwig-only)

## References

- [AbletonOSC](https://github.com/ideoforms/AbletonOSC) - Reference implementation (MIT licensed)
- Ableton Push2 scripts - Official API usage examples
