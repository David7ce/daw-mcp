package com.pxaudio.bitwigmcp.handlers;

import com.google.gson.JsonObject;

/**
 * Shared JSON-RPC response shapes used across handler classes.
 */
final class JsonResponses {
    private JsonResponses() {}

    static JsonObject successResponse() {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        return result;
    }
}
