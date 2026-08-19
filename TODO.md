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
- **Smoke tests added** (`mcp-server/src/**/*.test.ts`, run via
  `npm test` in `mcp-server/` — Node's built-in `node:test`, no new
  dependency): grid math (`indices.test.ts`), Euclidean rhythm generation
  (`euclidean.test.ts`), browser match selection
  (`browser-match.test.ts`), and the ultra-lean note format conversion
  round-trip including Bitwig quantization (`notes.test.ts`). 12 tests,
  all passing. Excluded from `tsc` build output via `tsconfig.json`.

## Open

- No Java-side tests for the Bitwig extension (`DeviceHandler`,
  `BrowserHandler` session state machine) or Python-side tests for the
  Ableton extension beyond `python -m py_compile` syntax checks. The new
  smoke tests only cover the TypeScript MCP server. Would need JUnit
  (Java) and a Live API mock (Python) respectively — bigger lift, left for
  when it's actually needed.
- Ableton device support above is unverified against real Ableton. Flag any
  issues here if it misbehaves.
