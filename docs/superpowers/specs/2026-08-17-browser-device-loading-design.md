# Browser / Device Loading — Design Spec

Date: 2026-08-17

## Goal

Let Claude load Bitwig devices and presets into a project from MCP, so a
sound-design request ("put a Polysynth on track 3, load the Warm Pad
preset") completes without the user manually dragging from Bitwig's
browser.

This completes the "C" of device CRUD. Read/update/delete already shipped
(see `2026-08-17-device-control-design.md`).

## Scope

In scope:

- Loading Bitwig stock devices by name.
- Loading presets by name onto the cursor device.
- Discovery — searching what is available without inserting anything.
- Preset stepping on an already-loaded device (next/previous).

Out of scope:

- Loading samples or audio files (`InsertionPoint.insertFile`).
- Direct plugin insertion by VST2/VST3/CLAP ID.
- Multi-device chain templates or preset *saving*.
- Ableton parity — Bitwig only, consistent with the device-control feature.

## Key API findings

Verified directly against `extension-api-18.jar` via `javap`, not assumed:

- `host.createPopupBrowser()` returns `PopupBrowser`, with filter columns
  (`smartCollectionColumn`, `locationColumn`, `deviceColumn`,
  `categoryColumn`, `tagColumn`, `deviceTypeColumn`, `fileTypeColumn`,
  `creatorColumn`), a `resultsColumn`, and `commit()` / `cancel()`.
- Browsing is *started* from an insertion point:
  `DeviceChain.browseToInsertAtEndOfChain()`,
  `browseToInsertAtStartOfChain()`, or `DeviceBank.browseToInsertDevice(int)`.
- `BrowserColumn.createItemBank(int)` / `entryCount()` expose column
  contents; `BrowserItem` has `name()` and a settable `isSelected()`.
- **No runtime UUID discovery.** `Device.createSpecificBitwigDevice(UUID)`
  consumes a UUID but nothing yields one. A direct-insert path would
  require a hardcoded UUID table, which cannot be produced reliably —
  so the browser is the only honest mechanism. This is a deliberate
  rejection of `InsertionPoint.insertBitwigDevice(UUID)`.
- `Device` exposes `switchToNextPreset()`, `switchToPreviousPreset()`,
  and `presetName()` — preset *stepping* needs no browser at all.

## Architecture

### The defining constraint

Bitwig's observer callbacks run on the same thread as the command handler,
so a Java handler **cannot** block waiting for browser results to
populate. This is already documented in this codebase — see
`ClipHandler.createScene`'s note and the 50ms TS-side delay in
`mcp-server/src/handlers/clips.ts`.

Therefore every browser step is a separate TCP round-trip, with the settle
delay applied on the TypeScript side.

### Layer split

**Java (`handlers/BrowserHandler.java`) — thin synchronous primitives.**
Each does one API call and returns immediately; no orchestration, no
waiting.

| Method | Behavior |
|---|---|
| `browser.open` | Cancel any stale session, then browse from the target insertion point |
| `browser.setFilter` | Select an item in a named filter column |
| `browser.getResults` | Read the results column's item bank |
| `browser.select` | Select a result by index |
| `browser.commit` | Commit the selection (inserts the device/preset) |
| `browser.cancel` | Cancel the session |
| `browser.getState` | `{isOpen, title, contentType, resultCount}` |

`PopupBrowser` and all column item banks are created in `init()` (Bitwig
API constraint — same as the existing cursor objects) and marked
interested there.

**TypeScript — orchestration plus settle delays.** The atomic tools are
sequences over those primitives. The session tools surface the same
primitives 1:1. No logic is duplicated between the layers: the session
layer *is* the primitives, the atomic layer is composition over them.

New `mcp-server/src/handlers/browser.ts`; `browser` dispatch category added
to `CommandDispatcher`.

## Tool surface

### Atomic layer (enabled by default)

| Tool | Behavior |
|---|---|
| `load_device({name, trackIndex?, position?})` | Open → filter by name → pick a match (rules below) → commit. Returns the name actually loaded, so fuzzy matches are visible rather than silent. `position` defaults to end of chain. |
| `load_preset({name, trackIndex?})` | Same flow against the cursor device's preset content type. |
| `search_browser({query?, contentType?, category?, creator?, limit?})` | Discovery. Opens, filters, reads results, then **cancels without committing**. `contentType` selects among `PopupBrowser.contentTypeNames()` (e.g. Devices, Presets, Samples) via `selectedContentTypeIndex`; `category` and `creator` map to `categoryColumn` and `creatorColumn`. `limit` defaults to 50. |

### Session layer (disabled by default)

`browser_open`, `browser_set_filter`, `browser_get_results`,
`browser_select`, `browser_commit`, `browser_cancel`, `browser_get_state`.

Added to `DEFAULT_DISABLED_TOOLS` in `mcp-server/src/config.ts`, matching
the project's existing convention for power-user tools. Opt in per tool
via the config file.

### Preset stepping (enabled by default)

`next_preset`, `previous_preset` — operate on the cursor device via the
`Device` API. No browser session involved.

### Match selection rules

`load_device` and `load_preset` pick from the results column using this
order, so behavior is deterministic rather than "best guess":

1. Case-insensitive exact match on the result name — use it.
2. Otherwise, exactly one result contains the query as a case-insensitive
   substring — use it.
3. Otherwise, multiple substring matches — use the shortest name (the
   least-decorated match, e.g. "Polysynth" over "Polysynth Bass Kit"),
   and include the full candidate list in the response.
4. Otherwise, no matches — cancel and return the no-match error described
   under Error handling.

The response always reports the name actually loaded plus, when rule 3
applied, the alternatives that were passed over.

### Invariants

These two are the ones that bite, and must hold on every path:

1. **`load_device` / `load_preset` never leave the popup open.** All
   failure paths cancel the session (try/finally).
2. **`search_browser` never commits.** Discovery is strictly read-only;
   nothing is inserted into the project.

## Index conventions

Consistent with the rest of the project:

- `trackIndex` — 1-based at the tool boundary, converted via
  `toInternal`/`toUser`.
- `position` (device chain slot) — 1-based, converted.
- Browser result `index` — 1-based at the tool boundary, converted.

## Error handling

- **No match found:** cancel the session, return a clear "no results for
  X" message including any near-miss result names, so the caller can
  retry with a better query rather than guessing.
- **Browser already open:** `browser.open` cancels the stale session
  first, then proceeds. A wedged popup never blocks the next call.
- **Results still empty:** results populate asynchronously; each TS step
  waits `config.mcp.selectionDelayMs`, and `browser_get_results` may be
  re-polled when `entryCount` is still 0.
- **Unknown filter column name:** `IllegalArgumentException` listing the
  valid column names, matching `DeviceHandler`'s validation style.
- **Invalid index:** bounds-checked with a 1-based error message, same as
  `DeviceHandler.getValidatedDevice`.

## Testing

This project has no automated test suite; verification is manual/E2E
against a running Bitwig instance, consistent with existing practice.

Test plan:

1. `load_device({name: "Polysynth"})` — device appears in the chain.
2. `load_device` with a partial name — loads a sensible match and the
   response names what was loaded.
3. `search_browser({query: "bass"})` — returns results, and **nothing is
   inserted** into the project.
4. `load_preset({name: "<a real preset>"})` — preset applies; verify via
   `get_device_parameters` that values changed.
5. Force a no-match (`load_device({name: "zzzznotathing"})`) — clear
   error, and `browser_get_state` reports the popup closed.
6. `next_preset` / `previous_preset` — preset name changes, no popup.
7. Enable the session tools in config and walk one manual sequence:
   open → set_filter → get_results → select → commit.

## Documentation

`CLAUDE.md`: add the new tools to the tool tables (atomic + preset in the
enabled table, session tools in the optional table) and a "Device
Loading" subsection explaining the browser session model, the async
settle-delay constraint, and the two invariants above.
