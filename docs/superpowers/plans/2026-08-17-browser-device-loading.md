# Browser / Device Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude load Bitwig devices and presets into a project from MCP,
completing the "C" of device CRUD.

**Architecture:** Bitwig's observer callbacks run on the command handler's
thread, so a Java handler cannot block waiting for browser results to
populate. Java therefore exposes thin synchronous primitives
(`browser.open`, `browser.setFilter`, `browser.getResults`, …) and all
orchestration plus settle delays live in TypeScript. Atomic tools
(`load_device`, `load_preset`, `search_browser`) are TS sequences over
those primitives; session tools surface the same primitives 1:1.

**Tech Stack:** Java 11 (Bitwig Extension API v18, Gson), TypeScript
(`@modelcontextprotocol/sdk`).

**Spec:** `docs/superpowers/specs/2026-08-17-browser-device-loading-design.md`

## Global Constraints

- **Bitwig only.** No Ableton parity — consistent with the device-control
  feature. Tools still spread `...dawParam` for schema consistency.
- **All `PopupBrowser` and browser bank objects must be created in
  `init()`** — Bitwig API constraint, same as the existing cursor objects.
- **Java handlers never block waiting for observers.** Every primitive does
  one API call and returns immediately. Settle delays are TypeScript-side
  only, using `config.mcp.selectionDelayMs`.
- **Two invariants that must hold on every path:**
  1. `load_device` / `load_preset` never leave the popup open — all failure
     paths cancel (try/finally).
  2. `search_browser` never commits — discovery is strictly read-only.
- **Index conventions:** `trackIndex`, `position`, and browser result
  `index` are 1-based at the tool boundary and converted via
  `toInternal`/`toUser` (`mcp-server/src/helpers/indices.ts`). Device
  *parameter* index (0-7) remains unconverted — unchanged from the
  existing device tools.
- **Session-layer tools are disabled by default** via
  `DEFAULT_DISABLED_TOOLS` in `mcp-server/src/config.ts`. Atomic tools and
  preset stepping are enabled by default.
- **No automated test suite exists** in this project (no `*.test.ts`, no
  Java test source set). Verification is a clean build plus manual E2E
  against a running Bitwig instance, matching existing practice. Build
  steps below replace "write a failing test" accordingly.
- **`gradle` is not on PATH in this environment.** Build the Java extension
  from `bitwig-extension/` with:
  `"/c/Users/d7/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat" build --offline`
- **All Bitwig API signatures used below were verified against
  `extension-api-18.jar` via `javap`**, not recalled from memory.

---

### Task 1: Add PopupBrowser objects to the extension

**Files:**
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java`
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/config/ConfigReader.java`

**Interfaces:**
- Consumes: existing `cursorTrack`, `cursorDevice`, `deviceBank` fields and
  the `config` field, all already present.
- Produces (getters later tasks rely on):
  - `public PopupBrowser getPopupBrowser()`
  - `public BrowserResultsItemBank getBrowserResults()`
  - `public int getBrowserResultsSize()`

- [ ] **Step 1: Add the config field, loader line, and getter**

`ConfigReader.java` stores each setting as a plain field with a hardcoded
default, optionally overridden from the `bitwig` JSON section in `load()`.
Follow that exact pattern.

Add the field, next to `private int devices = 8;`:

```java
    private int browserResults = 32;
```

In `load()`, inside the `if (root.has("bitwig")) { ... }` block, next to the
`devices` line:

```java
                if (bitwig.has("browserResults")) browserResults = bitwig.get("browserResults").getAsInt();
```

Add the getter, next to `public int getDevices() { return devices; }`:

```java
    public int getBrowserResults() { return browserResults; }
```

- [ ] **Step 2: Add the fields to `BitwigMCPExtension.java`**

Next to the existing device fields (`cursorDevice`, `deviceBank`,
`remoteControls`):

```java
    private PopupBrowser popupBrowser;
    private BrowserResultsItemBank browserResults;
```

- [ ] **Step 3: Create the browser objects in `init()`**

Immediately after the remote-controls block added by the device-control
feature (the `for (int p = 0; p < 8; p++) { ... }` loop), insert:

```java
        // Popup browser for loading devices and presets.
        // Results populate asynchronously - the MCP server adds settle delays
        // between steps, because observers cannot fire while a handler blocks.
        popupBrowser = host.createPopupBrowser();
        popupBrowser.exists().markInterested();
        popupBrowser.title().markInterested();
        popupBrowser.selectedContentTypeName().markInterested();
        popupBrowser.selectedContentTypeIndex().markInterested();
        popupBrowser.contentTypeNames().markInterested();

        browserResults = popupBrowser.resultsColumn().createItemBank(config.getBrowserResults());
        popupBrowser.resultsColumn().entryCount().markInterested();
        for (int r = 0; r < browserResults.getSize(); r++) {
            BrowserResultsItem item = browserResults.getItemAt(r);
            item.exists().markInterested();
            item.name().markInterested();
            item.isSelected().markInterested();
        }
```

`import com.bitwig.extension.controller.api.*;` is already at the top of the
file and covers `PopupBrowser`, `BrowserResultsItemBank`, and
`BrowserResultsItem`.

- [ ] **Step 4: Add the getters**

After the existing `getRemoteControls()` getter:

```java
    public PopupBrowser getPopupBrowser() {
        return popupBrowser;
    }

    public BrowserResultsItemBank getBrowserResults() {
        return browserResults;
    }

    public int getBrowserResultsSize() {
        return config.getBrowserResults();
    }
```

- [ ] **Step 5: Build to verify it compiles**

From `bitwig-extension/`:

```bash
"/c/Users/d7/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat" build --offline
```

Expected: `BUILD SUCCESSFUL`. A clean compile against the real API jar is
the verification for this task — there is no unit test harness.

