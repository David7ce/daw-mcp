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

## Open

- Ableton device support is still unverified against a real Ableton
  instance - the fakes above check the handler's own logic, not that the
  real Live API objects behave the way the fakes assume. Flag any issues
  here if it misbehaves.
- No tests for `BrowserHandler`'s session state machine (open/setFilter/
  select/commit/cancel) on the Bitwig side - device tools got covered
  first since they were the immediate ask; the browser flow is more
  async/stateful and would take a similar Mockito-based approach if it's
  worth the effort later.
