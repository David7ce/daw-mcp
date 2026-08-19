package com.pxaudio.bitwigmcp.handlers;

import com.bitwig.extension.controller.api.ControllerHost;
import com.google.gson.JsonObject;
import com.pxaudio.bitwigmcp.BitwigMCPExtension;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * Covers CommandDispatcher's routing logic: method-format validation and
 * category -> handler dispatch. Routing to the correct handler is verified
 * indirectly - each handler's own "Unknown X action" message names the
 * handler, so reaching that specific message (rather than the dispatcher's
 * own "Unknown category") proves the category routed to the right handler,
 * without needing a full Bitwig API mock to exercise a real success path.
 * Everything is mocked; this doesn't touch a running Bitwig instance.
 */
class CommandDispatcherTest {

    private CommandDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        // Every handler constructor just stores its (extension, host)
        // references - no Bitwig API calls happen at construction time -
        // so mocks are enough to build a real CommandDispatcher.
        BitwigMCPExtension extension = mock(BitwigMCPExtension.class);
        dispatcher = new CommandDispatcher(extension, mock(ControllerHost.class));
    }

    @Test
    void methodWithNoDotAtAll_throwsInvalidFormat() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("nodothere", new JsonObject()));
        assertTrue(e.getMessage().contains("Invalid method format"));
    }

    @Test
    void ping_returnsPongTrue_matchingProtocolMdAndAbletonsDispatcher() {
        // Regression guard: ping is dot-less, so it must be special-cased
        // before the category.action split - routing it through the split
        // instead (as a `case "ping"` inside the switch) makes it
        // unreachable, since the format check ahead of the switch rejects
        // any dot-less method first.
        JsonObject result = dispatcher.dispatch("ping", new JsonObject()).getAsJsonObject();
        assertTrue(result.get("pong").getAsBoolean());
    }

    @Test
    void unknownCategory_throws() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("bogus.action", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown category: bogus"));
    }

    @Test
    void routesProjectMethodsToProjectHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("project.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown project action: bogus"));
    }

    @Test
    void routesTrackMethodsToTrackHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("track.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown track action: bogus"));
    }

    @Test
    void routesClipMethodsToClipHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("clip.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown clip action: bogus"));
    }

    @Test
    void routesTransportMethodsToTransportHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("transport.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown transport action: bogus"));
    }

    @Test
    void routesDeviceMethodsToDeviceHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("device.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown device action: bogus"));
    }

    @Test
    void routesBrowserMethodsToBrowserHandler() {
        Exception e = assertThrows(IllegalArgumentException.class, () -> dispatcher.dispatch("browser.bogus", new JsonObject()));
        assertTrue(e.getMessage().contains("Unknown browser action: bogus"));
    }
}