- [ ] **Step 6: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/config/ConfigReader.java
git commit -m "Add PopupBrowser and results bank to Bitwig extension"
```

---

### Task 2: Create `BrowserHandler.java` and wire the dispatch category

**Files:**
- Create: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/BrowserHandler.java`
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/CommandDispatcher.java`

**Interfaces:**
- Consumes: `extension.getPopupBrowser()`, `extension.getBrowserResults()`,
  `extension.getCursorTrack()`, `extension.getCursorDevice()`,
  `extension.getDeviceBank()` from Task 1 and the device-control feature.
- Produces: `public JsonElement handle(String action, JsonObject params)`,
  reachable as `browser.<action>` through `CommandDispatcher`. Wire
  contract each action returns is documented in the code below; the
  TypeScript layer in Tasks 5-6 depends on these exact shapes.

- [ ] **Step 1: Write the handler**

Note the `mode` parameter on `open`: `"end"` (default) inserts at the end
of the cursor track's chain, `"position"` inserts at a device-chain slot,
and `"replace"` opens against the cursor device — which is how preset
browsing is reached (`Device.browseToReplaceDevice()`).

```java
package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.*;

import com.pxaudio.bitwigmcp.BitwigMCPExtension;

/**
 * Handles browser operations: open a popup browser session, filter it,
 * read results, commit or cancel.
 *
 * Each action performs one Bitwig API call and returns immediately.
 * Browser results populate asynchronously and observers cannot fire while
 * this thread is blocked, so the MCP server inserts settle delays between
 * calls rather than this handler waiting.
 */
public class BrowserHandler {
    private final BitwigMCPExtension extension;
    private final ControllerHost host;

    public BrowserHandler(BitwigMCPExtension extension, ControllerHost host) {
        this.extension = extension;
        this.host = host;
    }

    private static JsonObject successResponse() {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        return result;
    }

    public JsonElement handle(String action, JsonObject params) {
        switch (action) {
            case "open":
                return openBrowser(params);
            case "setContentType":
                return setContentType(params);
            case "setFilter":
                return setFilter(params);
            case "getResults":
                return getResults();
            case "select":
                return selectResult(params);
            case "commit":
                return commitBrowser();
            case "cancel":
                return cancelBrowser();
            case "getState":
                return getState();
            default:
                throw new IllegalArgumentException("Unknown browser action: " + action);
        }
    }

    /**
     * Open a browser session. Cancels any stale session first so a wedged
     * popup never blocks the next call.
     *
     * mode: "end" (default) - insert at end of cursor track's device chain
     *       "position"       - insert at device chain slot (0-based "position" param)
     *       "replace"        - open against cursor device (used for preset browsing)
     */
    private JsonElement openBrowser(JsonObject params) {
        PopupBrowser browser = extension.getPopupBrowser();

        if (browser.exists().get()) {
            browser.cancel();
        }

        String mode = params.has("mode") ? params.get("mode").getAsString() : "end";

        switch (mode) {
            case "end":
                extension.getCursorTrack().browseToInsertAtEndOfChain();
                break;
            case "position": {
                if (!params.has("position")) {
                    throw new IllegalArgumentException("Missing 'position' parameter for mode 'position'");
                }
                int position = params.get("position").getAsInt();
                DeviceBank deviceBank = extension.getDeviceBank();
                if (position < 0 || position >= deviceBank.getSizeOfBank()) {
                    throw new IllegalArgumentException("Device position out of range: " + (position + 1));
                }
                deviceBank.browseToInsertDevice(position);
                break;
            }
            case "replace":
                if (!extension.getCursorDevice().exists().get()) {
                    throw new IllegalArgumentException("No device selected. Select a device in Bitwig.");
                }
                extension.getCursorDevice().browseToReplaceDevice();
                break;
            default:
                throw new IllegalArgumentException("Unknown browser mode: " + mode + " (expected end, position, or replace)");
        }

        return successResponse();
    }

    /**
     * Switch the browser's content type (e.g. Devices, Presets) by index
     * into contentTypeNames().
     */
    private JsonElement setContentType(JsonObject params) {
        requireOpenBrowser();

        PopupBrowser browser = extension.getPopupBrowser();
        String[] names = browser.contentTypeNames().get();

        if (params.has("index")) {
            int index = params.get("index").getAsInt();
            if (index < 0 || index >= names.length) {
                throw new IllegalArgumentException("Content type index out of range: " + index);
            }
            browser.selectedContentTypeIndex().set(index);
            return successResponse();
        }

        if (params.has("name")) {
            String wanted = params.get("name").getAsString();
            for (int i = 0; i < names.length; i++) {
                if (names[i].equalsIgnoreCase(wanted)) {
                    browser.selectedContentTypeIndex().set(i);
                    return successResponse();
                }
            }
            throw new IllegalArgumentException("Unknown content type: " + wanted);
        }

        throw new IllegalArgumentException("Missing 'index' or 'name' parameter");
    }

    /**
     * Select an item in a named filter column by its display name.
     * Passing no "value" (or an empty one) selects the column's wildcard
     * item, clearing that filter.
     */
    private JsonElement setFilter(JsonObject params) {
        requireOpenBrowser();

        if (!params.has("column")) {
            throw new IllegalArgumentException("Missing 'column' parameter");
        }
        String columnName = params.get("column").getAsString();
        BrowserFilterColumn column = getColumn(columnName);

        String value = params.has("value") ? params.get("value").getAsString() : "";
        if (value.isEmpty()) {
            column.getWildcardItem().isSelected().set(true);
            return successResponse();
        }

        BrowserFilterItemBank bank = column.createItemBank(extension.getBrowserResultsSize());
        for (int i = 0; i < bank.getSize(); i++) {
            BrowserItem item = bank.getItemAt(i);
            if (item.exists().get() && item.name().get().equalsIgnoreCase(value)) {
                item.isSelected().set(true);
                return successResponse();
            }
        }

        throw new IllegalArgumentException("No '" + value + "' entry in browser column: " + columnName);
    }

