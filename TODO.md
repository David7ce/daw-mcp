# TODO

## Done (2026-08-19)

- Removed `batch_operations`/`transport_set_position` doc and config
  references — neither had an implementation.
- Documented `delete_device`, `list_parameter_pages`, `select_parameter_page`
  in CLAUDE.md's tool table.
- Fixed the dangling `docs/OPTIMIZATION_IDEAS.md` reference (file never
  existed) — inlined the one relevant sentence instead.
- **Ableton device control**: added `ableton-extension/handlers/device.py`
  (list/select/delete/getParameters/setParameter) and wired it into
  `dispatcher.py`, so `list_devices`, `select_device`, `delete_device`,
  `get_device_parameters`, `set_device_parameter` now work with
  `daw: "ableton"`, not just Bitwig. Parameter values are normalized to
  0.0-1.0 against each `DeviceParameter`'s native min/max to match Bitwig's
  contract; quantized parameters round to the nearest step on write.
  `list_parameter_pages`/`select_parameter_page` stay Bitwig-only (Live
  devices have no page concept) and return a clear error on Ableton rather
  than pretending to support it.
  Also added `track.select` to `ableton-extension/handlers/track.py` — it
  didn't exist, so any `trackIndex` passed to a device tool would have
  failed even after the above.
  **Not tested against a live Ableton instance** — the user doesn't have
  Ableton available. Built on stable, long-documented Live API surface
  (`track.devices`, `track.delete_device`, `track.view.selected_device`,
  `DeviceParameter.value/min/max/is_quantized/str_for_value`), matching
  patterns already used elsewhere in this file (e.g. `clip.py`'s
  `handle_select`). Worth a real smoke test next time Ableton is available.
  `load_device`/`search_browser`/`browser_*` remain Bitwig-only — Live's
  Browser API is async/hierarchical enough that building it blind wasn't
  worth the risk; still returns a clear "Bitwig-only" error on Ableton.
- **Smoke tests added**, one per component (see CLAUDE.md's Testing
  section for the run commands):
  - `mcp-server/src/**/*.test.ts` (Node's built-in `node:test`, no new
    dependency): grid math, Euclidean rhythm generation, browser match
    selection, and the ultra-lean note format conversion round-trip
    including Bitwig quantization. 12 tests, excluded from the `tsc`
    build output.
  - `bitwig-extension/src/test/java/.../DeviceHandlerTest.java` (JUnit 5 +
    Mockito, added as `testImplementation` deps in `build.gradle` — first
    test infra this project has had). Mocks the Bitwig API interfaces
    (`Device`, `DeviceBank`, `CursorDevice`, `CursorRemoteControlsPage`,
    etc.) to cover `DeviceHandler`'s bounds-checking and error paths. 13
    tests. Verified by hand-compiling and running against JUnit console +
    Mockito jars pulled from Maven Central, since `gradle`/`gradlew` isn't
    on PATH in this environment — run `gradle test` from
    `bitwig-extension/` to run it the normal way.
  - `tests/test_ableton_device_handler.py` (stdlib `unittest`, no Live
    API needed - fakes `Song`/`Track`/`Device`/`DeviceParameter`). Covers
    the same bounds-checking as the Java suite plus the value
    normalization/denormalization math (including the quantized-parameter
    rounding path) that only exists on the Ableton side. 14 tests, all
    passing against the real `device.py`.

## Done (2026-08-19, live smoke test against Bitwig)

