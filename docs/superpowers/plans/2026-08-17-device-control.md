# Device/Parameter Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add device (plugin/instrument/effect chain) discovery and generic
8-parameter read/write to the Bitwig MCP extension and MCP server, so Claude
can list devices on the selected track and read/tweak their parameters.

**Architecture:** A fourth cursor object (`cursorDevice`) is added to
`BitwigMCPExtension`, mirroring the existing `cursorClip`/`cursorTrack`
cursor-follows-UI-selection pattern. A new `DeviceHandler.java` exposes
`device.list` / `device.select` / `device.getParameters` /
`device.setParameter` over the existing TCP/JSON-RPC dispatch. The MCP
server gets a matching `handlers/device.ts` and four new tool definitions,
following the exact file-per-domain structure already used for tracks/clips/notes.

**Tech Stack:** Java 11 (Bitwig Extension API v18, Gson), TypeScript
(`@modelcontextprotocol/sdk`).

**Spec:** `docs/superpowers/specs/2026-08-17-device-control-design.md`

## Global Constraints

- Cursor-only addressing: device ops act on `cursorTrack`'s device chain,
  no `trackIndex` parameter (per spec).
- 8-slot generic remote controls page only; no bypass/enable toggle, no
  per-plugin native parameter typing, no nested/rack device chains (per spec).
- User-facing device index is 1-based (matches track/clip index convention
  in `mcp-server/src/helpers/indices.ts`); parameter index (0-7) stays
  0-based, matching the existing note `x`/`y` convention (not index-converted).
- Parameter `value` is clamped to [0.0, 1.0], matching `TrackHandler`'s
  volume/pan clamping style.
- This codebase has no automated Java or TypeScript unit tests — verification
  is manual/E2E against a running Bitwig instance (per existing project
  pattern, confirmed by grep: no `*.test.ts` files exist and Java has no
  test source set). Steps below replace "write failing test" with "build
  and manually verify against Bitwig" accordingly.
- Bitwig API v18 signatures used below were verified directly against
  `extension-api-18.jar` (via `javap`), not assumed from memory.

---

### Task 1: Extend `BitwigMCPExtension.java` with cursor device objects

**Files:**
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java`

**Interfaces:**
- Consumes: existing `cursorTrack` field (created at line 61 of current file).
- Produces (new getters other tasks rely on):
  - `public CursorDevice getCursorDevice()`
  - `public DeviceBank getDeviceBank()`
  - `public CursorRemoteControlsPage getRemoteControls()`

- [ ] **Step 1: Add fields**

In the field declarations near the top of the class (after `private Clip cursorClip;`), add:

```java
    private CursorDevice cursorDevice;
    private DeviceBank deviceBank;
    private CursorRemoteControlsPage remoteControls;
```

- [ ] **Step 2: Create the cursor device, device bank, and remote controls page in `init()`**

Immediately after the existing cursor clip setup block (after the line
`cursorClip.exists().markInterested();` and before the
`// Mark cursorTrack's clip launcher slots...` comment), insert:

```java
        // Create cursor device for parameter control - follows user's device selection in Bitwig UI
        cursorDevice = cursorTrack.createCursorDevice(
                "MCP_DEVICE", "MCP Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION);
        cursorDevice.exists().markInterested();
        cursorDevice.name().markInterested();
        cursorDevice.position().markInterested();

        // Device bank for listing the full chain on the cursor track
        deviceBank = cursorTrack.createDeviceBank(config.getDevices());
        for (int d = 0; d < deviceBank.getSizeOfBank(); d++) {
            Device device = deviceBank.getDevice(d);
            device.exists().markInterested();
            device.name().markInterested();
            device.position().markInterested();
        }

        // Generic 8-slot remote controls page - works across any plugin type
        remoteControls = cursorDevice.createCursorRemoteControlsPage(8);
        for (int p = 0; p < 8; p++) {
            RemoteControl param = remoteControls.getParameter(p);
            param.name().markInterested();
            param.value().markInterested();
            param.value().displayedValue().markInterested();
        }
```

This requires `import com.bitwig.extension.controller.api.*;` (already present
at the top of the file) which covers `CursorDevice`, `DeviceBank`, `Device`,
`CursorRemoteControlsPage`, `RemoteControl`, `CursorDeviceFollowMode`.

- [ ] **Step 3: Add `getDevices()` to `ConfigReader.java` with a default**

`ConfigReader.java` (`bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/config/ConfigReader.java`)
loads each field as a plain instance field with a hardcoded default,
optionally overridden from the `bitwig` JSON section in `load()`. Follow
that exact pattern.