    private BrowserFilterColumn getColumn(String name) {
        PopupBrowser browser = extension.getPopupBrowser();
        switch (name) {
            case "category":        return browser.categoryColumn();
            case "creator":         return browser.creatorColumn();
            case "tag":             return browser.tagColumn();
            case "device":          return browser.deviceColumn();
            case "deviceType":      return browser.deviceTypeColumn();
            case "fileType":        return browser.fileTypeColumn();
            case "location":        return browser.locationColumn();
            case "smartCollection": return browser.smartCollectionColumn();
            default:
                throw new IllegalArgumentException("Unknown browser column: " + name
                    + " (expected category, creator, tag, device, deviceType, fileType, location, or smartCollection)");
        }
    }

    /**
     * Read the results column. Returns 0-based indices; the MCP server
     * converts them to 1-based for the user.
     */
    private JsonElement getResults() {
        requireOpenBrowser();

        BrowserResultsItemBank bank = extension.getBrowserResults();
        JsonArray results = new JsonArray();

        for (int i = 0; i < bank.getSize(); i++) {
            BrowserItem item = bank.getItemAt(i);
            if (item.exists().get()) {
                JsonObject obj = new JsonObject();
                obj.addProperty("index", i);
                obj.addProperty("name", item.name().get());
                results.add(obj);
            }
        }

        JsonObject result = new JsonObject();
        result.add("results", results);
        result.addProperty("count", results.size());
        result.addProperty("totalCount", extension.getPopupBrowser().resultsColumn().entryCount().get());
        return result;
    }

    private JsonElement selectResult(JsonObject params) {
        requireOpenBrowser();

        if (!params.has("index")) {
            throw new IllegalArgumentException("Missing 'index' parameter");
        }
        int index = params.get("index").getAsInt();

        BrowserResultsItemBank bank = extension.getBrowserResults();
        if (index < 0 || index >= bank.getSize()) {
            throw new IllegalArgumentException("Result does not exist at index: " + (index + 1));
        }

        BrowserItem item = bank.getItemAt(index);
        if (!item.exists().get()) {
            throw new IllegalArgumentException("Result does not exist at index: " + (index + 1));
        }

        item.isSelected().set(true);
        return successResponse();
    }

    private JsonElement commitBrowser() {
        requireOpenBrowser();
        extension.getPopupBrowser().commit();
        return successResponse();
    }

    /**
     * Cancel is deliberately tolerant of an already-closed browser: it is
     * the escape hatch the MCP server calls from failure paths.
     */
    private JsonElement cancelBrowser() {
        PopupBrowser browser = extension.getPopupBrowser();
        if (browser.exists().get()) {
            browser.cancel();
        }
        return successResponse();
    }

    private JsonElement getState() {
        PopupBrowser browser = extension.getPopupBrowser();
        boolean isOpen = browser.exists().get();

        JsonObject result = new JsonObject();
        result.addProperty("isOpen", isOpen);
        result.addProperty("title", isOpen ? browser.title().get() : "");
        result.addProperty("contentType", isOpen ? browser.selectedContentTypeName().get() : "");
        result.addProperty("resultCount", isOpen ? browser.resultsColumn().entryCount().get() : 0);

        if (isOpen) {
            JsonArray types = new JsonArray();
            for (String name : browser.contentTypeNames().get()) {
                types.add(name);
            }
            result.add("contentTypes", types);
        }

        return result;
    }

    private void requireOpenBrowser() {
        if (!extension.getPopupBrowser().exists().get()) {
            throw new IllegalArgumentException("No browser session open. Call browser.open first.");
        }
    }
}
```

- [ ] **Step 2: Wire the dispatch category**

In `CommandDispatcher.java`, add the field next to `deviceHandler`:

```java
    private final BrowserHandler browserHandler;
```

In the constructor, next to the `deviceHandler` line:

```java
        this.browserHandler = new BrowserHandler(extension, host);
```

In `dispatch()`, add the case after `case "device":`:

```java
            case "browser":
                return browserHandler.handle(action, params);
```

- [ ] **Step 3: Build to verify it compiles**

From `bitwig-extension/`:

```bash
"/c/Users/d7/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat" build --offline
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/BrowserHandler.java bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/CommandDispatcher.java
git commit -m "Add BrowserHandler primitives and browser dispatch category"
```

---

### Task 3: Add preset stepping to `DeviceHandler.java`

**Files:**
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/DeviceHandler.java`
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java`

**Interfaces:**
- Consumes: `extension.getCursorDevice()` and the existing
  `requireCursorDevice()` helper already in `DeviceHandler`.
- Produces: `device.nextPreset` and `device.previousPreset` actions,
  returning `{"success": true, "presetName": "<name>"}`. Task 7's
  TypeScript handlers depend on that shape.

This needs no browser session — `switchToNextPreset()` /
`switchToPreviousPreset()` are on `Device` directly.

- [ ] **Step 1: Mark `presetName` interested in `init()`**

In `BitwigMCPExtension.java`, in the cursor-device block, next to
`cursorDevice.name().markInterested();`:

```java
        cursorDevice.presetName().markInterested();
```

- [ ] **Step 2: Add the switch cases in `DeviceHandler.handle()`**

After `case "delete":`:

```java
            case "nextPreset":
                return stepPreset(true);
            case "previousPreset":
                return stepPreset(false);