- **Fixed `batch_create_tracks` silently dropping `name` and always
  returning empty `createdIndices`** on Bitwig. Root cause: Bitwig's
  `Application.createInstrumentTrack()` is fire-and-forget (no synchronous
  index back), so `TrackHandler.createTrack` in Java never returned
  `index`, and `mcp-server/src/handlers/tracks.ts` only set the name /
  recorded the created index when `result.index` was defined - which was
  never, on Bitwig (Ableton's `create_midi_track`/`create_audio_track` is
  synchronous and did return an index, so this only affected Bitwig).
  Fixed in `tracks.ts`: snapshot `track.list` before creating, and if
  Bitwig doesn't hand back an index, requery after a 50ms settle delay and
  diff against the snapshot to find where the new track landed - same
  delay+requery pattern already used for scene auto-creation in
  `clips.ts`. Verified against the running Bitwig instance: before the fix,
  `batch_create_tracks({tracks:[{type:"instrument", name:"X"}]})` created
  a track named "Inst 5" with `createdIndices: []`; the code fix is built
  but needs the MCP connection restarted to verify live (dist output is
  updated, running process isn't).
- Live smoke-tested (not just mocked) against a running Bitwig instance:
  `batch_create_clips`, `batch_set_notes`/`batch_get_notes` round-trip,
  `get_clip_stats` (chord/scale/key analysis), `batch_create_euclid_pattern`
  (4+7+2 hit counts matched), `list_devices`, `search_browser` (query
  "poly" → 35 matched, correct top-10), `load_device` (exact match on
  "Polysynth"), `list_parameter_pages` (9 pages, matches CLAUDE.md's
  documented example), `select_parameter_page`, `get_device_parameters`/
  `set_device_parameter` (0.32 → "132 Hz", matches documented example),
  `delete_device`, `batch_delete_clips`. All passed as documented, no other
  bugs found.

## Done (2026-08-19, BrowserHandler test coverage)

- Added `bitwig-extension/src/test/java/.../BrowserHandlerTest.java` (JUnit
  5 + Mockito, same style as `DeviceHandlerTest`): covers `open`'s three
  modes (end/position/replace) and their validation, the stale-session
  cancel-before-browse behavior, the all-8-columns wildcard reset,
  `setContentType`/`setFilter` by index/name/value with their not-found
  error paths, `getResults`, `select`, `commit`, `cancel`'s tolerance of an
  already-closed browser, and `getState` open vs. closed. 31 tests.
  Verified by running `gradle test` for real (found a cached Gradle 8.14
  distribution under `~/.gradle/wrapper/dists` with the extension-api-18
  dependency already resolved, so no hand-compiling needed this time) - all
  44 tests (13 Device + 31 Browser) pass.

## Done (2026-08-19, batch_create_tracks fix verified live)

- Confirmed the `batch_create_tracks` fix works against a running Bitwig
  instance: `createdIndices: [9]` and the track was actually named
  "PROBE_FINAL" as requested (previously always empty indices + Bitwig's
  auto-generated "Inst N" name).
- **Why this took multiple restart attempts**: the daw MCP server this
  Claude Code setup actually runs is an installed copy at
  `C:\Users\d7\.local\daw-mcp\mcp-server\dist\mcp-server.js` (bundled via
  `npm run bundle` in `mcp-server/`), not this repo's own
  `mcp-server/dist/`. Editing the repo source alone does nothing until
  that installed bundle is rebuilt and copied over. Restarting Bitwig
  doesn't touch this Node process either - they're independent. And even
  reconnecting the MCP client doesn't necessarily kill+respawn the actual
  `node mcp-server.js` process if the host keeps it alive across
  reconnects; confirmed via `Get-CimInstance Win32_Process` that the
  running PID predated the file copy, and killing it directly (`Stop-Process`)
  was what actually forced a fresh spawn that loaded the fixed code.
  **If this code changes again**: rebuild with `cd mcp-server && npm run
  bundle`, copy `dist/mcp-server.js` to the installed path above, then
  verify the *process* restarted (not just the client reconnected) before
  retesting - check `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`
  for the process creation time vs. the file's mtime.

## Open

- Ableton device support is still unverified against a real Ableton
  instance - the fakes above check the handler's own logic, not that the
  real Live API objects behave the way the fakes assume. Flag any issues
  here if it misbehaves.
- No smoke test covers `batch_create_tracks`'s Bitwig index-resolution path
  (the before/after diff logic added in that fix) - would need either a
  live Bitwig instance or a Java-side mock of `track.list` responses at two
  points in time; worth adding if this code changes again.
- Five leftover scratch tracks ("Inst 5" through "Inst 8" and
  "PROBE_FINAL", indices 5-9) are sitting in the live project from this
  session's testing - delete them manually in Bitwig; `batch_delete_tracks`
  isn't enabled in this config so the MCP tools couldn't clean them up.