Add the field, next to `private int scenes = 128;`:

```java
    private int devices = 8;
```

In `load()`, inside the `if (root.has("bitwig")) { ... }` block, next to
the `scenes` line:

```java
                if (bitwig.has("devices")) devices = bitwig.get("devices").getAsInt();
```

Add the getter, next to `public int getScenes() { return scenes; }`:

```java
    public int getDevices() { return devices; }
```

- [ ] **Step 4: Add the getters**

After the existing `public Clip getCursorClip() { return cursorClip; }`
getter, add:

```java
    public CursorDevice getCursorDevice() {
        return cursorDevice;
    }

    public DeviceBank getDeviceBank() {
        return deviceBank;
    }

    public CursorRemoteControlsPage getRemoteControls() {
        return remoteControls;
    }
```

- [ ] **Step 5: Build to verify it compiles**

```bash
cd bitwig-extension && gradle build
```

Expected: `BUILD SUCCESSFUL`. This is the "test" for this task since there's
no unit test harness — a clean compile against the real API jar is the
verification.

- [ ] **Step 6: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/BitwigMCPExtension.java bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/config/ConfigReader.java
git commit -m "Add cursor device, device bank, remote controls page to Bitwig extension"
```

---

### Task 2: Create `DeviceHandler.java`

**Files:**
- Create: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/DeviceHandler.java`

**Interfaces:**
- Consumes: `extension.getCursorDevice()`, `extension.getDeviceBank()`,
  `extension.getRemoteControls()` from Task 1.
- Produces: `public JsonElement handle(String action, JsonObject params)`,
  used by `CommandDispatcher` in Task 3.

- [ ] **Step 1: Write the handler**

```java
package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.*;

import com.pxaudio.bitwigmcp.BitwigMCPExtension;

/**
 * Handles device operations: list devices in the cursor track's chain,
 * select the cursor device, read/write its 8 generic remote control parameters.
 */
public class DeviceHandler {
    private final BitwigMCPExtension extension;
    private final ControllerHost host;

    public DeviceHandler(BitwigMCPExtension extension, ControllerHost host) {
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
            case "list":
                return listDevices();
            case "select":
                return selectDevice(params);
            case "getParameters":
                return getParameters();
            case "setParameter":
                return setParameter(params);
            default:
                throw new IllegalArgumentException("Unknown device action: " + action);
        }
    }

    private JsonElement listDevices() {
        DeviceBank deviceBank = extension.getDeviceBank();
        JsonArray devices = new JsonArray();

        for (int i = 0; i < deviceBank.getSizeOfBank(); i++) {
            Device device = deviceBank.getDevice(i);
            if (device.exists().get()) {
                JsonObject obj = new JsonObject();
                obj.addProperty("index", i);
                obj.addProperty("name", device.name().get());
                devices.add(obj);
            }
        }

        JsonObject result = new JsonObject();
        result.add("devices", devices);
        result.addProperty("count", devices.size());
        return result;
    }

    private JsonElement selectDevice(JsonObject params) {
        int index = getDeviceIndex(params);
        DeviceBank deviceBank = extension.getDeviceBank();
        Device device = deviceBank.getDevice(index);

        if (!device.exists().get()) {
            throw new IllegalArgumentException("Device does not exist at index: " + index);
        }

        extension.getCursorDevice().selectDevice(device);
        return successResponse();
    }

    private JsonElement getParameters() {
        if (!extension.getCursorDevice().exists().get()) {
            throw new IllegalArgumentException("No device selected. Select a device in Bitwig.");
        }

        CursorRemoteControlsPage remoteControls = extension.getRemoteControls();
        JsonArray parameters = new JsonArray();

        for (int i = 0; i < 8; i++) {
            RemoteControl param = remoteControls.getParameter(i);
            JsonObject obj = new JsonObject();
            obj.addProperty("index", i);
            obj.addProperty("name", param.name().get());
            obj.addProperty("value", param.value().get());
            obj.addProperty("displayedValue", param.value().displayedValue().get());
            parameters.add(obj);
        }

        JsonObject result = new JsonObject();
        result.add("parameters", parameters);
        result.addProperty("count", parameters.size());
        return result;
    }

    private JsonElement setParameter(JsonObject params) {
        if (!extension.getCursorDevice().exists().get()) {
            throw new IllegalArgumentException("No device selected. Select a device in Bitwig.");
        }

        int index = params.get("index").getAsInt();
        if (index < 0 || index > 7) {
            throw new IllegalArgumentException("Parameter index must be 0-7, got: " + index);
        }
        double value = params.get("value").getAsDouble();

        RemoteControl param = extension.getRemoteControls().getParameter(index);
        param.value().set(Math.max(0, Math.min(1, value)));
        return successResponse();
    }

    private int getDeviceIndex(JsonObject params) {
        if (!params.has("index")) {
            throw new IllegalArgumentException("Missing 'index' parameter");
        }
        return params.get("index").getAsInt();
    }
}
```

