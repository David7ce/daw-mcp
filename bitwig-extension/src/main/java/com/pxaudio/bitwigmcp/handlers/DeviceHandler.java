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

        if (index < 0 || index >= deviceBank.getSizeOfBank()) {
            throw new IllegalArgumentException("Device does not exist at index: " + (index + 1));
        }

        Device device = deviceBank.getDevice(index);

        if (!device.exists().get()) {
            throw new IllegalArgumentException("Device does not exist at index: " + (index + 1));
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