```

- [ ] **Step 3: Add the method**

After the existing `deleteDevice` method:

```java
    /**
     * Step to the next or previous preset on the cursor device.
     * No browser session is involved - this is the Device API directly.
     *
     * The returned presetName may lag by one call: Bitwig's observer
     * cannot fire while this handler is blocking, so it reflects the
     * preset as of entry. The MCP server re-reads state after a delay.
     */
    private JsonElement stepPreset(boolean forward) {
        requireCursorDevice();

        Device cursorDevice = extension.getCursorDevice();
        if (forward) {
            cursorDevice.switchToNextPreset();
        } else {
            cursorDevice.switchToPreviousPreset();
        }

        JsonObject result = successResponse();
        result.addProperty("presetName", cursorDevice.presetName().get());
        return result;
    }
```

- [ ] **Step 4: Build to verify it compiles**

From `bitwig-extension/`:

```bash
"/c/Users/d7/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat" build --offline
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/DeviceHandler.java bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java
git commit -m "Add preset stepping to DeviceHandler"
```

---

### Task 4: Browser match-selection helper (pure logic)

**Files:**
- Create: `mcp-server/src/helpers/browser-match.ts`
- Modify: `mcp-server/src/helpers/index.ts`

**Interfaces:**
- Consumes: nothing — pure function, no I/O.
- Produces (Task 6 depends on these exact names and types):
  - `interface BrowserResult { index: number; name: string }`
  - `type MatchRule = 'exact' | 'unique-substring' | 'shortest-substring' | 'none'`
  - `interface MatchOutcome { match: BrowserResult | null; rule: MatchRule; alternatives: string[] }`
  - `function selectBrowserMatch(results: BrowserResult[], query: string): MatchOutcome`

This is the spec's "Match selection rules" section, isolated so the
selection behavior is deterministic and readable on its own.

- [ ] **Step 1: Write the helper**

```typescript
/**
 * Browser match selection.
 *
 * Picking a result from a browser search must be deterministic rather than
 * a "best guess", so callers can explain what was loaded and why.
 * Implements the rules from the browser/device-loading design spec.
 */

/** A single browser result (index is 0-based internal, as Bitwig returns it) */
export interface BrowserResult {
  index: number;
  name: string;
}

/** Which rule produced the match */
export type MatchRule = 'exact' | 'unique-substring' | 'shortest-substring' | 'none';

export interface MatchOutcome {
  match: BrowserResult | null;
  rule: MatchRule;
  /** Names that were passed over (only populated when the choice was ambiguous) */
  alternatives: string[];
}

/**
 * Select a result for a query, in this order:
 *   1. Case-insensitive exact name match.
 *   2. Exactly one case-insensitive substring match.
 *   3. Several substring matches - the shortest name wins (the
 *      least-decorated match, e.g. "Polysynth" over "Polysynth Bass Kit"),
 *      and the rest are returned as alternatives.
 *   4. No matches.
 */
export function selectBrowserMatch(results: BrowserResult[], query: string): MatchOutcome {
  const needle = query.trim().toLowerCase();

  const exact = results.find(r => r.name.toLowerCase() === needle);
  if (exact) {
    return { match: exact, rule: 'exact', alternatives: [] };
  }

  const substring = results.filter(r => r.name.toLowerCase().includes(needle));

  if (substring.length === 1) {
    return { match: substring[0], rule: 'unique-substring', alternatives: [] };
  }

  if (substring.length > 1) {
    // Shortest name = least decorated match
    const sorted = [...substring].sort((a, b) => a.name.length - b.name.length);
    return {
      match: sorted[0],
      rule: 'shortest-substring',
      alternatives: sorted.slice(1).map(r => r.name)
    };
  }

  return { match: null, rule: 'none', alternatives: [] };
}
```

- [ ] **Step 2: Export it**

In `mcp-server/src/helpers/index.ts`, next to the `selectTrackIfNeeded`
export:

```typescript
export { selectBrowserMatch, BrowserResult, MatchRule, MatchOutcome } from './browser-match.js';
```

- [ ] **Step 3: Verify the logic by hand before building**

There is no test runner in this project, so sanity-check the four rules
with a one-off script, then delete it:

```bash
cd mcp-server && npx tsx -e "
import { selectBrowserMatch } from './src/helpers/browser-match.js';
const r = [{index:0,name:'Polysynth'},{index:1,name:'Polysynth Bass Kit'},{index:2,name:'FM-4'}];
console.log(selectBrowserMatch(r, 'polysynth').rule);        // exact
console.log(selectBrowserMatch(r, 'fm').rule);               // unique-substring
console.log(selectBrowserMatch(r, 'poly').rule);             // shortest-substring
console.log(selectBrowserMatch(r, 'poly').match?.name);      // Polysynth
console.log(selectBrowserMatch(r, 'zzz').rule);              // none
"
```

Expected output, in order: `exact`, `unique-substring`,
`shortest-substring`, `Polysynth`, `none`. If any line differs, the helper
is wrong — fix it before moving on.

- [ ] **Step 4: Build**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/helpers/browser-match.ts mcp-server/src/helpers/index.ts
git commit -m "Add deterministic browser match selection helper"
```

---

### Task 5: Session-layer browser handlers

**Files:**
- Create: `mcp-server/src/handlers/browser.ts`
- Reference (do not modify): `mcp-server/src/handlers/device.ts` (pattern
  source), `mcp-server/src/handlers/types.ts`, `mcp-server/src/helpers/device-selection.ts`

**Interfaces:**
- Consumes: `HandlerContext { dawManager, config, daw, args }`;
  `dawManager.send(method, params, daw)`; `selectTrackIfNeeded(dawManager,
  config, daw, args)` from `../helpers/index.js`; `toInternal` / `toUser`.
  The `browser.*` wire contract from Task 2.