- [ ] **Step 2: Build to verify it compiles**

```bash
cd bitwig-extension && gradle build
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/DeviceHandler.java
git commit -m "Add DeviceHandler for device list/select/parameter operations"
```

---

### Task 3: Wire `device` category into `CommandDispatcher.java`

**Files:**
- Modify: `bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/CommandDispatcher.java`

**Interfaces:**
- Consumes: `DeviceHandler` from Task 2.
- Produces: `device.*` methods reachable through `dispatch(String method, JsonObject params)`.

- [ ] **Step 1: Add the field and constructor wiring**

In `CommandDispatcher.java`, change:

```java
    private final ProjectHandler projectHandler;
    private final TrackHandler trackHandler;
    private final ClipHandler clipHandler;
    private final TransportHandler transportHandler;

    public CommandDispatcher(BitwigMCPExtension extension, ControllerHost host) {
        this.projectHandler = new ProjectHandler(extension, host);
        this.trackHandler = new TrackHandler(extension, host);
        this.clipHandler = new ClipHandler(extension, host);
        this.transportHandler = new TransportHandler(extension, host);
    }
```

to:

```java
    private final ProjectHandler projectHandler;
    private final TrackHandler trackHandler;
    private final ClipHandler clipHandler;
    private final TransportHandler transportHandler;
    private final DeviceHandler deviceHandler;

    public CommandDispatcher(BitwigMCPExtension extension, ControllerHost host) {
        this.projectHandler = new ProjectHandler(extension, host);
        this.trackHandler = new TrackHandler(extension, host);
        this.clipHandler = new ClipHandler(extension, host);
        this.transportHandler = new TransportHandler(extension, host);
        this.deviceHandler = new DeviceHandler(extension, host);
    }
```

- [ ] **Step 2: Add the switch case**

In `dispatch()`, change:

```java
            case "transport":
                return transportHandler.handle(action, params);
            case "ping":
```

to:

```java
            case "transport":
                return transportHandler.handle(action, params);
            case "device":
                return deviceHandler.handle(action, params);
            case "ping":
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd bitwig-extension && gradle build
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Deploy and manually smoke-test against Bitwig**

```bash
cd bitwig-extension && gradle copyExtension
```

Reload the extension in Bitwig Studio (Settings > Controllers, or restart
Bitwig). Load a track with an instrument that has a device chain, select
a device in Bitwig's UI, then send raw TCP JSON-RPC to verify (adjust host
if not localhost):

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"device.list","params":{}}' | nc localhost 8181
echo '{"jsonrpc":"2.0","id":2,"method":"device.getParameters","params":{}}' | nc localhost 8181
```

Expected: `device.list` returns the device chain with the selected device's
name; `device.getParameters` returns 8 entries with `name`/`value`/`displayedValue`.
If Bitwig hasn't built a remote controls page for the device yet, names may
be empty strings — that's expected Bitwig behavior, not a bug, and doesn't
block this task.

- [ ] **Step 5: Commit**

```bash
git add bitwig-extension/src/main/java/com/pxaudio/bitwigmcp/handlers/CommandDispatcher.java
git commit -m "Wire device category into CommandDispatcher"
```

---

### Task 4: Add MCP server tool handlers (`handlers/device.ts`)

**Files:**
- Create: `mcp-server/src/handlers/device.ts`
- Reference (do not modify): `mcp-server/src/handlers/tracks.ts` (pattern source),
  `mcp-server/src/handlers/types.ts` (`HandlerContext`, `successResult`, `errorResult`),
  `mcp-server/src/helpers/indices.ts` (`toInternal`, `toUser`)

**Interfaces:**
- Consumes: `HandlerContext { dawManager, config, daw, args }` from `./types.js`;
  `dawManager.send(method: string, params: object, daw: DAWType): Promise<unknown>`
  (existing `DAWClientManager` method, already used by every other handler).
