# TODO

- Ableton device support is still unverified against a real Ableton
  instance - the fakes in `tests/test_ableton_device_handler.py` check the
  handler's own logic, not that the real Live API objects behave the way
  the fakes assume. Flag any issues here if it misbehaves.
- `batch_create_tracks`'s 50ms settle delay was just proven too short live
  (2026-08-19, while building a demo song): creating an instrument track
  landed it before the existing "FX 1" effect track (Bitwig groups
  instrument/audio tracks before effect tracks regardless of `position:
  -1`), and the too-short delay made the before/after name-diff misread
  the boundary, silently renaming "FX 1" to the new track's name instead
  of the actual new track. Recovered manually via `batch_set_track_properties`.
  Fixed in source (`tracks.ts`/`clips.ts` now use `config.mcp.selectionDelayMs`
  instead of a hardcoded `50`) but **not yet deployed** - the installed
  bundle this Claude Code setup actually runs
  (`C:\Users\d7\.local\daw-mcp\mcp-server\dist\mcp-server.js`) needs
  `cd mcp-server && npm run bundle`, a copy to that path, and the node
  process actually killed (not just reconnected - see the identical dance
  documented in CHANGELOG.md's "batch_create_tracks fix verified live"
  entry) before this fix takes effect. Left undeployed here since
  restarting that process mid-session would have dropped the live Bitwig
  connection this session's work depended on.