- Produces (Task 6 and Task 7 depend on these):
  - `handleBrowserOpen`, `handleBrowserSetContentType`, `handleBrowserSetFilter`,
    `handleBrowserGetResults`, `handleBrowserSelect`, `handleBrowserCommit`,
    `handleBrowserCancel`, `handleBrowserGetState` — all
    `(ctx: HandlerContext) => Promise<ToolResult>`
  - `settle(config)` — shared delay helper, re-used by Task 6

- [ ] **Step 1: Write the handlers**

```typescript
/**
 * Session-layer browser handlers: direct 1:1 access to the Bitwig popup
 * browser primitives.
 *
 * Browser results populate asynchronously, so each step that changes what
 * the browser is showing is followed by a settle delay before the next
 * read. These tools are disabled by default - see DEFAULT_DISABLED_TOOLS.
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { Config } from '../config.js';
import { toInternal, toUser, selectTrackIfNeeded } from '../helpers/index.js';

/** Wait for Bitwig to settle after a browser state change */
export function settle(config: Config): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, config.mcp.selectionDelayMs));
}

/** Handle browser_open */
export async function handleBrowserOpen(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const mode = (args.mode as string | undefined) ?? 'end';
  const position = args.position as number | undefined;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', {
      mode,
      ...(position !== undefined && { position: toInternal(position) })
    }, daw);
    await settle(config);

    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_set_content_type */
export async function handleBrowserSetContentType(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;

  try {
    await dawManager.send('browser.setContentType', { name }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_set_filter */
export async function handleBrowserSetFilter(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const column = args.column as string;
  const value = args.value as string | undefined;

  try {
    await dawManager.send('browser.setFilter', { column, value: value ?? '' }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_get_results */
export async function handleBrowserGetResults(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const limit = (args.limit as number | undefined) ?? 50;

  try {
    const result = await dawManager.send('browser.getResults', {}, daw) as {
      results?: Array<{ index: number; name: string }>;
      count?: number;
      totalCount?: number;
    };

    const results = (result.results ?? []).slice(0, limit).map(r => ({
      index: toUser(r.index),
      name: r.name
    }));

    return successResult({
      results,
      count: results.length,
      totalCount: result.totalCount ?? results.length
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_select */
export async function handleBrowserSelect(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const index = args.index as number;

  try {
    await dawManager.send('browser.select', { index: toInternal(index) }, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_commit */
export async function handleBrowserCommit(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw } = ctx;

  try {
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_cancel */
export async function handleBrowserCancel(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw } = ctx;

  try {
    await dawManager.send('browser.cancel', {}, daw);
    await settle(config);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle browser_get_state */
export async function handleBrowserGetState(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const state = await dawManager.send('browser.getState', {}, daw);
    return successResult(state);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 2: Build**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/handlers/browser.ts
git commit -m "Add session-layer browser handlers"
```

---

### Task 6: Atomic browser handlers

**Files:**
- Create: `mcp-server/src/handlers/browser-load.ts`

**Interfaces:**
- Consumes: `settle(config)` from `./browser.js` (Task 5);
  `selectBrowserMatch`, `BrowserResult` from `../helpers/index.js` (Task 4);
  `selectTrackIfNeeded`, `toInternal`; the `browser.*` wire contract (Task 2).
- Produces: `handleLoadDevice`, `handleLoadPreset`, `handleSearchBrowser` —
  all `(ctx: HandlerContext) => Promise<ToolResult>`, consumed by Task 7.

The two invariants from the Global Constraints are enforced here: every
path cancels the session in a `finally`, and `searchBrowser` never calls
`browser.commit`.

- [ ] **Step 1: Write the handlers**

```typescript
/**
 * Atomic browser handlers: load_device, load_preset, search_browser.
 *
 * Each composes the browser.* primitives into a single call that always
 * ends with the popup closed - committed on success, cancelled otherwise.
 * The popup is modal in Bitwig's UI, so leaking an open session would
 * block the user.
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { settle } from './browser.js';
import { selectBrowserMatch, BrowserResult, selectTrackIfNeeded, toInternal } from '../helpers/index.js';
import { DAWClientManager, DAWType } from '../daw-client.js';

/** Read the current results column (0-based indices, as Bitwig returns them) */
async function readResults(
  dawManager: DAWClientManager,
  daw: DAWType
): Promise<BrowserResult[]> {
  const result = await dawManager.send('browser.getResults', {}, daw) as {
    results?: BrowserResult[];
  };
  return result.results ?? [];
}

/** Cancel the browser, swallowing errors - this runs on failure paths */
async function cancelQuietly(dawManager: DAWClientManager, daw: DAWType): Promise<void> {
  try {
    await dawManager.send('browser.cancel', {}, daw);
  } catch {
    // Already closed, or the session never opened - nothing to clean up
  }
}

/** Handle load_device */
export async function handleLoadDevice(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;
  const position = args.position as number | undefined;
  let committed = false;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', {
      mode: position === undefined ? 'end' : 'position',
      ...(position !== undefined && { position: toInternal(position) })
    }, daw);
    await settle(config);

    const results = await readResults(dawManager, daw);
    const outcome = selectBrowserMatch(results, name);

    if (!outcome.match) {
      const available = results.slice(0, 10).map(r => r.name);
      return errorResult(
        `No browser results matching "${name}".` +
        (available.length > 0 ? ` Available: ${available.join(', ')}` : '')
      );
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    committed = true;

    return successResult({
      success: true,
      loaded: outcome.match.name,
      matchedBy: outcome.rule,
      ...(outcome.alternatives.length > 0 && { alternatives: outcome.alternatives })
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: never leave the popup open
    if (!committed) {
      await cancelQuietly(dawManager, daw);
    }
  }
}

/** Handle load_preset */
export async function handleLoadPreset(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const name = args.name as string;
  let committed = false;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    // "replace" opens the browser against the cursor device, which is how
    // Bitwig exposes that device's presets
    await dawManager.send('browser.open', { mode: 'replace' }, daw);
    await settle(config);

    await dawManager.send('browser.setContentType', { name: 'Presets' }, daw);
    await settle(config);

    const results = await readResults(dawManager, daw);
    const outcome = selectBrowserMatch(results, name);

    if (!outcome.match) {
      const available = results.slice(0, 10).map(r => r.name);
      return errorResult(
        `No preset matching "${name}".` +
        (available.length > 0 ? ` Available: ${available.join(', ')}` : '')
      );
    }

    await dawManager.send('browser.select', { index: outcome.match.index }, daw);
    await settle(config);
    await dawManager.send('browser.commit', {}, daw);
    await settle(config);
    committed = true;

    return successResult({
      success: true,
      preset: outcome.match.name,
      matchedBy: outcome.rule,
      ...(outcome.alternatives.length > 0 && { alternatives: outcome.alternatives })
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    if (!committed) {
      await cancelQuietly(dawManager, daw);
    }
  }
}

/**
 * Handle search_browser.
 *
 * Invariant: never commits. This opens a session purely to read what is
 * available, then always cancels - nothing is inserted into the project.
 */
export async function handleSearchBrowser(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  const query = args.query as string | undefined;
  const contentType = args.contentType as string | undefined;
  const category = args.category as string | undefined;
  const creator = args.creator as string | undefined;
  const limit = (args.limit as number | undefined) ?? 50;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    await dawManager.send('browser.open', { mode: 'end' }, daw);
    await settle(config);

    if (contentType !== undefined) {
      await dawManager.send('browser.setContentType', { name: contentType }, daw);
      await settle(config);
    }
    if (category !== undefined) {
      await dawManager.send('browser.setFilter', { column: 'category', value: category }, daw);
      await settle(config);
    }
    if (creator !== undefined) {
      await dawManager.send('browser.setFilter', { column: 'creator', value: creator }, daw);
      await settle(config);
    }

    const results = await readResults(dawManager, daw);

    const filtered = query === undefined
      ? results
      : results.filter(r => r.name.toLowerCase().includes(query.trim().toLowerCase()));

    return successResult({
      results: filtered.slice(0, limit).map(r => r.name),
      count: Math.min(filtered.length, limit),
      totalAvailable: results.length
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  } finally {
    // Invariant: search never commits
    await cancelQuietly(dawManager, daw);
  }
}
```

