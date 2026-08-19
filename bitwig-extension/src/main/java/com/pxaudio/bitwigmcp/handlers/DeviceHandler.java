package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.*;
import com.google.gson.*;

import com.pxaudio.bitwigmcp.BitwigMCPExtension;

import static com.pxaudio.bitwigmcp.handlers.JsonResponses.successResponse;

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
            case "delete":
                return deleteDevice(params);
            case "listParameterPages":
                return listParameterPages();
            case "selectParameterPage":
                return selectParameterPage(params);
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
        Device device = getValidatedDevice(getDeviceIndex(params));
        extension.getCursorDevice().selectDevice(device);
        return successResponse();
    }

    private JsonElement deleteDevice(JsonObject params) {
        Device device = getValidatedDevice(getDeviceIndex(params));
        device.deleteObject();
        return successResponse();
    }

    /**
     * Get device at index in the cursor track's chain, with bounds and existence validation.
     * Errors report the user-facing 1-based index.
     */
    private Device getValidatedDevice(int index) {
        DeviceBank deviceBank = extension.getDeviceBank();

        if (index < 0 || index >= deviceBank.getSizeOfBank()) {
            throw new IllegalArgumentException("Device does not exist at index: " + (index + 1));
        }

        Device device = deviceBank.getDevice(index);

        if (!device.exists().get()) {
            throw new IllegalArgumentException("Device does not exist at index: " + (index + 1));
        }

        return device;
    }

    private JsonElement getParameters() {
        requireCursorDevice();

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
        requireCursorDevice();

        int index = params.get("index").getAsInt();
        if (index < 0 || index > 7) {
            throw new IllegalArgumentException("Parameter index must be 0-7, got: " + index);
        }
        double value = params.get("value").getAsDouble();

        RemoteControl param = extension.getRemoteControls().getParameter(index);
        // setImmediately, not set: set() is subject to the controller's take over
        // strategy (pickup/match), which silently discards one-shot programmatic
        // writes because they never "catch up" the way a physical fader does.
        param.value().setImmediately(Math.max(0, Math.min(1, value)));
        return successResponse();
    }

    /**
     * List the cursor device's remote control pages.
     *
     * The 8 parameters exposed by getParameters belong to ONE page. Devices
     * typically split their controls across several (oscillator, filter,
     * envelope, ...), so without this the useful parameters are unreachable.
     */
    private JsonElement listParameterPages() {
        requireCursorDevice();

        CursorRemoteControlsPage remoteControls = extension.getRemoteControls();
        JsonArray pages = new JsonArray();
        String[] names = remoteControls.pageNames().get();

        for (int i = 0; i < names.length; i++) {
            JsonObject obj = new JsonObject();
            obj.addProperty("index", i);
            obj.addProperty("name", names[i]);
            pages.add(obj);
        }

        JsonObject result = new JsonObject();
        result.add("pages", pages);
        result.addProperty("count", pages.size());
        result.addProperty("selectedIndex", remoteControls.selectedPageIndex().get());
        return result;
    }

    /**
     * Select a remote control page by index, so getParameters/setParameter
     * act on that page's 8 slots.
     */
    private JsonElement selectParameterPage(JsonObject params) {
        requireCursorDevice();

        CursorRemoteControlsPage remoteControls = extension.getRemoteControls();
        int pageCount = remoteControls.pageNames().get().length;

        if (!params.has("index")) {
            throw new IllegalArgumentException("Missing 'index' parameter");
        }
        int index = params.get("index").getAsInt();
        if (index < 0 || index >= pageCount) {
            throw new IllegalArgumentException(
                "Parameter page does not exist at index: " + (index + 1) + " (device has " + pageCount + ")");
        }

        remoteControls.selectedPageIndex().set(index);
        return successResponse();
    }

    /**
     * Ensure a device is selected in Bitwig before reading/writing its parameters.
     */
    private void requireCursorDevice() {
        if (!extension.getCursorDevice().exists().get()) {
            throw new IllegalArgumentException("No device selected. Select a device in Bitwig.");
        }
    }

    private int getDeviceIndex(JsonObject params) {
        if (!params.has("index")) {
            throw new IllegalArgumentException("Missing 'index' parameter");
        }
        return params.get("index").getAsInt();
    }
}
