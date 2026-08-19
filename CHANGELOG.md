# Changelog

## 2026-08-19, clips.ts test coverage

- Added `mcp-server/src/handlers/clips.test.ts` (Node's built-in
  `node:test`, same queued-response fake pattern as `tracks.test.ts`,
  needed here because `batch_create_clips` can call
  `clip.findEmptySlots` twice per clip - once before auto-scene-creation,
  once after the retry). 14 tests covering the previously-untested core
  clip-creation logic: Mode A (auto-find empty slot from cursor, with
  auto-scene-creation when no room exists and a clear error when there's
  still no room after that), Mode B (explicit target, refusing to
  overwrite an occupied slot unless `overwrite: true`, deleting before
  recreating when it is), the cursor-slot advancing correctly across
  multiple Mode-A clips in one call, `batch_list_clips`'s three ways of
  resolving which tracks to query (explicit array > single trackIndex >
  cursor track), `batch_delete_clips`'s per-item error collection, and
  `set_clip_length` refusing to select an empty slot (writes against an
  empty cursor clip silently no-op in the DAW, per the existing comment in
  `clip-selection.ts`). 31 tests total in `mcp-server`, `npm test` and
  `npm run build` both clean.

## 2026-08-19, ClipHandler/clip.py test coverage + CI

Follow-up to a full-repo audit that flagged the two biggest, most central
handler files (MIDI note read/write - the actual core feature) as having
zero test coverage, unlike the smaller Device/Browser handlers.

- Added `bitwig-extension/src/test/java/.../ClipHandlerTest.java` (JUnit 5 +
  Mockito, same style as DeviceHandlerTest/BrowserHandlerTest): 23 tests
  covering beat<->step unit conversion (x/dx are beats on the wire but
  Bitwig's API takes step indices - this was a real bug once, per the
  "Note positions are always beats" section above), track-existence
  bounds-checking, and the iteration/filtering in getNotes/
  clearNotesAtPitch/findEmptySlots (scene-count bound, requested-count
  cutoff). Pure one-line delegation (setClipName, transposeClip, stopClip,
  setClipLength) wasn't covered - no logic there to break.
  Hit a genuine Mockito trap along the way: calling a stubbing helper
  method (e.g. `trackMissing()`) as a *direct argument* to another mock's
  `.thenReturn(...)` throws `UnfinishedStubbingException`, because the
  outer stub is still "open" while the helper's own `when()` call starts.
  `trackExisting()`-based tests always assigned to a local variable first
  and never hit this; the four `trackMissing()` call sites and two
  `noteOnStep()`/`emptyStep()` inline calls did, and were fixed the same
  way (assign to a local, then pass the local). All 67 tests (13 Device +
  31 Browser + 23 Clip) pass via `gradle test`.
- Added `tests/test_ableton_clip_handler.py` (stdlib `unittest`, same style
  as `test_ableton_device_handler.py`, run directly as a script - not
  discoverable as a package since `ableton-extension/` isn't an importable
  name): 25 tests against a faked Live API, including a faked
  `Live.Clip.MidiNoteSpecification` (monkey-patched onto the `clip` module
  after import) so the note-writing paths - which otherwise raise "Live
  API not available" when the real `Live` import fails - could actually be
  exercised. Covers tolerance-based note matching (clear/move/modify a
  note by x/y position), pitch clamping on move/transpose (notes pushed
  outside 0-127 are dropped), both wire note formats (ultra-lean array vs.
  object) in setNotes, velocity normalization in getNotes, a broken clip
  being skipped rather than crashing handle_list, and findEmptySlots
  respecting both the requested count and the actual scene-count bound.
  All pass against the real `clip.py`.
- Added `.github/workflows/test.yml`: one GitHub Actions job per component
  (mcp-server on Node 20, bitwig-extension on JDK 17 via
  `gradle/actions/setup-gradle@v6` pinned to Gradle 8.14 to match what's
  verified working locally, ableton-extension on Python 3.x), running on
  every push/PR to main. Nothing previously caught a regression
  automatically - all three suites were manual-only.

## 2026-08-19, tracks.ts test coverage

- Added `mcp-server/src/handlers/tracks.test.ts` (Node's built-in
  `node:test`, same style as `notes.test.ts`), closing the gap noted below.
  A queued-response fake (`responses[method]` may be an array, consumed in
  call order) was needed here specifically because `batch_create_tracks`
  calls `track.list` twice per track with different before/after
  snapshots - the existing single-value fake in `notes.test.ts` can't
  express that. Covers: the Bitwig fire-and-forget diff logic both when
  the new track lands at the end and when it lands in the middle
  (position-inserted, shifting later tracks), the Ableton synchronous-index
  path skipping the redundant re-query entirely, `batch_delete_tracks`
  sorting into descending internal-index order regardless of input order,
  and `batch_set_track_properties` only calling setters for properties
  actually provided. 5 new tests, 17 total, `npm test` and `npm run build`
  both clean.

## 2026-08-19, batch_delete_tracks verified live

- New session's tool catalog included `batch_delete_tracks` as expected.
  Called `batch_delete_tracks({trackIndices:[5,6,7,8,9]})` (after explicit
  user confirmation, since it's a destructive live-project action) to
  remove the five leftover scratch tracks ("Inst 5" through "Inst 8",
  "PROBE_FINAL"). `list_tracks` before/after confirmed all five were
  deleted and the project is back to its original 6 tracks (Acoustic Bass,
  Audio 2, Rusty Rhodes, Acoustic Drums Kit, FX 1, Master), with indices
  correctly renumbered. Tool is now live-verified, not just
  handler-tested.

## 2026-08-19, enabled full track CRUD

- `batch_delete_tracks` (D) and `batch_set_track_properties` (U) were
  already fully implemented (handler, tool definition, dispatch) - they
  were just in `DEFAULT_DISABLED_TOOLS` in `mcp-server/src/config.ts`
  behind the "producer prefers manual control" rationale. User asked for
  complete track CRUD, so enabled both in the local
  `%APPDATA%\daw-mcp\config.json` (`tools.batch_delete_tracks: true`,
  `tools.batch_set_track_properties: true`) rather than changing the
  project's shipped defaults, which stay conservative for other installs.
  Killed and let the daw MCP server process respawn to pick up the config
  change (tool availability is read at server startup).
- **Not yet live-verified**: this chat session's tool catalog was fetched
  once at session start, before the config change, so it doesn't include
  the two newly-enabled tools even though the server now advertises them.
  Needs a fresh conversation to pick up the updated tool list, then
  `batch_delete_tracks` can be tested for real by cleaning up the five
  leftover scratch tracks below.

## 2026-08-19, batch_create_tracks fix verified live

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

## 2026-08-19, BrowserHandler test coverage

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

## 2026-08-19, live smoke test against Bitwig

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

## 2026-08-19

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