- [ ] **Step 2: Build**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/handlers/browser-load.ts
git commit -m "Add atomic load_device, load_preset, search_browser handlers"
```

---

### Task 7: Preset handlers, tool definitions, and registration

**Files:**
- Modify: `mcp-server/src/handlers/device.ts`
- Modify: `mcp-server/src/handlers/index.ts`
- Modify: `mcp-server/src/tools/definitions.ts`
- Modify: `mcp-server/src/server.ts`
- Modify: `mcp-server/src/config.ts`

**Interfaces:**
- Consumes: the handlers produced by Tasks 5 and 6.
- Produces: 13 new tools reachable through the MCP tool registry —
  `load_device`, `load_preset`, `search_browser`, `next_preset`,
  `previous_preset` (enabled by default), and `browser_open`,
  `browser_set_content_type`, `browser_set_filter`, `browser_get_results`,
  `browser_select`, `browser_commit`, `browser_cancel`,
  `browser_get_state` (disabled by default).

- [ ] **Step 1: Add preset handlers to `device.ts`**

Append to `mcp-server/src/handlers/device.ts`:

```typescript
/** Handle next_preset */
export async function handleNextPreset(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    const result = await dawManager.send('device.nextPreset', {}, daw) as { presetName?: string };
    return successResult({ success: true, presetName: result.presetName ?? '' });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle previous_preset */
export async function handlePreviousPreset(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, config, daw, args } = ctx;

  try {
    await selectTrackIfNeeded(dawManager, config, daw, args);

    const result = await dawManager.send('device.previousPreset', {}, daw) as { presetName?: string };
    return successResult({ success: true, presetName: result.presetName ?? '' });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
```

- [ ] **Step 2: Add the tool definitions**

In `mcp-server/src/tools/definitions.ts`, immediately after the
`delete_device` tool definition block, insert:

```typescript
    // Device loading tools (atomic)
    {
      name: 'load_device',
      description: 'Load a Bitwig device into a track\'s device chain by name. Opens Bitwig\'s browser, picks the best match, and commits - the popup is always closed when this returns. Returns the name actually loaded. Works on the track currently selected in DAW\'s UI by default.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          name: { type: 'string', description: 'Device name to search for, e.g. "Polysynth"' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' },
          position: { type: 'integer', description: 'Device chain position to insert at, 1-based (optional - appends to end of chain if omitted)' }
        },
        required: ['name']
      }
    },
    {
      name: 'load_preset',
      description: 'Load a preset by name onto the currently selected device (cursor device). Opens Bitwig\'s browser against that device, picks the best match, and commits - the popup is always closed when this returns.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          name: { type: 'string', description: 'Preset name to search for' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: ['name']
      }
    },
    {
      name: 'search_browser',
      description: 'Search what is available in Bitwig\'s browser WITHOUT loading anything. Read-only: always cancels, never inserts into the project. Use to discover device or preset names before calling load_device/load_preset.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          query: { type: 'string', description: 'Filter result names by this substring (optional)' },
          contentType: { type: 'string', description: 'Browser content type, e.g. "Devices" or "Presets" (optional)' },
          category: { type: 'string', description: 'Category column filter, e.g. "Synth" (optional)' },
          creator: { type: 'string', description: 'Creator column filter (optional)' },
          limit: { type: 'integer', description: 'Max results to return (default: 50)' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'next_preset',
      description: 'Step the currently selected device (cursor device) to its next preset. No browser popup involved.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'previous_preset',
      description: 'Step the currently selected device (cursor device) to its previous preset. No browser popup involved.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },

    // Browser session tools (disabled by default - see config)
    {
      name: 'browser_open',
      description: 'Open a Bitwig browser session. Advanced: prefer load_device/load_preset unless you need precise filter control. Cancels any stale session first. IMPORTANT: the popup is modal in Bitwig - always finish with browser_commit or browser_cancel.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          mode: { type: 'string', enum: ['end', 'position', 'replace'], description: 'end = append to device chain (default), position = insert at a chain slot, replace = open against the cursor device (used for presets)' },
          position: { type: 'integer', description: 'Device chain position, 1-based (required when mode is "position")' },
          trackIndex: { type: 'integer', description: 'Track number, 1-based (optional - uses DAW UI selection if omitted)' }
        },
        required: []
      }
    },
    {
      name: 'browser_set_content_type',
      description: 'Switch the browser\'s content type, e.g. "Devices" or "Presets". Requires an open browser session. Call browser_get_state to see the available content type names.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          name: { type: 'string', description: 'Content type name, e.g. "Devices" or "Presets"' }
        },
        required: ['name']
      }
    },
    {
      name: 'browser_set_filter',
      description: 'Select a value in one of the browser\'s filter columns. Omit value to clear that filter (selects the wildcard entry). Requires an open browser session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          column: { type: 'string', enum: ['category', 'creator', 'tag', 'device', 'deviceType', 'fileType', 'location', 'smartCollection'], description: 'Filter column to set' },
          value: { type: 'string', description: 'Entry name to select (optional - clears the filter if omitted)' }
        },
        required: ['column']
      }
    },
    {
      name: 'browser_get_results',
      description: 'Read the current browser results. Requires an open browser session.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          limit: { type: 'integer', description: 'Max results to return (default: 50)' }
        },
        required: []
      }
    },
    {
      name: 'browser_select',
      description: 'Select a browser result by its 1-based position. Requires an open browser session. Does not load it - call browser_commit to apply.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          index: { type: 'integer', description: 'Result position, 1-based' }
        },
        required: ['index']
      }
    },
    {
      name: 'browser_commit',
      description: 'Commit the browser selection, loading it into the project, and close the popup.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'browser_cancel',
      description: 'Cancel the browser session without loading anything. Safe to call when no session is open - use this to clear a stuck popup.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'browser_get_state',
      description: 'Report whether a browser session is open, plus its title, content type, available content types, and result count.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
```

- [ ] **Step 3: Export the handlers**

In `mcp-server/src/handlers/index.ts`, update the device export line to add
the preset handlers, and add the two browser export lines:

```typescript
// Device handlers
export { handleListDevices, handleSelectDevice, handleGetDeviceParameters, handleSetDeviceParameter, handleDeleteDevice, handleNextPreset, handlePreviousPreset } from './device.js';

// Browser handlers (session layer)
export { handleBrowserOpen, handleBrowserSetContentType, handleBrowserSetFilter, handleBrowserGetResults, handleBrowserSelect, handleBrowserCommit, handleBrowserCancel, handleBrowserGetState, settle } from './browser.js';

// Browser handlers (atomic layer)
export { handleLoadDevice, handleLoadPreset, handleSearchBrowser } from './browser-load.js';
```

- [ ] **Step 4: Register in the server**

In `mcp-server/src/server.ts`, update the device import to include the
preset handlers and add the browser imports (after the device import line):

```typescript
import { handleListDevices, handleSelectDevice, handleGetDeviceParameters, handleSetDeviceParameter, handleDeleteDevice, handleNextPreset, handlePreviousPreset } from './handlers/device.js';
import { handleBrowserOpen, handleBrowserSetContentType, handleBrowserSetFilter, handleBrowserGetResults, handleBrowserSelect, handleBrowserCommit, handleBrowserCancel, handleBrowserGetState } from './handlers/browser.js';
import { handleLoadDevice, handleLoadPreset, handleSearchBrowser } from './handlers/browser-load.js';
```

In `createToolRegistry()`, after the `['delete_device', handleDeleteDevice],`
line, add:

```typescript
    ['next_preset', handleNextPreset],
    ['previous_preset', handlePreviousPreset],

    // Device loading (atomic)
    ['load_device', handleLoadDevice],
    ['load_preset', handleLoadPreset],
    ['search_browser', handleSearchBrowser],

    // Browser session layer
    ['browser_open', handleBrowserOpen],
    ['browser_set_content_type', handleBrowserSetContentType],
    ['browser_set_filter', handleBrowserSetFilter],
    ['browser_get_results', handleBrowserGetResults],
    ['browser_select', handleBrowserSelect],
    ['browser_commit', handleBrowserCommit],
    ['browser_cancel', handleBrowserCancel],
    ['browser_get_state', handleBrowserGetState],
```

- [ ] **Step 5: Disable the session tools by default**

In `mcp-server/src/config.ts`, add these entries to the
`DEFAULT_DISABLED_TOOLS` array, keeping the existing inline-comment style:

```typescript
  'browser_open',             // Advanced - prefer load_device/load_preset
  'browser_set_content_type', // Advanced - session layer
  'browser_set_filter',       // Advanced - session layer
  'browser_get_results',      // Advanced - session layer
  'browser_select',           // Advanced - session layer
  'browser_commit',           // Advanced - session layer
  'browser_cancel',           // Advanced - session layer
  'browser_get_state',        // Advanced - session layer
```

- [ ] **Step 6: Build**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors. `load_device`, `load_preset`,
`search_browser`, `next_preset`, and `previous_preset` should now appear in
the tool list; the eight `browser_*` tools should not, unless enabled in
the config file.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/handlers/device.ts mcp-server/src/handlers/index.ts mcp-server/src/tools/definitions.ts mcp-server/src/server.ts mcp-server/src/config.ts
git commit -m "Register browser and preset tools in MCP server"
```

---

### Task 8: End-to-end verification against live Bitwig

**Files:** none (verification only)

This task requires a running Bitwig Studio instance. If none is available,
stop and report that rather than marking the task complete — every earlier
task's correctness beyond compilation rests on this.

- [ ] **Step 1: Build and deploy both components**

```bash
cd bitwig-extension && "/c/Users/d7/.gradle/wrapper/dists/gradle-8.14-bin/38aieal9i53h9rfe7vjup95b9/gradle-8.14/bin/gradle.bat" build --offline
cd ../mcp-server && npm run build && npx esbuild src/index.ts --bundle --minify --platform=node --format=esm --outfile=dist/mcp-server.js --external:net --external:fs --external:path --external:os
```

Copy the built extension over the deployed one, then copy the bundle to the
path the MCP client config points at:

```bash
cp ../bitwig-extension/build/libs/daw-mcp-*.bwextension ~/Documents/"Bitwig Studio"/Extensions/BitwigMCP.bwextension
cp dist/mcp-server.js ~/.local/daw-mcp/mcp-server/dist/mcp-server.js
```

Note: overwriting the `.bwextension` file while Bitwig is running drops the
extension's TCP server. Reload the extension in Bitwig (Settings >
Controllers, disable/re-enable) or restart Bitwig, and restart the MCP
client session so the new tool list is picked up.