- Produces: `handleListDevices`, `handleSelectDevice`, `handleGetDeviceParameters`,
  `handleSetDeviceParameter` — all `(ctx: HandlerContext) => Promise<ToolResult>`,
  consumed by Task 5.

- [ ] **Step 1: Write the handler file**

```typescript
/**
 * Device handlers: list_devices, select_device, get_device_parameters, set_device_parameter
 */

import { HandlerContext, ToolResult, successResult, errorResult } from './types.js';
import { toInternal, toUser } from '../helpers/index.js';

/** Handle list_devices */
export async function handleListDevices(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const result = await dawManager.send('device.list', {}, daw) as {
      devices?: Array<{ index: number; [key: string]: unknown }>
    };

    const devices = (result.devices ?? []).map(device => ({
      ...device,
      index: toUser(device.index)
    }));

    return successResult({ devices, count: devices.length });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle select_device */
export async function handleSelectDevice(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const index = args.index as number;
  try {
    await dawManager.send('device.select', { index: toInternal(index) }, daw);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle get_device_parameters */
export async function handleGetDeviceParameters(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw } = ctx;

  try {
    const result = await dawManager.send('device.getParameters', {}, daw) as {
      parameters?: Array<{ index: number; name: string; value: number; displayedValue: string }>
    };

    return successResult({ parameters: result.parameters ?? [], count: result.parameters?.length ?? 0 });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

/** Handle set_device_parameter */
export async function handleSetDeviceParameter(ctx: HandlerContext): Promise<ToolResult> {
  const { dawManager, daw, args } = ctx;

  const index = args.index as number;
  const value = args.value as number;
  try {
    await dawManager.send('device.setParameter', { index, value }, daw);
    return successResult({ success: true });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}
```

Note: `select_device`'s `index` is the 1-based device chain position (like
track index), so it goes through `toInternal`/`toUser`. `get_device_parameters`
/`set_device_parameter`'s `index` is the 0-7 remote control slot, which is
NOT converted — same convention as note `x`/`y` in `notes.ts`.

- [ ] **Step 2: Build to verify it compiles**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/handlers/device.ts
git commit -m "Add MCP server device handlers"
```

---

### Task 5: Register device tools (definitions, exports, server registry)

**Files:**
- Modify: `mcp-server/src/tools/definitions.ts`
- Modify: `mcp-server/src/handlers/index.ts`
- Modify: `mcp-server/src/server.ts`

**Interfaces:**
- Consumes: `handleListDevices`, `handleSelectDevice`, `handleGetDeviceParameters`,
  `handleSetDeviceParameter` from Task 4's `./handlers/device.js`.
- Produces: four new tools visible in the MCP tool list: `list_devices`,
  `select_device`, `get_device_parameters`, `set_device_parameter`.

- [ ] **Step 1: Add tool definitions**

In `mcp-server/src/tools/definitions.ts`, after the `list_tracks` tool
definition block (ends at the line with `inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }` followed by `},`), insert:

```typescript
    // Device tools
    {
      name: 'list_devices',
      description: 'List devices in the device chain of the track currently selected in DAW\'s UI (cursor track).',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'select_device',
      description: 'Select a device by its position in the cursor track\'s device chain. Moves the cursor device in Bitwig\'s UI.',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          index: { type: 'integer', description: 'Device position in chain, 1-based' }
        },
        required: ['index']
      }
    },
    {
      name: 'get_device_parameters',
      description: 'Read the 8 generic remote control parameters of the currently selected device (cursor device). Returns name, value (0.0-1.0), and displayedValue (human-readable string) for each.',
      inputSchema: { type: 'object', properties: { ...dawParam }, required: [] }
    },
    {
      name: 'set_device_parameter',
      description: 'Set one of the 8 generic remote control parameters on the currently selected device (cursor device).',
      inputSchema: {
        type: 'object',
        properties: {
          ...dawParam,
          index: { type: 'integer', description: 'Parameter slot, 0-7' },
          value: { type: 'number', description: 'Value from 0.0 to 1.0' }
        },
        required: ['index', 'value']
      }
    },
```

- [ ] **Step 2: Export the new handlers**

In `mcp-server/src/handlers/index.ts`, after the `// Track handlers` export
line, add:

```typescript
// Device handlers
export { handleListDevices, handleSelectDevice, handleGetDeviceParameters, handleSetDeviceParameter } from './device.js';
```

- [ ] **Step 3: Register in the server's tool registry**

In `mcp-server/src/server.ts`, add the import (after the tracks import line):

