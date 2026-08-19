package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.ControllerHost;
import com.google.gson.*;

import com.pxaudio.bitwigmcp.BitwigMCPExtension;

/**
 * Dispatches incoming commands to appropriate handlers based on method name.
 */
public class CommandDispatcher {
    private final ProjectHandler projectHandler;
    private final TrackHandler trackHandler;
    private final ClipHandler clipHandler;
    private final TransportHandler transportHandler;
    private final DeviceHandler deviceHandler;
    private final BrowserHandler browserHandler;

    public CommandDispatcher(BitwigMCPExtension extension, ControllerHost host) {
        this.projectHandler = new ProjectHandler(extension, host);
        this.trackHandler = new TrackHandler(extension, host);
        this.clipHandler = new ClipHandler(extension, host);
        this.transportHandler = new TransportHandler(extension, host);
        this.deviceHandler = new DeviceHandler(extension, host);
        this.browserHandler = new BrowserHandler(extension, host);
    }

    /**
     * Dispatch a method call to the appropriate handler.
     *
     * @param method The method name (e.g., "project.getInfo", "track.create")
     * @param params The parameters object
     * @return The result as a JsonElement
     * @throws IllegalArgumentException if method is not found
     */
    public JsonElement dispatch(String method, JsonObject params) {
        // Special-cased like Ableton's dispatcher.py: "ping" has no dot, so
        // it must be checked before the category.action split below, not
        // routed through it (a case "ping" inside that switch is dead code -
        // the format check ahead of it always rejects a dot-less method
        // first).
        if (method.equals("ping")) {
            return handlePing();
        }

        String[] parts = method.split("\\.", 2);
        if (parts.length < 2) {
            throw new IllegalArgumentException("Invalid method format: " + method);
        }

        String category = parts[0];
        String action = parts[1];

        switch (category) {
            case "project":
                return projectHandler.handle(action, params);
            case "track":
                return trackHandler.handle(action, params);
            case "clip":
                return clipHandler.handle(action, params);
            case "transport":
                return transportHandler.handle(action, params);
            case "device":
                return deviceHandler.handle(action, params);
            case "browser":
                return browserHandler.handle(action, params);
            default:
                throw new IllegalArgumentException("Unknown category: " + category);
        }
    }

    private JsonElement handlePing() {
        // {"pong": true}, matching PROTOCOL.md and Ableton's dispatcher.py
        JsonObject result = new JsonObject();
        result.addProperty("pong", true);
        return result;
    }
}