- [ ] **Step 2: Walk the spec's test plan**

1. `search_browser({query: "poly"})` — returns results, and **nothing is
   inserted** into the project. Verify with `list_devices` that the chain
   is unchanged.
2. `load_device({name: "Polysynth"})` — the device appears in the chain.
   Confirm with `list_devices`.
3. `load_device({name: "poly"})` — loads a sensible match, and the response
   names what was loaded plus `matchedBy`.
4. `load_preset({name: "<a real preset for that device>"})` — applies;
   confirm parameter values changed via `get_device_parameters`.
5. `load_device({name: "zzzznotathing"})` — clear no-match error, and
   `browser_get_state` (temporarily enabled in config) reports
   `isOpen: false`.
6. `next_preset()` then `previous_preset()` — `presetName` changes, no
   popup appears.
7. Enable the session tools in the config file and walk one manual
   sequence: `browser_open` → `browser_set_filter` → `browser_get_results`
   → `browser_select` → `browser_commit`.

- [ ] **Step 3: Report results**

If any step fails, record the exact error and which step, and fix before
proceeding to Task 9. Pay particular attention to whether
`config.mcp.selectionDelayMs` is long enough for browser results to
populate — if results come back empty when they should not, that delay is
the first suspect.

---

### Task 9: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new tools to the tool tables**