```typescript
import { handleListDevices, handleSelectDevice, handleGetDeviceParameters, handleSetDeviceParameter } from './handlers/device.js';
```

And in `createToolRegistry()`, after the `// Tracks` block, add:

```typescript
    // Devices
    ['list_devices', handleListDevices],
    ['select_device', handleSelectDevice],
    ['get_device_parameters', handleGetDeviceParameters],
    ['set_device_parameter', handleSetDeviceParameter],
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd mcp-server && npm run build
```

Expected: no TypeScript errors. All four tools should now appear when the
MCP server's tool list is requested (they're enabled by default — not added
to `DEFAULT_DISABLED_TOOLS` in `config.ts`, matching the spec's "enabled by
default" decision).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/definitions.ts mcp-server/src/handlers/index.ts mcp-server/src/server.ts
git commit -m "Register device tools in MCP server"
```

---

### Task 6: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build both components**

```bash
cd bitwig-extension && gradle build && gradle copyExtension
cd ../mcp-server && npm run build
```

- [ ] **Step 2: Start Bitwig, reload extension, connect MCP server**

Reload the extension in Bitwig (Settings > Controllers, disable/re-enable,
or restart Bitwig). Point your MCP client (e.g. Claude Desktop config) at
`mcp-server/dist/index.js` per the existing config in `CLAUDE.md`, or run
the server directly and issue tool calls manually.

- [ ] **Step 3: Walk through the spec's test plan**

1. Load a track with an instrument or effect that has a device chain.
2. Select a device in Bitwig's UI.
3. Call `list_devices` — verify chain contents match what's in Bitwig.
4. Call `select_device` with a different 1-based index — verify Bitwig's
   UI cursor moves to that device.
5. Call `get_device_parameters` — verify names/values match the 8 remote
   control slots shown in Bitwig (you may need to assign parameters to the
   device's remote controls page in Bitwig if none are assigned yet — that's
   expected, not a bug).
6. Call `set_device_parameter` with `index: 0, value: 0.5` — verify the
   value changes are reflected in Bitwig's UI.
7. Deselect all devices (or select a track with no devices) and call
   `get_device_parameters` — verify a clear error is returned
   (`"No device selected. Select a device in Bitwig."`), not a crash or timeout.

- [ ] **Step 4: Report results**

If any step fails, note the exact error message and which step — fix before
proceeding to Task 7. If all steps pass, proceed.

---

### Task 7: Update `CLAUDE.md` documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add device tools to the "Available Tools" table**

In the "Available Tools (Enabled by Default)" table, add a new row after
the "Clips" row:

```markdown
| Devices | `list_devices`, `select_device`, `get_device_parameters`, `set_device_parameter` |
```

- [ ] **Step 2: Add a "Device Control" subsection**

After the "### Optional Clip Selection - Cursor Follows User" section
(before "## Bitwig API Documentation" or wherever it currently sits — check
placement with `grep -n "^##" CLAUDE.md` first), add:

```markdown
### Device Control - Cursor Device Model

Device operations act on the **cursor track's** device chain — whatever
track is currently selected in Bitwig's UI. There is no `trackIndex`
parameter for device tools (unlike clip tools); to control devices on a
different track, select that track in Bitwig first, or call `select_device`
after switching tracks via other means.

Within that device chain, `select_device` moves a second cursor (the
**cursor device**) to a specific device by 1-based position — this cursor
follows Bitwig's own device-selection UI, so selecting a device in Bitwig
also updates what `get_device_parameters`/`set_device_parameter` operate on.

**Parameters** are exposed via Bitwig's generic 8-slot "remote controls
page" (`createCursorRemoteControlsPage(8)`), which works uniformly across
any plugin type without per-plugin parameter typing. Parameter `index` is
0-7 and is NOT converted to 1-based (unlike track/device/clip indices) —
it's treated like a fixed array slot, matching the note `x`/`y` convention.

**Examples:**
```typescript
list_devices()                              // Devices on cursor track
select_device({index: 2})                   // Move cursor device to 2nd device
get_device_parameters()                     // Read cursor device's 8 params
set_device_parameter({index: 0, value: 0.75})  // Set first remote control
```

**Limitations:** Bitwig's 8-slot remote controls page is empty until a
remote controls page/macro mapping exists on the device — Bitwig auto-builds
one for many devices, but some plugins need manual mapping in Bitwig's UI
first. Bypass/enable toggling and per-plugin native parameter lists are out
of scope (see design spec).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document device control tools in CLAUDE.md"
```
