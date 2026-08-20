# Changelog

## 2026-08-20, fixed a real crash found via real-audio transcription, full audio2score-mcp pipeline verified live

- **Fixed a real bug**: `batch_set_notes` on Bitwig threw
  `"Internal error: Parameter insertDuration (=0.0) must be > 0.0"` for
  any note whose duration quantized to exactly 0 on the grid (e.g. a
  0.0833-beat duration at the default 0.25 stepSize). `quantizeForBitwig`
  rounds to the nearest step with no floor, and very short durations -
  which don't show up in hand-written test data but are common in
  real-audio transcription output - round straight to 0. Fixed by adding
  `quantizeDurationForBitwig` (floors to one grid step, `x`/position
  quantization is untouched since 0 is a valid position but never a valid
  duration) and switching both call sites (`notes.ts`, `euclid.ts`) to it.
  New test in `indices.test.ts`. Found live: transcribing a real recording
  ("O Tannenbaum", public domain, Wikimedia Commons) through
  `audio2score-mcp` and bridging the output into `batch_set_notes` hit
  this on the very first real (non-synthetic) transcription tested with
  short notes - every prior test in this repo used either hand-picked
  round durations or synthetic tones with long, uniform notes.
- **Verified the full pipeline against real, downloaded, non-synthetic
  content for the first time** (prior sessions used synthetic tones or
  hand-crafted MIDI):
  - A real recorded instrumental (`"O Tannenbaum".ogg`, CC0, Wikimedia
    Commons) through `transcribe_audio` → `midi_to_score` → `midi_to_notes`
    → `batch_set_notes` (340 notes after the fix, spanning 89 beats) →
    `get_clip_stats`. Real transcription noise was visible and expected
    (pitch range ballooned to 31-81, well beyond one melodic line, from
    basic-pitch detecting sub-harmonics on a real recording) - the chord
    analysis correctly reported no clean suggested key for the noisy
    input rather than forcing one, which is the right behavior facing
    genuinely messy data.
  - A real downloaded MIDI (`Alle Meine Entchen.mid`, public domain
    children's song, Wikimedia Commons) through `midi_to_score`/
    `midi_to_notes` directly (skipping transcription) → `batch_set_notes`
    (27 notes) → `get_clip_stats`, which correctly detected C major with
    all pitch classes exactly diatonic - a clean contrast case against
    the noisy transcribed audio above, confirming the bridge is exact
    when the input MIDI already is.
  - Both scratch tracks/clips deleted after via `batch_delete_tracks`,
    project confirmed back to its original state.

## 2026-08-20, gradlew wrapper and copyExtension fix

- Added `bitwig-extension/gradlew`/`gradlew.bat` (generated via
  `gradle wrapper --gradle-version 8.14` off the cached distribution) -
  building no longer requires manually locating a cached Gradle binary,
  which every prior session in this changelog had to do by hand.
  `.gitignore` already anticipated this (`.gradle/` excluded,
  `gradle/wrapper/gradle-wrapper.jar` explicitly un-ignored).
- Fixed `copyExtension`'s stale-jar-name trap: the task copied the built
  jar under its Gradle-generated name (`daw-mcp-<version>.bwextension`)
  instead of `BitwigMCP.bwextension`, the name Bitwig actually has
  enabled - every prior manual rebuild either needed a hand rename or
  Bitwig silently kept running the stale jar. Now uses a `rename` closure
  in the `Copy` task. Verified: `./gradlew.bat test copyExtension`
  builds, tests, and installs `BitwigMCP.bwextension` correctly as the
  only file in Bitwig's Extensions folder, in one command.

## 2026-08-19, settle-delay fix deployed and regression-tested live

- Rebuilt (`npm run bundle`), copied to the installed path
  (`C:\Users\d7\.local\daw-mcp\mcp-server\dist\mcp-server.js`), and killed
  the running node process to force a respawn - confirmed the harness
  auto-respawns it immediately (a new PID appeared within ~3s of the kill,
  no manual restart needed beyond killing the old one).
- **Regression-tested the exact original failure scenario** in the live
  `Instrumental-Rock.bwproject`: created an effect track ("FX Test"), then
  a new instrument track with `position: -1` - the same sequence that
  previously mis-fired. This time the new track landed correctly at its
  own index with a fresh auto-generated color, and the effect track stayed
  untouched at its own index, unrenamed. Fix confirmed working live, not
  just via the mocked unit tests. Cleaned up both test tracks afterward.
- Also audited for the same bug class elsewhere: grepped every
  `setTimeout` in `mcp-server/src` (13 call sites) - all now use
  `config.mcp.selectionDelayMs` consistently, the one exception
  (`daw-client.ts`'s per-request timeout) being a legitimately different,
  already-configurable value. Grepped `bitwig-extension`/`ableton-extension`
  for `Thread.sleep`/`sleep(` - zero hits; all settle-timing logic lives
  in the TS layer by design, so there was nothing to check there.

## 2026-08-19, two full songs composed live via the MCP tools - free-form composition confirmed viable

Built two complete instrumental arrangements this session entirely through
the `daw` MCP tools against a running Bitwig instance, in two different
projects and genres, as a live demonstration that an LLM can compose real,
harmonically-coherent, structured music through this integration without
a human placing individual notes.

**Song 1 (existing project)**: Pop-rock, C major, I-V-vi-IV (C-G-Am-F).
Intro, Verse, Pre-Chorus, Chorus, Bridge (contrasting Am-F-C-G, stripped
back then rebuilt), Outro - bass, keys, drums, plus a new "Lead Melody"
track with a Polysynth shaped into a lead patch (opened the filter,
added resonance and keytrack) and a genuine sequenced melodic hook.

**Song 2 ("Instrumental-Rock.bwproject", new/empty project)**: A
power-trio arrangement (Drums, Bass, Guitar) in E minor, built specifically
for the user to play live electric guitar on top:
- `Drums` = "Acoustic Drums Kit 1 Processed", `Bass` = "Electric Bass -
  Fingered", `Guitar - Guide (MUTE ME)` = "Metal Guitar" - all loaded via
  `load_device` by exact base-device name, never a preset (see the
  "Preset loading is not currently achievable" section above for why).
- Riff (Em-Em-C-D, syncopated unison rhythm across bass/guitar/drums),
  Groove (Em-C-G-D, sustained power chords, fuller drums), Breakdown
  (drums+bass only, half-time, **no guitar clip at all** - deliberately
  left empty so the user has real solo space rather than a muted guide
  fighting their live playing), Outro (unison hit, snare build, final stop).
- The guitar track is muted by default per the request ("add the guitar I
  will mute") - it's a compositional guide (what a guitar part could play),
  not intended to sound in the final mix.

Verified via `get_clip_stats`' chord detection on both songs, not just
asserted - e.g. the rock riff read back as `E5 -> E5 -> C5 -> D5`
("fifth"-type chords, correctly identified as power chords since a dyad
has no third to determine major/minor) with "E minor" surfacing in
suggested scales, exactly as intended.

**What this setup genuinely cannot do (documented, not glossed over)**:
- No audio recording. The user's live guitar performance is a manual step
  in Bitwig - `daw` MCP has no arrangement view or audio-track access (see
  CLAUDE.md's Scope section). It builds the MIDI backing around where a
  live instrument goes, not the recording itself.
- No realistic electric guitar tone. "Metal Guitar" and similar factory
  instruments are synthesized/sampled stand-ins, not amp-modeled or
  performance-realistic - fine for a compositional guide track, not a
  substitute for the real thing.
- Preset browsing (as opposed to base device names) is unreliable, per the
  documented `PopupBrowser.selectedContentTypeIndex()` limitation - every
  device in both songs was matched by exact base-device name for this
  reason, then shaped via `set_device_parameter`, never loaded as a
  preset.
- Drum kit pitch mapping (36/38/42/46 = kick/snare/closed hat/open hat)
  was assumed from GM convention and a sibling kit verified earlier in
  this session (same "Acoustic Drums Kit N ... Processed" factory family),
  not independently re-verified note-by-note for this specific kit
  instance - worth a listen-through if something sounds off.

## 2026-08-19, batch_create_tracks/batch_create_clips settle-delay fix, ableton-extension README testing section

- **Fixed a real, live-reproduced bug**: `batch_create_tracks`'s
  before/after track-list diff (added to resolve Bitwig's fire-and-forget
  track creation - see the earlier "live smoke test against Bitwig" entry)
  used a hardcoded 50ms settle delay before re-querying, while every other
  Bitwig selection/settle wait in this codebase uses the configurable
  `mcp.selectionDelayMs` (default 400ms). Hit this live while building a
  demo song: creating an instrument track landed it *before* the existing
  "FX 1" effect track (Bitwig groups instrument/audio tracks ahead of
  effect tracks regardless of `position: -1`), and the too-short delay let
  the diff misread the boundary - it renamed the pre-existing "FX 1" track
  to the new track's name instead of the actual new track, which sat
  unnamed one slot over. Recovered by hand via `batch_set_track_properties`.
  Fixed both `tracks.ts` and the structurally identical scene-creation
  retry in `clips.ts`'s `findEmptySlotsWithAutoCreate` to use
  `config.mcp.selectionDelayMs` instead of the hardcoded `50`. All 78
  mcp-server tests still pass (the fakes already used `selectionDelayMs: 0`,
  so this was transparent to them). **Not yet deployed to the installed
  bundle** - see TODO.md for why and what's needed.
- `ableton-extension/README.md`: added a Testing section listing the four
  `tests/test_ableton_*.py` files and how to run them - the file had no
  mention of test coverage at all despite this session adding 59 tests for
  it.

## 2026-08-19, ponytail-audit cleanup

Repo-wide over-engineering audit (ponytail-audit skill) found and fixed 4
issues - all applied, no findings left pending:

- Deleted `mcp-server/src/handlers/index.ts` (33-line barrel, zero
  importers - `server.ts` already imports every handler directly from its
  own module).
- Deleted `mcp-server/src/tools/index.ts` (5-line barrel with exactly one
  caller wrapping exactly one file); `server.ts` now imports
  `createToolDefinitions` directly from `./tools/definitions.js`.
- Deduplicated `successResponse()` (`{"success": true}`) across the 6
  Bitwig Java handler classes into one shared `JsonResponses.java`
  utility, imported via `import static`. Along the way found
  `ProjectHandler.java`'s copy was already 100% dead - `getProjectInfo()`
  builds its own `JsonObject` directly and never called it - so that one
  was removed outright with no import added back.
- Stripped `ableton-extension/handlers/__init__.py`'s five re-imports -
  `dispatcher.py` imports every handler directly from its submodule, never
  through this barrel. The re-import list was also stale (missing
  `DeviceHandler`, added after this file was last touched), which was
  itself the tell that nothing depended on it.

Verified after each change: `npm run build` + `npm test` (78 tests),
`gradle test` (108 tests), all four `tests/test_ableton_*.py` files (59
tests) - all still green.

## 2026-08-19, fixed the unreachable ping bug

- Fixed `CommandDispatcher.java`'s `dispatch()`: bare `ping` (no dot) is now
  special-cased *before* the `category.action` split, the same way
  Ableton's `dispatcher.py` already handles it. Previously the format
  check ahead of the switch statement rejected any dot-less method first,
  so the switch's `case "ping"` was dead code - `ping` always threw
  "Invalid method format" instead of returning a result.
- Also fixed the response shape while in there: `handlePing()` returned
  `{"status": "ok", "timestamp": ...}`, but PROTOCOL.md documents
  `{"pong": true}` and that's exactly what Ableton's dispatcher already
  returns. Changed Bitwig's to match - nothing in `mcp-server` referenced
  the old `status`/`timestamp` fields (grepped first to confirm), so this
  doesn't break any caller.
- Updated `CommandDispatcherTest`'s ping test from documenting the bug to
  asserting the fixed behavior (`ping_returnsPongTrue_matchingProtocolMdAndAbletonsDispatcher`).
  All 108 Java tests still pass.

## 2026-08-19, remaining bitwig-extension test coverage - completes the full-repo test audit

- Added `ProjectHandlerTest.java` (4 tests): the tempo-normalization
  formula (Bitwig stores tempo as 0-1 representing 20-666 BPM) at both
  endpoints and the midpoint, plus the field passthrough.
- Added `TransportHandlerTest.java` (7 tests): `togglePlay`'s play/stop
  branch based on current state, `toggleRecord`, `setPosition`'s
  required-param check, and `getStatus`.
- Added `CommandDispatcherTest.java` (9 tests): method-format validation
  and category routing. Routing is verified indirectly - each handler's
  own "Unknown X action" message names the handler, so reaching that
  specific message (not the dispatcher's own "Unknown category") proves
  the category reached the right handler, without needing a full Bitwig
  API mock for a real success path.
  **Found a real bug while writing this**: `ping` (documented in
  PROTOCOL.md as a bare, dot-less method) is unreachable. `dispatch()`
  splits the method on "." and throws "Invalid method format" if that
  yields fewer than 2 parts - but a dot-less `"ping"` only ever yields 1
  part, so that check throws before the switch statement's `case "ping"`
  is ever reached. The case is dead code. This has gone unnoticed because
  `mcp-server/src/daw-client.ts` uses `project.getInfo` for its
  connectivity check instead of calling `ping` - so the dead path has
  zero current impact, but it's real and PROTOCOL.md's documented
  behavior for it is wrong. Left unfixed pending a decision on whether to
  fix `CommandDispatcher.java` or `PROTOCOL.md` (both are one-line
  changes) - flagged in the session rather than silently patched, since
  it's a behavior question beyond "add tests".
- `ConfigReader.java` was deliberately left untested for the same reason
  as `config.ts`'s `loadConfig()`: it reads the user's real
  `%APPDATA%\daw-mcp\config.json` (or platform equivalent) with no
  injection point (`getConfigFile()` is private, and the constructor
  calls `load()` unconditionally), so a test can't safely redirect it
  without either touching that real path or reflection-hacking process
  environment variables.
- 108 Java tests total (13 Device + 31 Browser + 23 Clip + 21 Track + 4
  Project + 7 Transport + 9 CommandDispatcher), all pass via
  `gradle test`.

This completes the full-repo test-coverage audit across all three
components (mcp-server, bitwig-extension, ableton-extension). Everything
with real branching/transformation logic now has tests; what's left
untested is exclusively TCP/socket/protocol-wiring plumbing
(`daw-client.ts`, `server.ts`, `index.ts`, `BitwigMCPExtension.java`,
`MCPServer.java`, `manager.py`, `tcp_server.py`, `dispatcher.py`,
`base.py`) or code that reads the user's real config path with no safe
injection point (`config.ts`'s `loadConfig`, `ConfigReader.java`).

## 2026-08-19, remaining ableton-extension test coverage

- Added `tests/test_ableton_track_handler.py` (17 tests): track CRUD
  (create resolves position=-1 to the current track count, audio vs.
  instrument/effect dispatch to different Live API calls), a broken track
  being skipped rather than crashing `handle_list` (same pattern as
  `clip.py`'s list handler), `arm` defaulting to `False` when the Live
  object lacks the attribute, and a missing `mixer_device` omitting
  volume/pan instead of raising. Caught and fixed a mutable-default-
  argument bug in my own fake (`FakeTrack(mixer_device=FakeMixerDevice())`
  evaluates once and shares that instance across every call that omits
  the argument) before it could cause cross-test state leakage - replaced
  with a sentinel so each track gets its own fresh mixer device.
- Added `tests/test_ableton_project_transport_handler.py` (3 tests):
  `project.py`'s field mapping (cheap insurance against a typo'd Live API
  attribute name) and `transport.py`'s one real branch (missing `beats`
  raises, and the value is coerced to float).
- 59 Python tests total (25 clip + 14 device + 17 track + 3 project/
  transport), all pass. This completes ableton-extension - the remaining
  files (`manager.py`, `tcp_server.py`, `dispatcher.py`, `base.py`,
  `__init__.py`) are non-blocking-socket/scheduler plumbing, the same
  category left untested on the other two components.

## 2026-08-19, remaining mcp-server test coverage

Completed test coverage for every remaining `mcp-server` file with real
logic, closing out the TypeScript side of the audit. 34 new tests, 78
total in `mcp-server`, `npm test` and `npm run build` both clean.

- `music-analysis.test.ts` / `handlers/analysis.test.ts`: `analyzeMusic`
  and `computeClipStats` are pure exported functions, so these are plain
  input/output tests with no mocking - same style as `euclidean.test.ts`.
  Expected values (chord names, suggested scales, grid-detection
  confidence numbers) were grounded by actually running the functions via
  `node --import tsx` first rather than hand-calculated, since Tonal.js's
  chord/scale output and the grid-confidence formula aren't obvious from
  reading the code alone.
- `handlers/device.test.ts`: covers the index-conversion asymmetry
  documented in CLAUDE.md - `select_device`/`delete_device`/parameter-page
  indices convert 1-based<->0-based, but `set_device_parameter`'s index is
  a fixed 0-7 remote-control slot and is deliberately passed through
  unconverted.
- `handlers/browser-load.test.ts`: the two hard invariants from CLAUDE.md
  - `load_device` never leaves the popup open (cancels on every failure
  path, commits only after verifying the selection actually applied) and
  `search_browser` never commits (always cancels, even on success) - plus
  the truncated-vs-limited distinction in search results and the
  session-lost error translation.
- `handlers/browser.test.ts`: the session-layer primitives' own logic
  (result-limit slicing, index conversion, the empty-string wildcard for
  clearing a filter).
- `handlers/project.test.ts`: `get_daws`'s per-DAW grid info (Bitwig gets
  quantization info, Ableton always null) and its three summary-hint
  variants (zero/one/multiple connected).
- `helpers/daw-resolution.test.ts` / `device-selection.test.ts`: the
  DAW auto-selection priority order (explicit > single connected > config
  default) and the track-select-before-device-op flow.
- `config.test.ts`: `isToolEnabled`'s three-tier precedence and
  `getStepSize`'s formula. Deliberately does NOT exercise `loadConfig()`/
  `getConfigPath()`, since those read the user's real
  `%APPDATA%\daw-mcp\config.json` (or platform equivalent) - a test
  touching that path could corrupt a real user's config.

Left untested, and staying that way: `daw-client.ts`, `server.ts`,
`index.ts` - these are TCP/MCP-protocol plumbing wired up in `init()`-style
fashion, the same category of file the project already treats as
integration-only (see `bitwig-extension/BitwigMCPExtension.java` and
`ableton-extension/tcp_server.py`, neither of which have unit tests
either). Testing them meaningfully would mean standing up a real socket or
MCP client, which is exactly what this project's "Smoke tests only - none
of these talk to a real DAW" policy is scoped to avoid.

## 2026-08-19, TrackHandler.java test coverage

- Added `bitwig-extension/src/test/java/.../TrackHandlerTest.java` (JUnit 5
  + Mockito, same style as the other three handler test files): 21 tests
  covering existence validation before every mutating call
  (`getValidatedTrack`), the create-type dispatch table (instrument/audio/
  effect/fx, case-insensitive, unknown type throws without touching
  `Application`), volume/pan clamping to 0-1, and the `setImmediately`-not-
  `set` regression guard - `set(double)` is silently discarded by Bitwig's
  controller take-over strategy, the same class of bug documented for
  `DeviceHandler.setParameter` in CLAUDE.md.
  Hit one real compile error along the way: `Track.name()` returns
  `SettableStringValue`, not the plain `StringValue` I'd assumed by analogy
  with the read-only fields - the compiler caught it immediately since
  Mockito's `thenReturn` is type-checked against the mocked method's actual
  return type.
  88 tests total now (13 Device + 31 Browser + 23 Clip + 21 Track), all
  pass via `gradle test`.

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