Run `grep -n "^| Devices\||^### Optional Tools" CLAUDE.md` to locate both
tables.

In the "Available Tools (Enabled by Default)" table, add a row after the
`Devices` row:

```markdown
| Device Loading | `load_device`, `load_preset`, `search_browser`, `next_preset`, `previous_preset` |
```

In the "Optional Tools (Disabled by Default)" table, add these rows:

```markdown
| `browser_open` | Precise browser filter control |
| `browser_set_content_type` | Switch between Devices/Presets manually |
| `browser_set_filter` | Precise browser filter control |
| `browser_get_results` | Precise browser filter control |
| `browser_select` | Precise browser filter control |
| `browser_commit` | Precise browser filter control |
| `browser_cancel` | Clear a stuck browser popup |
| `browser_get_state` | Inspect browser session state |
```

- [ ] **Step 2: Add a "Device Loading" subsection**

Immediately after the existing "### Device Control - Cursor Device Model"
subsection, add:

```markdown
### Device Loading - Browser Session Model

Loading a device or preset goes through Bitwig's **popup browser**. Bitwig
exposes no way to look up a device's UUID at runtime
(`createSpecificBitwigDevice` consumes a UUID but nothing yields one), so
direct insertion would require a hardcoded ID table — the browser is the
only reliable mechanism.

**Two layers:**

- **Atomic** (enabled by default): `load_device`, `load_preset`,
  `search_browser`. Each opens a session, does its work, and always closes
  the popup before returning.
- **Session** (disabled by default): `browser_open`,
  `browser_set_content_type`, `browser_set_filter`, `browser_get_results`,
  `browser_select`, `browser_commit`, `browser_cancel`,
  `browser_get_state`. Enable these in config only when you need
  filter-column control the atomic tools do not expose.

**Two invariants:**

1. `load_device`/`load_preset` never leave the popup open — every failure
   path cancels it. The popup is modal in Bitwig's UI, so a leaked session
   would block you.
2. `search_browser` never commits — discovery cannot modify the project.

**Match selection** is deterministic rather than a best guess: exact
case-insensitive name match, else a unique substring match, else the
shortest substring match (with the alternatives reported). The response
always names what was actually loaded.

**Async results:** browser results populate asynchronously, and Bitwig's
observers cannot fire while a Java handler blocks. So the Java layer only
exposes non-blocking primitives, and the MCP server inserts
`mcp.selectionDelayMs` waits between steps. If searches come back
unexpectedly empty, raising that config value is the first thing to try.

**Preset stepping** (`next_preset`/`previous_preset`) uses the `Device` API
directly and involves no browser popup at all.

**Examples:**
```typescript
search_browser({query: "poly"})              // Discover, loads nothing
load_device({name: "Polysynth"})             // Append to cursor track's chain
load_device({name: "EQ+", trackIndex: 2})    // Onto a specific track
load_preset({name: "Warm Pad"})              // Onto the cursor device
next_preset()                                // Step presets, no popup
```

**Config:** `bitwig.browserResults` (default 32) sets how many browser
results are readable at once.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document browser and device loading tools in CLAUDE.md"
```
